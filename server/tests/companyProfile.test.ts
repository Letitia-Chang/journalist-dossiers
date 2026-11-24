import { describe, expect, it } from 'vitest';
import { companyProfileSchema, emptyProfile, formatIssues, profileToPrompt } from '../src/lib/companyProfile';

describe('companyProfileSchema', () => {
  it('accepts a minimal profile and fills defaults', () => {
    const p = companyProfileSchema.parse({ name: 'Acme' });
    expect(p.name).toBe('Acme');
    expect(p.app_name).toBe('Press Dossier');
    expect(p.brand_color).toBe('#4f46e5');
    expect(p.regions).toEqual([]);
    expect(p.spokespeople).toEqual([]);
  });

  it('requires a company name', () => {
    expect(companyProfileSchema.safeParse({ name: '   ' }).success).toBe(false);
  });

  it('rejects malformed URLs and colors but allows an empty website', () => {
    expect(companyProfileSchema.safeParse({ name: 'A', website: '' }).success).toBe(true);
    const bad = companyProfileSchema.safeParse({ name: 'A', website: 'nope', brand_color: 'red' });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      const issues = formatIssues(bad.error);
      expect(issues.website).toMatch(/valid URL/);
      expect(issues.brand_color).toMatch(/hex/);
    }
  });

  it('validates nested list items and reports their path', () => {
    const bad = companyProfileSchema.safeParse({
      name: 'A',
      spokespeople: [{ name: '' }],
      press_coverage: [{ url: 'not a url' }],
    });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      const issues = formatIssues(bad.error);
      expect(issues['spokespeople.0.name']).toBeDefined();
      expect(issues['press_coverage.0.url']).toBeDefined();
    }
  });
});

describe('profileToPrompt', () => {
  const profile = companyProfileSchema.parse({
    name: 'Lumen',
    industry: 'Climate tech',
    one_liner: 'Grid software.',
    regions: ['US'],
    competitors: ['Acme'],
    key_messages: ['Queues are the bottleneck'],
    newsworthy_items: [{ type: 'funding', title: 'Seed round', date: '2026-10' }],
    spokespeople: [{ name: 'Rin', title: 'CEO', topics: ['grid'] }],
    pitch_tone: 'Warm',
    email_signature: '— Rin',
    press_coverage: [{ url: 'https://example.com/story', title: 'A story' }],
  });

  it('handles a missing profile without throwing', () => {
    expect(profileToPrompt(null, 'scoring')).toMatch(/no company profile/);
  });

  it('includes scoring context but not pitch-only fields', () => {
    const text = profileToPrompt(profile, 'scoring');
    expect(text).toContain('Lumen');
    expect(text).toContain('Acme');
    expect(text).toContain('https://example.com/story');
    expect(text).not.toContain('Seed round');
    expect(text).not.toContain('— Rin');
  });

  it('includes story, spokespeople, tone and signature for pitches', () => {
    const text = profileToPrompt(profile, 'pitch');
    expect(text).toContain('Seed round');
    expect(text).toContain('Rin, CEO');
    expect(text).toContain('Warm');
    expect(text).toContain('— Rin');
  });

  it('omits empty sections instead of printing blanks', () => {
    const text = profileToPrompt(emptyProfile('Solo'), 'pitch');
    expect(text).toContain('Solo');
    expect(text).not.toMatch(/undefined|null/);
    expect(text).not.toContain('Competitors');
    expect(text).not.toContain('spokespeople');
  });
});
