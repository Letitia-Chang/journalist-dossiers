import { z } from 'zod';

/**
 * Request bodies. Every string has a length cap: these values are stored, shown to other people
 * and pasted into paid Claude prompts, so "any length" is never right.
 */

const hasControl = (s: string) => [...s].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);

/** Free text. NUL is rejected because Postgres text cannot store it. */
export const text = (max: number) =>
  z.string().max(max, `Must be ${max} characters or fewer`).refine(s => !s.includes('\u0000'), 'Invalid characters');

/** Single-line text: no control characters, so it is safe in headers such as an email subject. */
export const line = (max: number) =>
  z.string().max(max, `Must be ${max} characters or fewer`).refine(s => !hasControl(s), 'Must be a single line');

/** A link rendered as an href. A bare domain is fine; any scheme other than http(s) is not. */
export const link = z.string().trim().max(2000, 'URL is too long')
  .refine(s => !hasControl(s), 'Invalid URL')
  .refine(s => {
    // "example.com:8080" also parses as a scheme, so a dot marks it as a host.
    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(s)?.[1].toLowerCase();
    return !scheme || scheme === 'http' || scheme === 'https' || scheme.includes('.');
  }, 'Must be an http(s) URL');

// Free-form on purpose: people record "a@x.com; b@x.com" or a note. One line, so it is header-safe.
const email = line(254).trim();

const id = z.number().int().positive().max(2147483647);
const date = z.preprocess(
  v => (v === '' ? null : v),
  z.string().max(40).refine(s => /^\d{4}-\d{2}-\d{2}/.test(s) && !Number.isNaN(Date.parse(s)), 'Invalid date').nullish(),
);
const name = line(200).trim().min(1, 'Required');
const score = z.object({ dimensionId: id, score: z.number().min(0).max(1000).transform(Math.round) });

const journalistFields = {
  publicationId: id.nullish(),
  email: email.nullish(),
  twitter: link.nullish(),
  linkedin: link.nullish(),
  bio: text(4000).nullish(),
  beats: z.array(line(80)).max(20).nullish(),
  photoUrl: link.nullish(),
  scores: z.array(score).max(50).nullish(),
};
export const journalistCreate = z.object({ name, ...journalistFields });
export const journalistUpdate = z.object({ name: name.nullish(), isFavorite: z.boolean().nullish(), ...journalistFields });

const campaignFields = { brief: text(12000).nullish(), campaignType: line(60).nullish() };
export const campaignCreate = z.object({ name, ...campaignFields });
export const campaignUpdate = z.object({ name: name.nullish(), status: line(40).nullish(), ...campaignFields });
export const campaignAddJournalists = z.object({ journalistIds: z.array(id).min(1, 'journalistIds is required').max(200) });
export const draftUpdate = z.object({ draftSubject: line(300).nullish(), draftBody: text(8000).nullish() });
export const regenerate = z.object({ instructions: text(1000).nullish() });
export const styleUpdate = z.object({ instructions: text(8000).nullish() });

export const articleCreate = z.object({ journalistId: id, title: line(300).trim().min(1, 'Required'), url: link.nullish(), summary: text(4000).nullish(), publishedAt: date });
export const articleUpdate = z.object({ title: line(300).trim().min(1, 'Required').nullish(), url: link.nullish(), summary: text(4000).nullish(), publishedAt: date });

const coverageFields = { url: link.nullish(), notes: text(4000).nullish(), publishedAt: date, journalistId: id.nullish(), campaignId: id.nullish() };
export const coverageCreate = z.object({ title: line(300).trim().min(1, 'Required'), ...coverageFields });
export const coverageUpdate = z.object({ title: line(300).trim().min(1, 'Required').nullish(), ...coverageFields });

export const outreachCreate = z.object({
  journalistId: id, campaignId: id.nullish(), type: line(40).min(1, 'Required'), status: line(40).min(1, 'Required'), notes: text(4000).nullish(),
});
export const outreachUpdate = z.object({ type: line(40).min(1).nullish(), status: line(40).min(1).nullish(), notes: text(4000).nullish() });

const weight = z.number().int().min(0).max(1000);
const order = z.number().int().min(0).max(1000);
export const dimensionCreate = z.object({ name, description: text(1000).nullish(), weight: weight.nullish(), displayOrder: order.nullish() });
export const dimensionUpdate = z.object({ name: name.nullish(), description: text(1000).nullish(), weight: weight.nullish(), displayOrder: order.nullish() });

const publicationFields = {
  url: link.nullish(), tier: line(20).nullish(), focus: text(2000).nullish(), notes: text(4000).nullish(), rssUrl: link.nullish(),
};
export const publicationCreate = z.object({ name, ...publicationFields });
export const publicationUpdate = z.object({ name: name.nullish(), active: z.boolean().nullish(), ...publicationFields });
export const feedCreate = z.object({ feedUrl: link.min(1, 'feedUrl is required'), feedLabel: line(200).nullish() });
export const discover = z.object({ query: line(200).trim().min(1, 'query is required') });
export const opmlImport = z.object({ opml: z.string().min(1, 'opml text is required') });

const loginEmail = z.string().trim().toLowerCase().max(254).min(1, 'Required');
// bcrypt only reads the first 72 bytes, so a longer password would be silently truncated.
const password = z.string().min(8, 'Password must be at least 8 characters').refine(s => Buffer.byteLength(s) <= 72, 'Password is too long');
export const signup = z.object({ email: loginEmail.refine(s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s), 'Must be a valid email address'), password, name });
// Not lowercased here: if two old accounts differ only by case, the exact spelling picks one.
export const login = z.object({ email: z.string().trim().max(254).min(1, 'Required'), password: z.string().min(1, 'Required').max(200) });
export const acceptInvite = z.object({ token: z.string().regex(/^[0-9a-f]{48}$/, 'Invalid token'), name, password });
export const invite = z.object({
  email: loginEmail.refine(s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s), 'A valid email is required'),
  role: z.enum(['owner', 'admin', 'member']).default('member'),
});
export const roleUpdate = z.object({ role: z.enum(['owner', 'admin', 'member']) });
