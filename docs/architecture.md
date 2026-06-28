# System Architecture

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React + TypeScript + Vite |
| Backend | Express + TypeScript |
| Database | SQLite (local) |
| Styling | Tailwind CSS v3 |
| AI | Anthropic Claude Opus 4.8 |
| Email enrichment | Apollo People Match API |

## How it runs

Both the frontend (port 5173) and backend (port 3001) run locally on your machine. There is no cloud deployment yet — all data lives in a SQLite file at `data/northstar.db` on your laptop.

## Deployment plan

- **Frontend** → Netlify
- **Backend** → Railway
- **Database** → PostgreSQL (Railway managed, replacing SQLite)

## Data flow

```
RSS Feeds → RSS Scanner → Journalist Suggestions → (human review) → Journalist Profiles
                                                                            ↓
                                                              Claude AI Scoring
                                                                            ↓
                                                              Campaigns → Claude Drafts → Outreach Logs
```

## Key files

| File | Purpose |
|---|---|
| `server/src/db.ts` | Database schema and migrations |
| `server/src/routes/` | API endpoints (one file per resource) |
| `server/src/services/` | Background jobs, Claude calls, RSS parsing |
| `client/src/pages/` | One React component per page |
| `client/src/api.ts` | All frontend API calls |
| `client/src/types.ts` | Shared TypeScript interfaces |
| `CLAUDE.md` | Persistent context for Claude AI across sessions |
