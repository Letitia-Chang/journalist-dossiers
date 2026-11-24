import { afterEach, describe, expect, it } from 'vitest';
import { clientIp } from '../src/lib/clientIp';

afterEach(() => { delete process.env.CLIENT_IP_HEADER; });

describe('clientIp', () => {
  it('uses req.ip when no header is configured, ignoring any header a client sends', () => {
    expect(clientIp({ ip: '10.0.0.1', headers: { 'cf-connecting-ip': '1.2.3.4' } })).toBe('10.0.0.1');
  });

  it('reads the configured header (case-insensitive name, first value)', () => {
    process.env.CLIENT_IP_HEADER = 'CF-Connecting-IP';
    expect(clientIp({ ip: '172.70.0.9', headers: { 'cf-connecting-ip': '203.0.113.7' } })).toBe('203.0.113.7');
    expect(clientIp({ ip: '172.70.0.9', headers: { 'cf-connecting-ip': '203.0.113.7, 198.51.100.2' } })).toBe('203.0.113.7');
  });

  it('falls back to req.ip when the header is missing or blank, and to "local" with nothing', () => {
    process.env.CLIENT_IP_HEADER = 'cf-connecting-ip';
    expect(clientIp({ ip: '10.0.0.1', headers: {} })).toBe('10.0.0.1');
    expect(clientIp({ ip: '10.0.0.1', headers: { 'cf-connecting-ip': '  ' } })).toBe('10.0.0.1');
    expect(clientIp({ ip: undefined, headers: {} })).toBe('local');
  });
});
