/** Build an RFC 5322 plain-text message, base64url-encoded as the Gmail API expects. */

/** Headers are lines: collapsing whitespace and control characters is what prevents header injection. */
export function headerLine(value: string): string {
  return [...value].map(c => (c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 ? ' ' : c)).join('').replace(/ {2,}/g, ' ').trim();
}

/** RFC 2047: non-ASCII header text becomes base64 encoded-words of at most 75 characters. */
export function encodeHeader(value: string): string {
  const line = headerLine(value);
  if ([...line].every(c => c.charCodeAt(0) < 127)) return line;
  const words: string[] = [];
  let chunk = '';
  for (const char of line) { // by code point, so no character is split across words
    if (Buffer.byteLength(chunk + char) > 45) { words.push(chunk); chunk = ''; }
    chunk += char;
  }
  words.push(chunk);
  return words.map(w => `=?UTF-8?B?${Buffer.from(w).toString('base64')}?=`).join('\r\n ');
}

export function buildMimeMessage(to: string, subject: string, body: string): string {
  const encodedBody = Buffer.from(body.replace(/\r?\n/g, '\r\n')).toString('base64').replace(/(.{76})/g, '$1\r\n');
  return Buffer.from([
    `To: ${headerLine(to)}`,
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    encodedBody,
  ].join('\r\n')).toString('base64url');
}
