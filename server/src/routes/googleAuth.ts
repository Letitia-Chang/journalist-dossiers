import { Router } from 'express';
import { google } from 'googleapis';
import pool from '../db';
import { currentRole, requireAuth, requireRole, signOAuthState, verifyOAuthState } from '../middleware/auth';
import { blockInDemo } from '../middleware/demo';
import { isDemo } from '../demo/limits';

const router = Router();

function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/auth/google/callback',
  );
}

// POST /auth/google/start — returns the consent URL. The session token stays in the Authorization
// header: it must never appear in a URL, where it would reach logs, history and Google.
router.post('/google/start', requireAuth, requireRole('owner'), blockInDemo, (req, res) => {
  const url = getOAuthClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/gmail.compose'],
    state: signOAuthState(req.userId!, req.orgId!),
  });
  res.json({ url });
});

// GET /auth/google/callback — Google redirects the popup here. Replies in plain text: this route
// reflects errors and is reachable by anyone, so nothing in it may be rendered as HTML.
router.get('/google/callback', blockInDemo, async (req, res) => {
  res.type('text/plain');
  const { code, state } = req.query;
  if (typeof code !== 'string' || typeof state !== 'string') return res.status(400).send('Gmail was not connected. Close this tab and try again.');

  let payload: { sub: string; orgId: string };
  try {
    payload = verifyOAuthState(state);
  } catch {
    return res.status(401).send('This sign-in link expired. Close this tab and connect Gmail again.');
  }
  if ((await currentRole(payload.sub, payload.orgId)) !== 'owner') {
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

    res.send('Gmail connected. You can close this tab.');
  } catch (err: any) {
    console.error('[google] callback failed:', err.message);
    res.status(502).send('Google did not accept the sign-in. Close this tab and try again.');
  }
});

// GET /auth/gmail/status — normal authenticated XHR call.
router.get('/gmail/status', requireAuth, async (req, res) => {
  const { rows: [row] } = await pool.query(
    'SELECT email FROM gmail_connections WHERE org_id = $1', [req.orgId],
  );
  res.json({ connected: !!row, email: row?.email ?? null, demo: isDemo() });
});

// DELETE /auth/gmail — disconnect, owner only.
router.delete('/gmail', requireAuth, requireRole('owner'), async (req, res) => {
  await pool.query('DELETE FROM gmail_connections WHERE org_id = $1', [req.orgId]);
  res.json({ ok: true });
});

export default router;
