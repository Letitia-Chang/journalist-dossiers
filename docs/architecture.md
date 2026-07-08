# System Architecture

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React + TypeScript + Vite |
| Backend | Express + TypeScript |
| Database | PostgreSQL (Railway managed) |
| Styling | Tailwind CSS v3 |
| AI | Anthropic Claude Opus 4.8 |
| Profile discovery | SerpAPI (Google Search + Image Search) |
| Email finder | Publication website page fetch (cheerio) |

## Deployment

The system is fully cloud-hosted — no local installation needed for team members.

| Service | Platform | URL |
|---|---|---|
| Frontend | Vercel | https://journalist-dossiers.vercel.app |
| Backend API | Railway | https://journalist-dossiers-production.up.railway.app |
| Database | Railway (PostgreSQL) | Internal — accessed only by the backend |

The frontend is a static React SPA deployed on Vercel. The backend is an Express server on Railway (~$5/month). The PostgreSQL database is a managed Railway add-on.

**Deploy flow:** Push to `main` branch → Vercel and Railway auto-deploy. Use `dev` branch for work in progress; merge to `main` when ready.

## Local development

Requires Node.js v20. Both services must run simultaneously:

```bash
# Backend (from /server)
npm run dev        # runs on :3001

# Frontend (from /client)
npm run dev        # runs on :5173
```

Set `DATABASE_URL` and `SERP_API_KEY` in `server/.env`. The backend connects to the Railway PostgreSQL instance even in local dev.

## Data flow

```
RSS Feeds → RSS Scanner → Journalist Suggestions → (human review) → Journalist Profiles
                                                                            ↓
                                                              Claude AI Scoring (Opus 4.8)
                                                              Email Finder (pub website fetch)
                                                              Photo (SerpAPI image search)
                                                                            ↓
                                                              Campaigns → Claude Drafts → Outreach Logs
```

## External integrations

| Integration | Used for | Cost |
|---|---|---|
| Anthropic Claude Opus 4.8 | Journalist scoring, pitch angle, campaign journalist suggestions, draft generation | Pay-per-token |
| SerpAPI | Finding LinkedIn/MuckRack/Twitter URLs, profile photos | ~100 searches/month free tier; paid plans from $50/month |
| RSS / Feedly / Substack | Publication and journalist discovery | Free |
| Gmail API (Google OAuth 2.0) | Creating Gmail drafts from approved campaign emails | Free (Gmail Compose scope only) |

### Gmail OAuth setup

The Gmail integration uses OAuth 2.0 with offline access to create drafts in the connected Google account. The refresh token is stored in the `settings` table and persists across server restarts.

To connect: open the Email Pack tab in any campaign and click **Connect Gmail**. To revoke access: visit [Google Account Permissions](https://myaccount.google.com/permissions) and remove the app, or use the disconnect option in System Info.

**Scope:** `https://www.googleapis.com/auth/gmail.compose` — allows creating drafts only. The system cannot read, send, or delete emails.

## Key files

| File | Purpose |
|---|---|
| `server/src/db.ts` | PostgreSQL schema, migrations, and seed data |
| `server/src/routes/` | API endpoints (one file per resource) |
| `server/src/services/` | Background jobs, Claude calls, RSS parsing, email finder |
| `server/src/services/emailFinder.ts` | Fetches publication author pages to find emails |
| `server/src/services/journalistAnalysis.ts` | Claude scoring prompt and response parsing |
| `server/src/routes/enrichment.ts` | SerpAPI profile + photo search |
| `client/src/pages/` | One React component per page |
| `client/src/api.ts` | All frontend API calls (uses `VITE_API_URL` env var) |
| `client/src/types.ts` | Shared TypeScript interfaces |
| `CLAUDE.md` | Persistent context for Claude Code across sessions |
| `client/vercel.json` | Vercel SPA rewrite rule and ignored build step config |
| `nixpacks.toml` | Pins Node.js 20 for Railway builds |
| `railway.json` | Railway build and deploy config |
