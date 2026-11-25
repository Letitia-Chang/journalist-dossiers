# Demo mode

`DEMO_MODE=true` makes the app safe to put on the public internet as a showcase.

## What changes

| Area | Behaviour in demo mode |
|---|---|
| Data | Wiped and reseeded on boot and every `DEMO_RESET_HOURS` (default 6). `npm run demo:reset` does it on demand. |
| Company | **Lumen Grid**, a fictional climate-tech startup with a complete profile, 10 fictional journalists at 8 fictional outlets, made-up articles, finished dossiers, one sample pitch each, outreach history and a coverage item. Every URL and email is on `example.com`. |
| Access | "Enter the demo" signs in as a seeded **member** (no password). Maintainers can still sign in below it. |
| Banner | "Demo data — fictional" is always visible. |
| Live AI | Per-visitor limit per clock hour (`DEMO_AI_PER_HOUR`, default 5) and a server-wide daily cap (`DEMO_AI_PER_DAY`, default 150). Over the limit, scoring returns the saved analysis; with nothing saved it returns a friendly 429. Draft generation and regeneration share the budget. |
| Gmail | Disabled. "Create Gmail Drafts" opens a preview of the drafts and explains it works when self-hosted. |
| Web discovery | Disabled (RSS/blog/staff-page scanning, health checks, AI publication suggestions). |

## Safety

- The reset **refuses to run if the database contains any organization other than the demo one**, so setting `DEMO_MODE` against a real database cannot wipe it.
- The demo uses fixed IDs, so a visitor's session stays valid across reseeds.
- Limits are counted in Postgres with atomic row locks, so a restart can't reset them and several instances share them. Visitors are identified by a keyed hash of their IP (IPv6: their /64); the address itself is never stored. If the counter can't be read, the live call is refused.
- Every stored field has a length cap and every prompt a size cap, which bounds what one live call can cost.
- `trust proxy` is enabled so per-visitor limits use the real client IP behind a proxy.

## Running it

```bash
DEMO_MODE=true ANTHROPIC_API_KEY=… DATABASE_URL=… npm run dev --prefix server
```

Use a dedicated database for the demo.
