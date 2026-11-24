import { describe, expect, it } from 'vitest';
import { allowedOrigins, isOriginAllowed } from '../src/lib/cors';

describe('CORS origins', () => {
  it('always allows the local dev servers', () => {
    const list = allowedOrigins(undefined);
    expect(isOriginAllowed('http://localhost:5173', list)).toBe(true);
  });

  it('accepts several comma-separated origins and ignores trailing slashes and spaces', () => {
    const list = allowedOrigins(' https://app.example.com/ , https://preview.example.com ');
    expect(isOriginAllowed('https://app.example.com', list)).toBe(true);
    expect(isOriginAllowed('https://preview.example.com/', list)).toBe(true);
  });

  it('rejects unknown browser origins but allows requests with no Origin header', () => {
    const list = allowedOrigins('https://app.example.com');
    expect(isOriginAllowed('https://evil.example.net', list)).toBe(false);
    expect(isOriginAllowed('https://app.example.com.evil.net', list)).toBe(false);
    expect(isOriginAllowed(undefined, list)).toBe(true);
  });
});
