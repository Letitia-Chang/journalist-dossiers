import { Router } from 'express';
import { google } from 'googleapis';
import pool from '../db';

const router = Router();

function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/auth/google/callback',
  );
}

// GET /auth/google — redirect to Google consent screen
router.get('/google', (_req, res) => {
  const oauth2Client = getOAuthClient();
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/gmail.compose'],
  });
  res.redirect(url);
});

// GET /auth/google/callback — exchange code for tokens and store refresh token
router.get('/google/callback', async (req, res) => {
  const code = req.query.code as string;
  if (!code) return res.status(400).send('Missing code');

  try {
    const oauth2Client = getOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);
    if (!tokens.refresh_token) {
      return res.status(400).send(
        'No refresh token received. If you already granted access, go to https://myaccount.google.com/permissions and revoke access to this app, then try again.'
      );
    }
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ('gmail_refresh_token', $1)
       ON CONFLICT (key) DO UPDATE SET value = $1`,
      [tokens.refresh_token],
    );
    res.send('<script>window.close();</script><p>Gmail connected! You can close this tab.</p>');
  } catch (err: any) {
    res.status(500).send(`OAuth error: ${err.message}`);
  }
});

// GET /auth/gmail/status — check if a refresh token is stored
router.get('/gmail/status', async (_req, res) => {
  const row = (await pool.query(`SELECT value FROM settings WHERE key = 'gmail_refresh_token'`)).rows[0];
  res.json({ connected: !!row?.value });
});

// DELETE /auth/gmail — disconnect Gmail
router.delete('/gmail', async (_req, res) => {
  await pool.query(`DELETE FROM settings WHERE key = 'gmail_refresh_token'`);
  res.json({ ok: true });
});

export default router;
