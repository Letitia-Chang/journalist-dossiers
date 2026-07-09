# Journalist Dossiers — Claude Context

This file gives Claude persistent context across sessions. Update it whenever the system architecture, conventions, or key decisions change.

---

## What this system is

A multi-tenant SaaS journalist CRM. Each organization tracks its own AI/tech journalists, manages its own outreach campaigns, and discovers its own publications to pitch to — every table is scoped by `org_id`, and orgs cannot see each other's data. Auth is email/password + JWT, with owner/admin/member roles gating settings and team management.

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React + TypeScript + Vite (port 5173) |
| Backend | Express + TypeScript (port 3001) |
| Database | PostgreSQL via `pg`, connected via `DATABASE_URL` |
| Migrations | `node-pg-migrate` — files in `server/migrations/`, run with `npm run migrate:up` |
| Auth | Email/password (`bcrypt`) + JWT (`jsonwebtoken`), 7-day tokens, org-scoped |
| Styling | Tailwind CSS v3 with custom `northstar` indigo palette |
| AI | Anthropic Claude Opus 4.8 with `thinking: { type: 'adaptive' }` |
| Node | v20 — use `~/.nvm/versions/node/v20.20.0/bin/node` |

**Important:** `verbatimModuleSyntax: true` in tsconfig — always use `import type` for type-only imports.

**Bash prefix:** Always prepend `CLAUDE_CODE_TMPDIR=/tmp` to bash commands (ENOSPC workaround on this machine).

---

## Running the project

```bash
# Backend (from /server)
npm run dev            # runs on :3001
npm run migrate:up      # apply pending migrations

# Frontend (from /client)
npm run dev             # runs on :5173
```

---

## Project structure

```
journalist-dossiers/
├── client/src/
│   ├── pages/                 # One file per route/page
│   ├── components/            # Shared UI components
│   ├── context/AuthContext.tsx # JWT/org/user auth state
│   ├── api.ts                 # All API calls (axios, attaches Bearer token)
│   └── types.ts               # Shared TypeScript interfaces
├── server/src/
│   ├── routes/                 # Express routers (one per resource, all org-scoped)
│   ├── services/                # AI calls, RSS/discovery, Gmail, scoring
│   ├── middleware/auth.ts       # JWT sign/verify, requireAuth, requireRole
│   ├── db.ts                    # PostgreSQL pool
│   └── index.ts                 # Express app + route registration
├── server/migrations/            # node-pg-migrate schema migrations
├── docs/                         # Project documentation (synced to GitBook)
└── CLAUDE.md                     # This file
```

---

## Database schema (key tables)

All tables below are scoped by `org_id` (FK to `organizations`) except `organizations` itself.

| Table | Purpose |
|---|---|
| `organizations` | Tenant record: name, slug, `company_description`, `target_verticals`, `tier_thresholds` |
| `users` | Org members: email, password_hash, role (`owner`/`admin`/`member`) |
| `invites` | Pending team invites: email, role, token, 7-day expiry |
| `scoring_dimensions` | Per-org custom scoring dimensions: name, description, weight, display_order |
| `journalists` | Journalist profiles: name, contact fields, beats, bio, `total_score` |
| `journalist_scores` | Per-journalist, per-dimension score (sums to `journalists.total_score`) |
| `articles` | Articles written by journalists |
| `outreach_logs` | Every pitch/contact logged — the journalist's current outreach status is read live from the latest row here |
| `publications` | Target outlets (tier A/B/C) |
| `publication_feeds` | RSS feeds per publication |
| `publication_suggestions` | AI-suggested publications pending review |
| `journalist_suggestions` | RSS/staff-page-discovered journalists pending review |
| `campaigns` | Outreach campaigns |
| `campaign_journalists` | Many-to-many: campaigns ↔ journalists + draft + `gmail_draft_id` |
| `campaign_type_styles` | House style instructions per campaign type |
| `coverage` | Press articles written about the org |
| `gmail_connections` | One per org: refresh token for the org's connected Gmail account |

