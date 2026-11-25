import http from 'http';
import type { AddressInfo } from 'net';

export interface ClaudeStub { calls: string[]; fail: boolean; onCall?: () => Promise<void>; close: () => void }

/** A local stand-in for the Claude API, so AI paths run end to end without spending money. */
export async function startClaudeStub(): Promise<ClaudeStub> {
  const stub: ClaudeStub = { calls: [], fail: false, close: () => {} };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', async () => {
      stub.calls.push(body);
      await stub.onCall?.();
      res.setHeader('content-type', 'application/json');
      if (stub.fail) { res.statusCode = 500; res.end('{"type":"error","error":{"type":"api_error","message":"x"}}'); return; }
      const dims = [...body.matchAll(/dimensionId\\": (\d+)/g)].map(m => Number(m[1]));
      const text = dims.length
        ? JSON.stringify({ scores: dims.map(d => ({ dimensionId: d, score: 5, rationale: 'r', evidence: [] })), reasoning: 'ok' })
        : JSON.stringify({ subject: 'New\nsubject', body: 'New body' });
      res.end(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'x', content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }));
    });
  });
  await new Promise<void>(r => { server.listen(0, () => r()); });
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.ANTHROPIC_API_KEY = 'stub';
  stub.close = () => { server.closeAllConnections(); server.close(); };
  return stub;
}
