import http from 'http';
import type { AddressInfo } from 'net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isAllowedByRobots, parseRobots, pathAllowed } from '../src/lib/http';

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

describe('which rules apply', () => {
  const blocked = (name: string) => !pathAllowed(parseRobots(`User-agent: ${name}\nDisallow: /`, 'PressDossierBot'), '/x');
  it('matches our whole name, ignoring case and version', () => {
    expect(['PressDossierBot', 'pressdossierbot', 'PressDossierBot/2.0', '*'].map(blocked)).toEqual([true, true, true, true]);
    expect(['bot', 'Press', '', 'PressDossierBot2'].map(blocked)).toEqual([false, false, false, false]);
  });
});

describe('when robots.txt cannot be read', () => {
  let server: http.Server;
  let fetches = 0;
  const base = () => `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  beforeAll(() => new Promise<void>(done => {
    server = http.createServer((_req, res) => { fetches++; res.statusCode = 503; res.end(''); }).listen(0, '127.0.0.1', done);
  }));
  afterAll(() => new Promise(done => { server.close(done); }));

  it('a server error or a closed port means no', async () => {
    expect(await isAllowedByRobots(`${base()}/staff`)).toBe(false);
    expect(await isAllowedByRobots(`${base()}/about`)).toBe(false);
    expect(fetches).toBe(1);
    expect(await isAllowedByRobots('http://127.0.0.1:1/staff')).toBe(false);
  });

  it('no robots.txt means yes', async () => {
    const other = http.createServer((_req, res) => { res.statusCode = 404; res.end('Disallow: /'); });
    await new Promise<void>(done => { other.listen(0, '127.0.0.1', done); });
    expect(await isAllowedByRobots(`http://127.0.0.1:${(other.address() as AddressInfo).port}/staff`)).toBe(true);
    await new Promise(done => { other.close(done); });
  });
});
