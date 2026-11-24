import { describe, expect, it } from 'vitest';
import { parseRobots, pathAllowed } from '../src/lib/http';

const robots = `
User-agent: *
Disallow: /private/
Allow: /private/public-page
Disallow: /*.pdf$

User-agent: PressDossierBot
Disallow: /staff/
`;

describe('robots.txt', () => {
  it('uses the group that names us over the wildcard group', () => {
    const rules = parseRobots(robots, 'PressDossierBot');
    expect(pathAllowed(rules, '/staff/team')).toBe(false);
    expect(pathAllowed(rules, '/private/x')).toBe(true); // the * group does not apply to us
  });

  it('falls back to the wildcard group', () => {
    const rules = parseRobots(robots, 'SomeOtherBot');
    expect(pathAllowed(rules, '/private/secret')).toBe(false);
    expect(pathAllowed(rules, '/about')).toBe(true);
  });

  it('lets the longest matching rule win, with Allow beating Disallow on ties', () => {
    const rules = parseRobots(robots, 'SomeOtherBot');
    expect(pathAllowed(rules, '/private/public-page')).toBe(true);
  });

  it('supports wildcards and end anchors', () => {
    const rules = parseRobots(robots, 'SomeOtherBot');
    expect(pathAllowed(rules, '/docs/report.pdf')).toBe(false);
    expect(pathAllowed(rules, '/docs/report.pdf.html')).toBe(true);
  });

  it('allows everything when there is no robots.txt content', () => {
    expect(pathAllowed(parseRobots('', 'PressDossierBot'), '/anything')).toBe(true);
  });
});
