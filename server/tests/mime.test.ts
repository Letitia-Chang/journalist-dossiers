import { describe, expect, it } from 'vitest';
import { buildMimeMessage, encodeHeader } from '../src/lib/mime';

const decode = (raw: string) => Buffer.from(raw, 'base64url').toString();
const decodeWords = (h: string) => h.replace(/\r\n /g, '').replace(/=\?UTF-8\?B\?([^?]*)\?=/g, (_m, b) => Buffer.from(b, 'base64').toString());

describe('MIME message', () => {
  it('cannot be tricked into extra headers by the subject or the address', () => {
    for (const nl of ['\r\n', '\n', '\r', '\u0000', '\r\n\r\n']) {
      const head = decode(buildMimeMessage(`a@example.com${nl}Cc: x@evil.example`, `Hi${nl}Bcc: leak@evil.example`, 'body')).split('\r\n\r\n')[0].split('\r\n');
      expect(head).toHaveLength(5);
      expect(head.map(h => h.split(':')[0])).toEqual(['To', 'Subject', 'MIME-Version', 'Content-Type', 'Content-Transfer-Encoding']);
    }
  });

  it('keeps plain subjects readable and encodes the rest so they decode exactly', () => {
    expect(encodeHeader('Queue waits hit 4.8 years')).toBe('Queue waits hit 4.8 years');
    for (const s of ['Grid queues — 4.8 años', '電網排隊'.repeat(20), '😀'.repeat(30), `${'a'.repeat(44)}é`]) {
      const h = encodeHeader(s);
      expect(decodeWords(h)).toBe(s);
      expect([...h].every(c => c.charCodeAt(0) < 127)).toBe(true);
      for (const l of h.split('\r\n ')) expect(l.length).toBeLessThanOrEqual(75);
    }
  });

  it('round-trips the body, with lines short enough for mail servers', () => {
    const body = `Hi José,\n\n${'long line — '.repeat(200)}\n\nBest`;
    const [, encoded] = decode(buildMimeMessage('a@example.com', 's', body)).split('\r\n\r\n');
    for (const l of encoded.split('\r\n')) expect(l.length).toBeLessThanOrEqual(76);
    expect(Buffer.from(encoded, 'base64').toString()).toBe(body.replace(/\n/g, '\r\n'));
  });
});
