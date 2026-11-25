# Deployment

The reference setup, and the one the public demo runs on, is:

| Part | Host | Why |
|---|---|---|
| Client (static SPA) | **Vercel** | Free, global CDN, SPA rewrites |
| API (Node) | **Render** web service | Free tier, `render.yaml` blueprint |
| Database | **Neon** Postgres | Free, persistent, standard Postgres |

Any Node host and any Postgres will do; the API is a plain Express app that reads its configuration from environment variables.

## 1. Database (Neon)

1. Create a project at [neon.tech](https://neon.tech).
2. Copy the **direct** (non-pooled) connection string, ending in `?sslmode=require`. Use the direct one: migrations take advisory locks, which don't work through a transaction-mode pooler.
3. That string is your `DATABASE_URL`. Migrations run automatically when the API starts.

Neon's free tier suspends idle databases and wakes them on the next query (about a second).

## 2. API (Render)

1. Render dashboard → **New → Blueprint**, select the repository. It reads [`render.yaml`](../render.yaml).
2. Fill in the three values marked `sync: false`:
   - `DATABASE_URL`: from step 1
   - `ANTHROPIC_API_KEY`: from [console.anthropic.com](https://console.anthropic.com). Set a monthly spend limit there too.
   - `FRONTEND_URL`: your Vercel URL from step 3 (you can set a placeholder now and update it after)
3. Apply. `SESSION_SECRET` is generated for you. Note the service URL (for example `https://press-dossier-api.onrender.com`) and check `<url>/api/health`.

The blueprint sets `DEMO_MODE=true`. See [demo-mode.md](demo-mode.md) for what that changes; remove it for a real deployment.

**Memory:** the production build uses about 130–160 MB resident, including after a live Claude call, comfortably inside the free tier's 512 MB.

**Sleeping:** the free service sleeps after 15 minutes without traffic. The client detects this and shows "Waking up the server…", retrying with backoff for about two minutes, so a visitor just waits.

## 3. Client (Vercel)

1. **New Project**, import the repository.
2. Set **Root Directory** to `client`. Vercel detects Vite (build `npm run build`, output `dist`); `client/vercel.json` adds the SPA rewrite.
3. Add the environment variable `VITE_API_URL` = `https://<your-render-service>.onrender.com/api`.
4. Deploy, then put the resulting URL into `FRONTEND_URL` on Render (several origins can be comma-separated, for example production and a preview URL) and restart the API.

Open the site. You should see the "Enter the demo" screen.

## Self-hosting for real use

- Don't set `DEMO_MODE`. Visit the app to run the setup wizard, or set `ADMIN_EMAIL` / `ADMIN_PASSWORD` and a `company.config.json` (see [configuration.md](configuration.md)).
- Use a **persistent Postgres** with backups. The demo database is disposable because it reseeds itself.
- Serve over **HTTPS** and set `FRONTEND_URL` to the exact browser origin.
- For Gmail drafts, add your API origin's callback to the Google OAuth client: `https://<api-host>/auth/google/callback`, and set `GOOGLE_REDIRECT_URI` to match. The Gmail refresh token is stored unencrypted in the database, so use encryption at rest.
- Set `BOT_NAME` and `BOT_CONTACT_URL` so publishers can see who is crawling them.
- `TRUST_PROXY=true` if the API sits behind a reverse proxy. If a CDN sits in front of that proxy (Render is fronted by Cloudflare), `req.ip` is the CDN's edge address, so also set `CLIENT_IP_HEADER` (the blueprint sets `cf-connecting-ip`); otherwise the demo's per-visitor limits can't tell visitors apart.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Browser console shows a CORS error | `FRONTEND_URL` doesn't exactly match the site's origin (scheme, host, no path) |
| "Can't reach the server" after the retries | `VITE_API_URL` is wrong, or the API failed to boot; check Render logs |
| API exits at boot with `Invalid …company.config.json` | The config file failed validation; the message names the fields |
| API exits with "DEMO_MODE refuses to wipe a database…" | `DEMO_MODE` is on but the database contains a real organization; use a dedicated database |
| Migrations hang | You're using a pooled connection string; use the direct one |
