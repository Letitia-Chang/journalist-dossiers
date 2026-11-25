const DEV_ORIGINS = ['http://localhost:5173', 'http://localhost:5174'];

/**
 * Browser origins allowed to call the API: the local dev servers plus FRONTEND_URL,
 * which may hold several comma-separated origins (for example a production URL and a
 * preview URL). Trailing slashes are ignored.
 */
export function allowedOrigins(frontendUrl: string | undefined = process.env.FRONTEND_URL): string[] {
  return [...DEV_ORIGINS, ...configuredOrigins(frontendUrl)];
}

function configuredOrigins(frontendUrl: string | undefined): string[] {
  return (frontendUrl ?? '')
    .split(',')
    .map(o => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

/** Where links to the app point: the first FRONTEND_URL origin. */
export function appUrl(frontendUrl: string | undefined = process.env.FRONTEND_URL): string {
  return configuredOrigins(frontendUrl)[0] ?? DEV_ORIGINS[0];
}

/** Requests with no Origin header (curl, server-to-server) are allowed; browsers must match. */
export function isOriginAllowed(origin: string | undefined, allowed: string[]): boolean {
  if (!origin) return true;
  return allowed.includes(origin.replace(/\/+$/, ''));
}
