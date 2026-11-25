import type { ErrorRequestHandler } from 'express';

/** An error whose message is safe to show to the client. */
export class HttpError extends Error {
  constructor(public status: number, message: string, public fields?: Record<string, string>) {
    super(message);
  }
}

/** Postgres errors caused by the request rather than by us, with a message that leaks nothing. */
const PG_ERRORS: Record<string, [number, string]> = {
  '22P02': [400, 'Invalid value'], // malformed integer, uuid, …
  '22003': [400, 'Number out of range'],
  '22007': [400, 'Invalid date'],
  '22008': [400, 'Invalid date'],
  '22009': [400, 'Invalid date'],
  '22021': [400, 'Invalid characters in text'],
  '22P05': [400, 'Invalid characters in text'],
  '40P01': [503, 'The server is busy. Please try again.'],
  '23502': [400, 'A required value is missing'],
  '23503': [400, 'That refers to something that does not exist'],
  '23505': [409, 'That already exists'],
  '23514': [400, 'Value not allowed'],
};

/**
 * Last middleware. Maps known errors to a client status and hides the details of everything else.
 * Express 5 forwards rejected async handlers here, so a failing query is a 4xx/5xx, never a crash.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    console.error('[error after response]', req.method, req.path, err);
    return next(err);
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, ...(err.fields ? { fields: err.fields } : {}) });
    return;
  }
  const pg = typeof err?.code === 'string' ? PG_ERRORS[err.code] : undefined;
  if (pg) {
    res.status(pg[0]).json({ error: pg[1] });
    return;
  }
  // Postgres is unreachable or every connection is in use.
  if (/timeout exceeded when trying to connect|Connection terminated|ECONNREFUSED/.test(String(err?.message))) {
    console.error('[db] unavailable:', err.message);
    res.status(503).json({ error: 'The server is busy. Please try again.' });
    return;
  }
  // body-parser and the router set a 4xx status on malformed JSON, oversized bodies and bad URLs.
  const status = Number(err?.status ?? err?.statusCode);
  if (status >= 400 && status < 500) {
    const message = status === 413 ? 'Request is too large' : err?.type === 'entity.parse.failed' ? 'Malformed JSON' : 'Bad request';
    res.status(status).json({ error: message });
    return;
  }
  console.error('[error]', req.method, req.path, err);
  res.status(500).json({ error: 'Internal server error' });
};
