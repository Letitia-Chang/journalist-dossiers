import { google } from 'googleapis';
import pool from '../db';

function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/auth/google/callback',
  );
}

export async function getAuthedGmailClient() {
  const row = (await pool.query(`SELECT value FROM settings WHERE key = 'gmail_refresh_token'`)).rows[0];
  if (!row?.value) throw new Error('Gmail not connected. Connect via Settings first.');

  const auth = getOAuthClient();
  auth.setCredentials({ refresh_token: row.value });
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

export async function createGmailDraft(to: string, subject: string, body: string): Promise<string> {
  const gmail = await getAuthedGmailClient();
  const raw = makeMimeMessage(to, subject, body);
  const result = await gmail.users.drafts.create({
    userId: 'me',
    requestBody: { message: { raw } },
  });
  return result.data.id || '';
}
