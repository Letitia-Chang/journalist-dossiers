import { HttpError } from './httpError';

/** The Claude model used for every AI step. Override with ANTHROPIC_MODEL. */
export const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-4-8';

/** Input caps keep real prompts well under this; it is the backstop on what one call can cost. */
export const MAX_PROMPT_CHARS = 100_000;

export function assertPromptSize(prompt: string): string {
  if (prompt.length > MAX_PROMPT_CHARS) {
    throw new HttpError(413, 'There is too much text to send to the AI. Shorten the company profile, brief or journalist notes.');
  }
  return prompt;
}
