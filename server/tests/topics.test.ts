import { describe, expect, it } from 'vitest';
import { companyProfileSchema } from '../src/lib/companyProfile';
import { commonCategory, matchTopics, relevance, searchTags, topicsFrom } from '../src/lib/topics';
import { sectionCandidates } from '../src/services/categoryFeedDiscovery';

const make = (p: Record<string, unknown>) => topicsFrom(companyProfileSchema.parse({ name: 'X', ...p }));
const grid = make({
  industry: 'Climate tech / grid software', one_liner: 'Gets clean-energy projects connected to the grid sooner.',
  products: 'An interconnection-queue analytics platform.', spokespeople: [{ name: 'A', topics: ['interconnection', 'state policy'] }], competitors: ['Gridwell'],
});
const food = make({ industry: 'Bakery & food retail', one_liner: 'Fresh bread delivered to restaurants.', products: 'Wholesale sourdough.', spokespeople: [{ name: 'B', topics: ['restaurants', 'food safety'] }] });
const hr = make({
  industry: 'HR software', one_liner: 'We help people leaders keep their best staff and grow across every office.',
  products: 'A second look at real performance data: surveys, reviews, goal setting and pay planning in one place, kept up to date so managers act early. Dashboards show trends by team, date and location.',
  target_audience: 'People leaders at growing companies who want to move quickly without losing the human side of work, from the first hire to a thousand staff.',
  key_messages: ['Good managers make the real difference', 'Most surveys are read too late to matter'],
});
const pts = (t: typeof grid, title: string, cats: string[] = []) => matchTopics(t, title, cats).points;
const author = (t: typeof grid, titles: string[], cats: string[] = []) => relevance(titles.map(x => matchTopics(t, x, cats)));

const UNRELATED = [
  'City council votes on new park budget', 'Local team wins second straight title', 'Why the best recipes start with butter', 'Storm moves across the coast overnight',
  'A real look at life on the farm', 'How to keep houseplants alive', 'Museum sets opening date for new wing', 'Film festival returns to the old theater', 'Ten trails to hike this fall', 'The actor who would not quit',
  'Bridge repairs to finish early', 'Volcano shows signs of new activity', 'Chess champion retires at 30', 'Songwriter talks about her first album', 'Ferry service resumes after fog',
];