**Migration pattern:** Add a new file under `server/migrations/` (via `npm run migrate:create -- <name>`) rather than editing an applied migration.

---

## Key conventions

### Scoring — fully configurable per org
There is no fixed set of scoring dimensions or point values. Each org defines its own dimensions (name, description, weight) on the Scoring Dimensions admin page. A journalist's total score is the sum of their per-dimension scores. The UI recommends — but does not enforce — that weights sum to 100 so totals read as a percentage.

AI scoring (`server/src/services/journalistScoring.ts`, Claude Opus 4.8) uses the org's `company_description` + `target_verticals` plus its scoring dimensions, and only runs if the org has defined at least one dimension.

There is no journalist tier concept (Tier 1–4) in the current system — it was part of the old fixed-scoring design and was removed.

### Publication tiers
- **A**: Major Tech & AI (TechCrunch, Wired, MIT Tech Review)
- **B**: Business / Mid-tier (Forbes, Fast Company, Bloomberg Tech)
- **C**: Regional & Niche (Hypepotamus, local outlets, newsletters)

### Outreach status flow
`Not Started` (default, no logs) → `Ready to Pitch` / `Pitched` / `Responded` / `No Response` / `Covered` / `Declined` — all set manually by choosing a "Resulting status" when logging any outreach entry. The journalist's displayed status is always just the most recent log's status; there's no separate sync step.

---

## Auth & roles

- JWT payload: `{ sub: userId, orgId, role }`, signed with `SESSION_SECRET`, 7-day expiry (`server/src/middleware/auth.ts`)
- `requireAuth` populates `req.userId` / `req.orgId` / `req.userRole` from the Bearer token
- `requireRole('owner', 'admin')` gates editor-level routes; `requireRole('owner')` gates team management and Gmail connect/disconnect
- Roles: **owner** (everything, plus team + Gmail), **admin** (everything except team + Gmail), **member** (read-only)
- Invites are a shareable link with a 7-day token — no email is sent automatically; the owner shares the link themselves

---

## API conventions

- Base URL: `http://localhost:3001/api`
- All responses are JSON; auth via `Authorization: Bearer <jwt>`
- Errors return `{ error: string }` with appropriate HTTP status
- Background jobs respond immediately with `{ message: '...' }` then run async

### Route order matters (Express)
Specific routes before parameterised ones — e.g. in `publications.ts`, `/discover`, `/import-opml`, `/check-feeds`, `/sync-feeds`, and `/health-summary` are all declared before `/:id`.

---

## AI integrations

### Claude (Anthropic)
- Model: `claude-opus-4-8` with `thinking: { type: 'adaptive' }`
- Used for: journalist scoring (`server/src/services/journalistScoring.ts`), campaign draft generation (`server/src/services/campaignDraftService.ts`), publication discovery suggestions (`server/src/services/publicationSuggestionService.ts`)
- House style injected into every draft prompt from `campaign_type_styles` table

### Gmail (per-org OAuth)
- `server/src/routes/googleAuth.ts` + `server/src/services/gmailService.ts`
- Scope is `gmail.compose` only — this app can create Gmail drafts, it cannot send mail
- Owner-only to connect/disconnect; refresh token stored per-org in `gmail_connections`
- Campaign drafts are pushed into Gmail as real drafts via `POST /api/campaigns/:id/create-gmail-drafts`; the actual send is always a manual action in Gmail

There is no Apollo or SerpAPI integration anywhere in this app — contact enrichment via a third party was explicitly ruled out and is not planned. Contact info comes from manual entry or from what RSS/staff-page scans surface.

---

## Blog / publication discovery

Three sources queried in parallel via `Promise.allSettled`:
1. **Feedly** — `GET https://cloud.feedly.com/v3/search/feeds` (no auth)
2. **Substack** — `GET https://substack.com/api/v1/search` (no auth)
3. **Medium** — RSS tag feeds derived from query keywords

File: `server/src/services/blogDiscovery.ts`. Triggered manually via `POST /api/publications/discover` — not scheduled.

