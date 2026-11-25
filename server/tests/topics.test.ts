import { describe, expect, it } from 'vitest';
import { companyProfileSchema } from '../src/lib/companyProfile';
import { commonCategory, matchTopics, topicsFrom } from '../src/lib/topics';

const grid = topicsFrom(companyProfileSchema.parse({
  name: 'Lumen', industry: 'Climate tech / grid software', one_liner: 'Gets clean-energy projects connected to the grid sooner.',
  products: 'An interconnection-queue analytics platform.', spokespeople: [{ name: 'A', topics: ['interconnection', 'state policy'] }], competitors: ['Gridwell'],
}));
const food = topicsFrom(companyProfileSchema.parse({
  name: 'Crumb', industry: 'Bakery & food retail', one_liner: 'Fresh bread delivered to restaurants.',
  products: 'Wholesale sourdough.', spokespeople: [{ name: 'B', topics: ['restaurants', 'food safety'] }],
}));
const pts = (t: typeof grid, title: string, cats: string[] = []) => matchTopics(t, title, cats).points;

describe('profile topics', () => {
  it('ranks by the company, not by any fixed subject', () => {
    expect(pts(grid, 'Interconnection queues keep growing')).toBeGreaterThan(0);
    expect(pts(food, 'Interconnection queues keep growing')).toBe(0);
    expect(pts(food, 'Restaurants rethink their sourdough', ['Food'])).toBeGreaterThan(0);
    expect(pts(grid, 'Restaurants rethink their sourdough', ['Food'])).toBe(0);
    // Topics the original version hard-coded mean nothing unless the profile mentions them.
    for (const t of ['Startup raises Series A', 'OpenAI ships a new LLM', 'Enterprise SaaS funding']) expect([pts(grid, t), pts(food, t)]).toEqual([0, 0]);
  });

  it('counts phrases over single words, and feed categories over headlines', () => {
    expect(pts(grid, 'New state policy on permits')).toBeGreaterThan(pts(grid, 'Clean power rises'));
    expect(pts(grid, '', ['Interconnection'])).toBeGreaterThan(pts(grid, 'Interconnection'));
  });

  it('matches plurals and accents, whole words only, and reports why', () => {
    expect(matchTopics(food, 'A restaurant opens', []).matched).toEqual(['restaurant']);
    expect(pts(grid, 'Gridlock downtown')).toBe(0);
    const pr = topicsFrom(companyProfileSchema.parse({ name: 'X', industry: 'Café culture' }));
    expect(pts(pr, 'The cafe culture boom')).toBeGreaterThan(0);
  });

  it('copes with no profile, an empty one, and odd text', () => {
    expect(pts(topicsFrom(null), 'Anything', ['x'])).toBe(0);
    expect(pts(topicsFrom(companyProfileSchema.parse({ name: 'X' })), 'Anything about data and software')).toBe(0);
    expect(pts(grid, '', ['', '  ', '💡'])).toBe(0);
    expect(pts(topicsFrom(companyProfileSchema.parse({ name: 'X', industry: 'Tools' })), 'New tools for teams')).toBe(0); // filler
  });

  it('takes a beat from what the publication calls it', () => {
    expect(commonCategory([['Energy', 'Policy'], ['Energy'], []])).toBe('Energy');
    expect(commonCategory([[], []])).toBe('');
  });
});