describe('profile topics', () => {
  it('ranks by the company, not by any fixed subject', () => {
    expect(pts(grid, 'Interconnection queues keep growing')).toBeGreaterThan(0);
    expect(pts(food, 'Interconnection queues keep growing')).toBe(0);
    expect(pts(food, 'Restaurants rethink their sourdough', ['Food'])).toBeGreaterThan(0);
    expect(pts(grid, 'Restaurants rethink their sourdough', ['Food'])).toBe(0);
    // Topics the original version hard-coded mean nothing unless the profile mentions them.
    for (const t of ['Startup raises Series A', 'OpenAI ships a new LLM', 'Enterprise SaaS funding']) expect([pts(grid, t), pts(food, t)]).toEqual([0, 0]);
  });

  it('keeps unrelated journalists low, even for a wordy profile', () => {
    for (const t of [grid, food, hr]) {
      for (let i = 0; i + 10 <= UNRELATED.length; i++) expect(author(t, UNRELATED.slice(i, i + 10))).toBeLessThan(3);
    }
  });

  it('still separates a specialist from an occasional mention', () => {
    const specialist = ['Interconnection queue hits record', 'Grid operators weigh faster study', 'State policy shifts on transmission', 'Climate tech funding slows'];
    expect(author(grid, specialist, ['Energy'])).toBeGreaterThanOrEqual(6);
    expect(author(grid, [...UNRELATED.slice(0, 9), 'Grid operators prepare for winter'])).toBeLessThan(3);
    expect(author(hr, ['New HR rules for small firms', 'HR chiefs on hiring', 'What HR gets wrong', 'HR tech spending dips', 'Inside HR', 'HR in 2027'])).toBeGreaterThanOrEqual(6);
  });

  it('counts phrases over words, and feed categories over headlines', () => {
    expect(pts(grid, 'New state policy on permits')).toBeGreaterThan(pts(grid, 'Policy notes'));
    expect(matchTopics(grid, 'Policy notes', []).partial).toBe(1);
    expect(pts(grid, '', ['Interconnection'])).toBeGreaterThan(pts(grid, 'Interconnection'));
  });

  it('ignores names and industries that are ordinary words', () => {
    const t = make({ industry: 'IT', competitors: ['On', 'The One', 'Next'] });
    for (const x of ['Why it matters', 'On the road', 'What happens next', 'The one that got away']) expect(pts(t, x)).toBe(0);
    expect(pts(make({ competitors: ['Next Insurance'] }), 'Next Insurance cuts staff')).toBe(2);
    expect(matchTopics(make({ competitors: ['Next Insurance'] }), 'Insurance rates climb', [])).toMatchObject({ points: 0, partial: 0 }); // a rival's words aren't our subject
  });

  it('keeps subjects made of common words, and acronyms', () => {
    const has = (p: Record<string, unknown>, title: string) => pts(make(p), title) > 0;
    const topic = (t: string) => ({ spokespeople: [{ name: 'A', topics: [t] }] });
    for (const [t, title] of [
      ['Future of work', 'The future of work is hybrid'], ['Local news', 'Saving local news'], ['Power', 'Power bills rise'], ['Customer experience', 'Fixing customer experience'],
      ['Data', 'Who owns your data'], ['5G', 'Rural 5G stalls'], ['ML', 'ML in medicine'], ['VR', 'A VR comeback'], ['UX', 'Better UX wins'], ['IT', 'Why IT budgets shrink'],
      ['EV', 'EVs surge in spring'], ['ev', 'EVs surge in spring'], ['vc', 'VCs turn cautious'], ['Buses', 'A new bus route'], ['Cache', 'CPU caches explained'], ['Law', 'New laws ahead'],
      ['Early childhood', 'Early childhood funding'], ['Data centers', 'A data center boom'], ['Power grids', 'The power grid at its limit'],
    ]) expect([t, has(topic(t), title)]).toEqual([t, true]);
    for (const c of ['SAP', 'IBM', 'AWS', 'BMW', 'Box']) expect([c, has({ competitors: [c] }, `${c} cuts its forecast`)]).toEqual([c, true]);
    expect(has({ competitors: ['SAP'] }, 'Maple sap season')).toBe(false);
    expect(has(topic('IT'), 'WHY IT MATTERS')).toBe(false);
  });

  it('does not confuse words that only look alike, and ignores case where it can', () => {
    for (const [industry, title] of [['Wine', 'Home team win again'], ['Cars', 'Child care costs rise'], ['Planes', 'The plan moves ahead'], ['Gene therapy', 'Gen Z shops less']]) expect([industry, pts(make({ industry }), title)]).toEqual([industry, 0]);
    for (const [industry, text] of [['AI', 'ai'], ['AI', 'AI & ML'], ['AI', 'AI BOOM'], ['AI', 'AI芯片競賽'], ['EV', 'evs'], ['FOOD', 'Food prices'], ['HR software', 'hr']]) expect([industry, text, pts(make({ industry }), text) > 0]).toEqual([industry, text, true]);
    expect(matchTopics(make({ industry: 'Future of work' }), 'The future of work', []).matched).toEqual(['future of work']);
    expect(matchTopics(make({ industry: 'IT services' }), 'Why it matters', []).points).toBe(0);
  });

  it('one shared word cannot lift anyone past low', () => {
    const t = make({ industry: 'Climate tech', spokespeople: [{ name: 'A', topics: ['small business'] }] });
    expect(author(t, UNRELATED.slice(0, 5), ['Business'])).toBeLessThan(3);
    expect(author(t, UNRELATED.slice(0, 5), ['Tech'])).toBeLessThan(3);
    expect(author(t, UNRELATED.slice(0, 5), ['Small Business'])).toBeGreaterThanOrEqual(6);
  });

  it('matches plurals, accents and other scripts, whole words only, and reports why', () => {
    expect(matchTopics(food, 'A restaurant opens', []).matched).toEqual(['restaurants']); // as the profile wrote it
    expect(pts(grid, 'Gridlock downtown')).toBe(0);
    expect(pts(make({ industry: 'Café culture' }), 'The cafe culture boom')).toBe(2);
    expect(pts(make({ industry: 'Tax' }), 'New taxes ahead')).toBeGreaterThan(0);
    expect(pts(make({ industry: 'Movies' }), 'A movie worth seeing')).toBeGreaterThan(0);
    expect(pts(make({ industry: '再生能源' }), '台灣再生能源新政策')).toBe(2);
    expect(pts(make({ industry: 'Энергетика' }), 'Новая энергетика России')).toBe(2);
    expect(pts(make({ industry: '再生能源' }), '職棒總冠軍賽')).toBe(0);
  });

  it('copes with no profile, an empty one, odd text and huge input', () => {
    expect(pts(topicsFrom(null), 'Anything', ['x'])).toBe(0);
    expect(pts(make({}), 'Anything about data and software')).toBe(0);
    expect(pts(grid, '', ['', '  ', '💡'])).toBe(0);
    const t = Date.now();
    matchTopics(hr, 'word '.repeat(50_000), Array(5000).fill('category'));
    expect(Date.now() - t).toBeLessThan(500);
  });
});

