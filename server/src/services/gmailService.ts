import { google } from 'googleapis';
import pool from '../db';

function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/auth/google/callback',
  );
}

export async function getAuthedGmailClient(orgId: string) {
  const { rows: [conn] } = await pool.query(
    'SELECT refresh_token FROM gmail_connections WHERE org_id = $1', [orgId],
  );
  if (!conn) return null;

  const auth = getOAuthClient();
  auth.setCredentials({ refresh_token: conn.refresh_token });
  return google.gmail({ version: 'v1', auth });
}

function makeMimeMessage(to: string, subject: string, body: string): string {
  const lines = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    body,
  ];
  return Buffer.from(lines.join('\r\n')).toString('base64url');
}

export async function createGmailDraft(
  gmail: NonNullable<Awaited<ReturnType<typeof getAuthedGmailClient>>>,
  to: string, subject: string, body: string,
): Promise<string> {
  const raw = makeMimeMessage(to, subject, body);
  const result = await gmail.users.drafts.create({
    userId: 'me',
    requestBody: { message: { raw } },
  });
  return result.data.id || '';
}