---

## Discovery & automation jobs — all manual, no cron

There is no scheduled job in this app — the old cron setup (Friday/weekly jobs) was removed in the multi-tenant rebuild. Every discovery/automation feature below is triggered by a button click, which returns immediately and runs the work in the background:

| Job | Trigger | Endpoint |
|---|---|---|
| RSS scan — all publications | "Scan All Feeds" (RSS Suggestions) | `POST /api/journalist-suggestions/scan-all` |
| RSS scan / staff-page scan — one publication | Publication detail page | `POST /api/journalist-suggestions/scan/:id` or `/staff-scan/:id` |
| Sync Feeds (discover + verify) | Publications admin | `POST /api/publications/sync-feeds` |
| Publication health check | Publications admin | `POST /api/publications/check-feeds` |
| AI publication suggestions | Publications admin | `POST /api/suggestions/run-now` |
| Blog/publication search, OPML import | Publications admin | `POST /api/publications/discover`, `/import-opml` |

Accepting a journalist or publication suggestion also triggers work automatically (AI scoring, feed discovery respectively) — see `SystemInfoPage.tsx` for the full list of automatic triggers.

---

## Security constraints (non-negotiable)

- Do NOT scrape websites or automate email sending
- Do NOT guess private email addresses
- Do NOT integrate a third-party contact-enrichment API (Apollo, SerpAPI, etc.) — explicitly out of scope
- Only use public professional contact info entered manually or surfaced by RSS/staff-page scans
- All AI/RSS suggestions require human approval before being added
- All outreach must be human-reviewed — no automated sending (Gmail integration creates drafts only, via the `gmail.compose` scope)
- Never commit API keys or `.env` files

---

## Sidebar navigation

**Main:** Dashboard · Journalists · Campaigns · Activity Feed · Press Coverage

**Admin:** Scoring Dimensions · Publications · RSS Suggestions · House Style · Export Data · Team · System Info

---

## Pages and routes

| Route | Page | Purpose |
|---|---|---|
| `/login` | LoginPage | Email/password sign-in |
| `/signup` | SignupPage | Create a new org + owner account |
| `/accept-invite/:token` | AcceptInvitePage | Accept a team invite, create account |
| `/dashboard` | Dashboard | Stats, campaign pipeline, alerts |
| `/journalists` | JournalistsList | Filterable list, pipeline view |
| `/journalists/:id` | JournalistDetail | Profile, scores, outreach history, "Score with AI" |
| `/journalists/new` | JournalistForm | Add / edit journalist |
| `/campaigns` | CampaignList | All campaigns with status |
| `/campaigns/:id` | CampaignDetail | Journalist picker, draft review, Gmail draft creation |
| `/campaigns/styles` | CampaignStyles | House style instructions per campaign type |
| `/activity` | ActivityFeed | Chronological outreach log across all journalists |
| `/coverage` | CoveragePage | Track press articles written about the org |
| `/export` | ExportPage | CSV export of journalists / articles / outreach |
| `/admin/scoring-dimensions` | ScoringDimensions | Define the org's custom scoring dimensions |
| `/admin/publications` | AdminPublications | Manage publications, feeds, discovery |
| `/admin/publications/:id` | PublicationDetail | Journalists at a specific publication |
| `/admin/journalist-suggestions` | AdminJournalistSuggestions | Review RSS/staff-page-discovered journalists |
| `/team` | TeamPage | Manage members, roles, and invites |
| `/system` | SystemInfoPage | This system's own behavior, documented in-app |

---

## Deployment plan (future)

- Frontend: Netlify
- Backend: Railway
- Database: Railway-managed PostgreSQL
- Currently running fully local

---

## Last updated

2026-07-08 — Multi-tenant SaaS rebuild: org-scoped auth (JWT + roles), configurable per-org scoring dimensions replacing the fixed 6-dimension model, all cron jobs replaced with manual-trigger buttons, Apollo/SerpAPI enrichment removed entirely, per-org Gmail draft integration added, team invites added.