describe('commonCategory', () => {
  it('takes a beat from what the publication calls it, ignoring labels that are not subjects', () => {
    expect(commonCategory([['Energy', 'Policy'], ['Energy'], []])).toBe('Energy');
    expect(commonCategory([['Uncategorized', 'Energy']])).toBe('Energy');
    expect(commonCategory([['energy'], ['Energy'], ['Politics']])).toBe('energy');
    expect(commonCategory([['News', '12345', '2025/11', ' ', 'Editor’s Picks', 'Sponsored', 'https://x.example']])).toBe('');
    expect(commonCategory([[], []])).toBe('');
  });
});

describe('searchTags', () => {
  it('uses only meaningful words from the search', () => {
    expect(searchTags('climate tech')).toEqual(['climate-tech', 'climate', 'tech']);
    expect(searchTags('EV and VC')).toEqual(['ev', 'vc']);
    expect([searchTags('real estate'), searchTags('open source'), searchTags('local news'), searchTags('small business'), searchTags('5G')]).toEqual([['real-estate'], ['open-source'], ['local-news'], ['small-business'], ['5g']]);
    expect(searchTags('data centers')).toEqual(['data-centers']);
    expect(searchTags('café')).toEqual(['cafe']);
    expect(searchTags('AI')).toEqual(['ai']);
    expect(searchTags('再生能源')).toEqual(['再生能源']);
    expect(searchTags('--- and the')).toEqual([]);
    expect(searchTags('climate tech policy for small cities')).toEqual(['climate', 'tech', 'policy', 'cities']);
  });
});

describe('sectionCandidates', () => {
  const links = (hrefs: string[]) => hrefs.map(h => `<a href="${h}">x</a>`).join('');
  it('prefers matching sections, falls back to a few, and skips what is not a section', () => {
    const html = links(['/#main', '/?s=', '/about-us', '/privacy-policy', '/contact', '/sports', '/culture', '/climate-tech', '/climate-tech?x=1#y', '/img.png', 'https://other.example/climate-tech', 'mailto:a@b.co', 'javascript:1', '/a/b/c/d']);
    const got = sectionCandidates(html, 'https://news.example/', grid).map(([u]) => u);
    expect(got).toEqual(['https://news.example/climate-tech', 'https://news.example/sports', 'https://news.example/culture']);
  });
  it('lets a relevant section through even when the name usually means something else', () => {
    const find = (industry: string, href: string) => sectionCandidates(links([href]), 'https://n.example', make({ industry })).length;
    for (const [industry, href] of [['Legal', '/legal'], ['Jobs', '/jobs'], ['Privacy', '/privacy'], ['Advertising', '/advertising']]) expect([href, find(industry, href)]).toEqual([href, 1]);
    for (const href of ['/accounting', '/staffing', '/cartoons', '/profiles-in-courage', '/authoritarianism', '/eventing', '/support-groups', '/teams-sport']) expect([href, find('Bakery', href)]).toEqual([href, 1]);
    for (const href of ['/login', '/search', '/feed', '/about-us', '/privacy-policy', '/legal', '/jobs']) expect([href, find('Bakery', href)]).toEqual([href, 0]);
  });
  it('stays polite on a huge page, and works with no profile', () => {
    const html = links(Array.from({ length: 500 }, (_, i) => `/grid-${i}`));
    expect(sectionCandidates(html, 'https://news.example', grid)).toHaveLength(12);
    expect(sectionCandidates(html, 'https://news.example', topicsFrom(null))).toHaveLength(5);
  });
});
