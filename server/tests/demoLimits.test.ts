import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { limitMessage, liveAiStatus, resetLimits, takeLiveAi } from '../src/demo/limits';

const HOUR = 60 * 60 * 1000;

describe('demo live-AI limits', () => {
  beforeEach(() => {
    process.env.DEMO_MODE = 'true';
    process.env.DEMO_AI_PER_HOUR = '3';
    process.env.DEMO_AI_PER_DAY = '5';
    resetLimits();
  });
  afterEach(() => {
    delete process.env.DEMO_MODE;
    delete process.env.DEMO_AI_PER_HOUR;
    delete process.env.DEMO_AI_PER_DAY;
  });

  it('is unlimited outside demo mode', () => {
    delete process.env.DEMO_MODE;
    expect(takeLiveAi('a', 1000)).toBe(1000);
    expect(liveAiStatus('a').remaining).toBe(Infinity);
  });

  it('grants up to the hourly limit per visitor, then refuses', () => {
    const t = Date.UTC(2026, 0, 1, 12);
    expect(takeLiveAi('a', 1, t)).toBe(1);
    expect(takeLiveAi('a', 1, t)).toBe(1);
    expect(takeLiveAi('a', 1, t)).toBe(1);
    expect(takeLiveAi('a', 1, t)).toBe(0);
    expect(liveAiStatus('a', t)).toEqual({ remaining: 0, limit: 'hour' });
  });

  it('grants a partial batch when fewer calls remain than requested', () => {
    expect(takeLiveAi('a', 10, 0)).toBe(3);
  });

  it('tracks visitors independently', () => {
    takeLiveAi('a', 3, 0);
    expect(takeLiveAi('b', 1, 0)).toBe(1);
  });

  it('uses a rolling window: calls expire after an hour', () => {
    takeLiveAi('a', 3, 0);
    expect(takeLiveAi('a', 1, HOUR - 1)).toBe(0);
    expect(takeLiveAi('a', 1, HOUR + 1)).toBe(1);
  });

  it('enforces the server-wide daily cap across visitors', () => {
    const t = Date.UTC(2026, 0, 1, 12);
    expect(takeLiveAi('a', 3, t)).toBe(3);
    expect(takeLiveAi('b', 3, t)).toBe(2); // only 2 left of the 5/day
    expect(liveAiStatus('c', t)).toEqual({ remaining: 0, limit: 'day' });
    expect(takeLiveAi('c', 1, t + 24 * HOUR)).toBe(1); // next UTC day
  });

  it('explains which limit was hit', () => {
    expect(limitMessage({ remaining: 0, limit: 'hour' })).toMatch(/3 runs per hour/);
    expect(limitMessage({ remaining: 0, limit: 'day' })).toMatch(/today/);
  });
});
