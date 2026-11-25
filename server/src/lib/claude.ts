import Anthropic from '@anthropic-ai/sdk';
import { isDemo } from '../demo/limits';
import { HttpError } from './httpError';

/** The Claude model used for every AI step. Override with ANTHROPIC_MODEL. */
export const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-4-8';

/**
 * In the demo one counted call must be one request, so the SDK's automatic retries are off there.
 * Created per use so it always reflects the current environment; construction is cheap.
 */
export function claudeClient(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: isDemo() ? 0 : 2, timeout: 60_000 });
}

/** Input caps keep every prompt under this; it is the backstop on what one call can cost. */
export const MAX_PROMPT_CHARS = 150_000;

export function assertPromptSize(prompt: string): string {
  if (prompt.length > MAX_PROMPT_CHARS) {
    throw new HttpError(413, 'There is too much text to send to the AI. Shorten the company profile, brief or journalist notes.');
  }
  return prompt;
}
