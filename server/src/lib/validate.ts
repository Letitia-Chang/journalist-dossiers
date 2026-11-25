import type { Request, Router } from 'express';
import type { z } from 'zod';
import { formatIssues } from './companyProfile';
import { HttpError } from './httpError';

const INT4_MAX = 2147483647;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CHECKS = {
  int: (v: string) => /^[1-9]\d{0,9}$/.test(v) && Number(v) <= INT4_MAX,
  uuid: (v: string) => UUID.test(v),
  slug: (v: string) => /^[\w-]{1,60}$/.test(v),
  token: (v: string) => /^[0-9a-f]{48}$/.test(v),
};

/** Reject malformed path parameters before any handler or query sees them. */
export function validateParams(router: Router, params: Record<string, keyof typeof CHECKS>): void {
  for (const [name, kind] of Object.entries(params)) {
    router.param(name, (_req, _res, next, value) => {
      next(CHECKS[kind](String(value)) ? undefined : new HttpError(404, 'Not found'));
    });
  }
}

/** Validate a JSON body. Throws a 400 that names the offending fields. */
export function parseBody<T extends z.ZodType>(schema: T, req: Request): z.infer<T> {
  const parsed = schema.safeParse(req.body ?? {});
  if (parsed.success) return parsed.data;
  const fields = formatIssues(parsed.error);
  const [first, message] = Object.entries(fields)[0];
  throw new HttpError(400, first === '_' ? message : `${first}: ${message}`, fields);
}
