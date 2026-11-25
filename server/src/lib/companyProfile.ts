import { z } from 'zod';
import type { Pool, PoolClient } from 'pg';
import pool from '../db';

/**
 * The company profile is the single source of truth for every AI step
 * (fit scoring, pitch drafts, publication suggestions). Nothing about the
 * company is hard-coded anywhere else.
 */

// Every field ends up in paid Claude prompts, so every field has a cap.
const str = (max: number) => z.string().trim().max(max, `Must be ${max} characters or fewer`).refine(s => !s.includes('\u0000'), 'Invalid characters');
const httpUrl = z.string().trim().max(500).regex(/^https?:\/\//i, 'Must be a valid URL (https://…)').url('Must be a valid URL (https://…)');
const optionalUrl = z.union([z.literal(''), httpUrl]);
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a 6-digit hex color like #4f46e5');
const stringList = z.array(str(300).min(1)).max(20, 'At most 20 items').default([]);

export const newsworthyItemSchema = z.object({
  type: z.enum(['launch', 'funding', 'research', 'hire', 'other']).default('other'),
  title: str(200).min(1, 'Title is required'),
  date: str(40).default(''),
  description: str(1000).default(''),
  url: optionalUrl.default(''),
});

export const spokespersonSchema = z.object({
  name: str(100).min(1, 'Name is required'),
  title: str(100).default(''),
  topics: stringList,
});

export const pressCoverageSchema = z.object({
  title: str(200).default(''),
  url: httpUrl,
});

export const companyProfileSchema = z.object({
  name: str(200).min(1, 'Company name is required'),
  website: optionalUrl.default(''),
  one_liner: str(500).default(''),
  industry: str(200).default(''),
  products: str(2000).default(''),
  target_audience: str(1000).default(''),
  regions: stringList,
  key_messages: stringList,
  newsworthy_items: z.array(newsworthyItemSchema).max(20, 'At most 20 items').default([]),
  competitors: stringList,
  press_coverage: z.array(pressCoverageSchema).max(20, 'At most 20 items').default([]),
  spokespeople: z.array(spokespersonSchema).max(20, 'At most 20 items').default([]),
  pitch_tone: str(1000).default(''),
  email_signature: z.string().max(1000).refine(s => !s.includes('\u0000'), 'Invalid characters').default(''),
  // Branding
  app_name: str(60).default('Press Dossier'),
  logo_url: optionalUrl.default(''),
  brand_color: hexColor.default('#4f46e5'),
});

export type CompanyProfile = z.infer<typeof companyProfileSchema>;

export function emptyProfile(name = ''): CompanyProfile {
  return companyProfileSchema.parse({ name: name || 'My Company' });
}

/** Flatten zod issues into `{ "spokespeople.0.name": "Name is required" }`. */
export function formatIssues(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

const COLUMNS = [
  'name', 'website', 'one_liner', 'industry', 'products', 'target_audience', 'regions',
  'key_messages', 'newsworthy_items', 'competitors', 'press_coverage', 'spokespeople',
  'pitch_tone', 'email_signature', 'app_name', 'logo_url', 'brand_color',
] as const;
const JSON_COLUMNS = new Set(['regions', 'key_messages', 'newsworthy_items', 'competitors', 'press_coverage', 'spokespeople']);

export async function loadProfile(orgId: string): Promise<CompanyProfile | null> {
  const { rows: [row] } = await pool.query(
    `SELECT ${COLUMNS.join(', ')} FROM company_profile WHERE org_id = $1`, [orgId],
  );
  if (!row) return null;
  const parsed = companyProfileSchema.safeParse(row);
  // A row that no longer validates (e.g. edited by hand) still shouldn't crash the app.
  return parsed.success ? parsed.data : (row as CompanyProfile);
}

export async function saveProfile(orgId: string, profile: CompanyProfile, db: Pool | PoolClient = pool): Promise<void> {
  const values = COLUMNS.map(c => (JSON_COLUMNS.has(c) ? JSON.stringify(profile[c]) : profile[c]));
  const placeholders = COLUMNS.map((_c, i) => `$${i + 2}`).join(', ');
  const updates = COLUMNS.map((c, i) => `${c} = $${i + 2}`).join(', ');
  await db.query(
    `INSERT INTO company_profile (org_id, ${COLUMNS.join(', ')})
     VALUES ($1, ${placeholders})
     ON CONFLICT (org_id) DO UPDATE SET ${updates}, updated_at = NOW()`,
    [orgId, ...values],
  );
  // Keep the organization's display name in sync with the profile.
  await db.query('UPDATE organizations SET name = $1, updated_at = NOW() WHERE id = $2', [profile.name, orgId]);
}

// ── Prompt building ───────────────────────────────────────────────────────────

export type PromptPurpose = 'scoring' | 'pitch' | 'research';

function block(title: string, body: string | undefined | null): string {
  const text = (body ?? '').trim();
  return text ? `${title}:\n${text}` : '';
}

function bullets(items: string[]): string {
  return items.map(i => `- ${i}`).join('\n');
}

/**
 * Render the profile as plain text for an LLM prompt. Empty fields are omitted so
 * a half-filled profile never produces "undefined" or empty headings.
 */
export function profileToPrompt(profile: CompanyProfile | null, purpose: PromptPurpose): string {
  if (!profile) return 'COMPANY: (no company profile has been set up yet)';

  const sections: string[] = [];
  const headline = [profile.name, profile.industry && `(${profile.industry})`, profile.website].filter(Boolean).join(' ');
  sections.push(`COMPANY: ${headline}`);
  if (profile.one_liner) sections.push(profile.one_liner);
  sections.push(block('Products and services', profile.products));
  sections.push(block('Target audience', profile.target_audience));
  if (profile.regions.length) sections.push(`Regions: ${profile.regions.join(', ')}`);

  if (purpose === 'scoring' || purpose === 'research') {
    if (profile.competitors.length) sections.push(block('Competitors / similar companies', bullets(profile.competitors)));
  }
  if (purpose === 'scoring' || purpose === 'pitch') {
    if (profile.key_messages.length) sections.push(block('Key messages and story angles', bullets(profile.key_messages)));
  }
  if (purpose === 'pitch') {
    if (profile.newsworthy_items.length) {
      sections.push(block('Recent newsworthy items', bullets(profile.newsworthy_items.map(n =>
        [`[${n.type}] ${n.title}`, n.date && `(${n.date})`, n.description && `— ${n.description}`, n.url && `<${n.url}>`]
          .filter(Boolean).join(' ')))));
    }
    if (profile.spokespeople.length) {
      sections.push(block('Available spokespeople (pick the one whose topics best match the journalist)', bullets(profile.spokespeople.map(s =>
        `${s.name}${s.title ? `, ${s.title}` : ''}${s.topics.length ? ` — topics: ${s.topics.join(', ')}` : ''}`))));
    }
    sections.push(block('Tone for pitches', profile.pitch_tone));
    sections.push(block('Email signature (end the email with exactly this)', profile.email_signature));
  }
  if (purpose === 'scoring' && profile.press_coverage.length) {
    sections.push(block('Existing press coverage of us', bullets(profile.press_coverage.map(p => (p.title ? `${p.title} <${p.url}>` : p.url)))));
  }

  return sections.filter(Boolean).join('\n\n');
}
