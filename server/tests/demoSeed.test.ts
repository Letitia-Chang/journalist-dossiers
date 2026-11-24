import { describe, expect, it } from 'vitest';
import { DEFAULT_DIMENSIONS } from '../src/lib/bootstrap';
import { companyProfileSchema } from '../src/lib/companyProfile';
import { draftFor, rationaleFor } from '../src/demo/seed';
import { DEMO_JOURNALISTS, DEMO_OUTLETS, DEMO_PROFILE } from '../src/demo/seedData';

const urlsIn = (value: unknown): string[] => JSON.stringify(value).match(/https?:\/\/[^"\\\s)]+/g) ?? [];
const emailsIn = (value: unknown): string[] => JSON.stringify(value).match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi) ?? [];

describe('demo seed data', () => {
  it('has a valid, fully filled company profile', () => {
    expect(companyProfileSchema.safeParse(DEMO_PROFILE).success).toBe(true);
    expect(DEMO_PROFILE.spokespeople.length).toBeGreaterThanOrEqual(2);
    expect(DEMO_PROFILE.newsworthy_items.length).toBeGreaterThanOrEqual(2);
  });

  it('has 8–12 journalists with articles, in a spread of fit scores', () => {
    expect(DEMO_JOURNALISTS.length).toBeGreaterThanOrEqual(8);
    expect(DEMO_JOURNALISTS.length).toBeLessThanOrEqual(12);
    const totals = DEMO_JOURNALISTS.map(j => j.scores.reduce((a, b) => a + b, 0));
    expect(Math.max(...totals)).toBeGreaterThan(80);
    expect(Math.min(...totals)).toBeLessThan(40);
    for (const j of DEMO_JOURNALISTS) expect(j.articles.length).toBeGreaterThan(0);
  });

  it('keeps every score within its dimension weight', () => {
    for (const j of DEMO_JOURNALISTS) {
      j.scores.forEach((s, i) => {
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(DEFAULT_DIMENSIONS[i].weight);
      });
    }
  });

  it('uses only fictional (example.com) URLs and email addresses', () => {
    const everything = [DEMO_PROFILE, DEMO_OUTLETS, DEMO_JOURNALISTS];
    for (const url of urlsIn(everything)) expect(new URL(url).hostname).toMatch(/(^|\.)example\.com$/);
    for (const email of emailsIn(everything)) expect(email.toLowerCase()).toMatch(/@([\w-]+\.)*example\.com$/);
  });

  it('assigns every journalist to a known outlet', () => {
    const keys = new Set(DEMO_OUTLETS.map(o => o.key));
    for (const j of DEMO_JOURNALISTS) expect(keys.has(j.outlet)).toBe(true);
  });

  it('writes a pitch that names the journalist, a spokesperson and the signature', () => {
    for (const j of DEMO_JOURNALISTS) {
      const d = draftFor(j);
      expect(d.body).toContain(`Hi ${j.name.split(' ')[0]}`);
      expect(d.body).toContain(DEMO_PROFILE.email_signature);
      expect(DEMO_PROFILE.spokespeople.some(s => d.body.includes(s.name))).toBe(true);
      expect(d.subject.split(' ').length).toBeLessThanOrEqual(10);
    }
  });

  it('writes rationales that differ by fit level', () => {
    const j = DEMO_JOURNALISTS[0];
    const high = rationaleFor(0, j, 'Outlet', 24, 25);
    const low = rationaleFor(0, j, 'Outlet', 4, 25);
    expect(high).not.toBe(low);
    expect(high).toContain(j.articles[0].title);
  });
});
