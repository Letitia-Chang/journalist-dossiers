import axios from 'axios';

/** Pull the server's `{ error }` message out of a failed request, or fall back to a default. */
export function apiError(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const msg = (err.response?.data as { error?: unknown } | undefined)?.error;
    if (typeof msg === 'string' && msg) return msg;
  }
  return fallback;
}

/** Field-level validation messages from a 400 response, keyed by field path. */
export function apiFields(err: unknown): Record<string, string> {
  if (axios.isAxiosError(err)) {
    const fields = (err.response?.data as { fields?: unknown } | undefined)?.fields;
    if (fields && typeof fields === 'object') return fields as Record<string, string>;
  }
  return {};
}

export function apiStatus(err: unknown): number | undefined {
  return axios.isAxiosError(err) ? err.response?.status : undefined;
}
