import { Router } from 'express';
import { google } from 'googleapis';
import pool from '../db';
import { requireAuth, requireRole, verifyToken } from '../middleware/auth';
import type { AuthTokenPayload } from '../middleware/auth';

const router = Router();

function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/auth/google/callback',
  );
}

// GET /auth/google — kicks off the consent flow. Reached via a plain browser
// navigation (popup window), so auth comes via a ?token= query param instead
// of an Authorization header.
router.get('/google', (req, res) => {
  const token = req.query.token as string | undefined;
  if (!token) return res.status(401).send('Missing token');

  let payload: AuthTokenPayload;
  try {
    payload = verifyToken(token);
  } catch {
    return res.status(401).send('Invalid or expired session — refresh the page and try again.');
  }
  if (payload.role !== 'owner') {
    return res.status(403).send('Only the organization owner can connect Gmail.');
  }

  const oauth2Client = getOAuthClient();
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/gmail.compose'],
    state: token,
  });
  res.redirect(url);
});

// GET /auth/google/callback — exchange code for tokens, store refresh token for the org.
router.get('/google/callback', async (req, res) => {
  const code = req.query.code as string | undefined;
  const state = req.query.state as string | undefined;
  if (!code || !state) return res.status(400).send('Missing code or state');

  let payload: AuthTokenPayload;
  try {
    payload = verifyToken(state);
  } catch {
    return res.status(401).send('Invalid or expired session — refresh the page and try again.');
  }
  if (payload.role !== 'owner') {
    return res.status(403).send('Only the organization owner can connect Gmail.');
  }

  try {
    const oauth2Client = getOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);
    if (!tokens.refresh_token) {
      return res.status(400).send(
        'No refresh token received. If you already granted access, go to https://myaccount.google.com/permissions, revoke access for this app, then try again.'
      );
    }

    oauth2Client.setCredentials(tokens);
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const profile = await gmail.users.getProfile({ userId: 'me' });

    await pool.query(
      `INSERT INTO gmail_connections (org_id, email, refresh_token, connected_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (org_id) DO UPDATE SET email = $2, refresh_token = $3, connected_by = $4, connected_at = NOW()`,
      [payload.orgId, profile.data.emailAddress, tokens.refresh_token, payload.sub],
    );

    res.send('<script>window.close();</script><p>Gmail connected! You can close this tab.</p>');
  } catch (err: any) {
    res.status(500).send(`OAuth error: ${err.message}`);
  }
});

// GET /auth/gmail/status — normal authenticated XHR call.
router.get('/gmail/status', requireAuth, async (req, res) => {
  const { rows: [row] } = await pool.query(
    'SELECT email FROM gmail_connections WHERE org_id = $1', [req.orgId],
  );
  res.json({ connected: !!row, email: row?.email ?? null });
});

// DELETE /auth/gmail — disconnect, owner only.
router.delete('/gmail', requireAuth, requireRole('owner'), async (req, res) => {
  await pool.query('DELETE FROM gmail_connections WHERE org_id = $1', [req.orgId]);
  res.json({ ok: true });
});

export default router;
