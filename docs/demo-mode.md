# Demo mode

`DEMO_MODE=true` makes the app safe to put on the public internet as a showcase.

## What changes

| Area | Behaviour in demo mode |
|---|---|
| Data | Each visitor gets a **private sandbox** when they enter: their own organization, seeded with the same fictional company. Sandboxes are deleted after `DEMO_SANDBOX_HOURS` (default 24). At 300, the oldest make room, but none younger than an hour; if all are, the demo says it is full. `npm run demo:reset` deletes them all. |
| Company | **Lumen Grid**, a fictional climate-tech startup with a complete profile, 10 fictional journalists at 8 fictional outlets, made-up articles, finished dossiers, one sample pitch each, outreach history and a coverage item. Every URL and email is on `example.com`. |
| Access | "Enter the demo" creates the sandbox and signs the visitor in as its **member** (no password). Sign-up, password login and invites are off. New sandboxes and writes are limited per visitor, per network and overall. |
| Banner | "Demo data — fictional" is always visible. |
| Live AI | Per-visitor limit per clock hour (`DEMO_AI_PER_HOUR`, default 5) and a server-wide daily cap (`DEMO_AI_PER_DAY`, default 150). Over the limit, scoring returns the saved analysis; with nothing saved it returns a friendly 429. Draft generation and regeneration share the budget. |
| Gmail | Disabled. "Create Gmail Drafts" opens a preview of the drafts and explains it works when self-hosted. |
| Web discovery | Disabled (RSS/blog/staff-page scanning, health checks, AI publication suggestions). |

## Safety

- The demo **refuses to start on a database that contains a real organization**, and only ever deletes sandboxes (and, once, the shared organization older versions seeded).
- Visitors cannot see each other's changes, and sandboxes survive a restart.
- Limits are counted in Postgres with atomic row locks, so a restart can't reset them and several instances share them. Visitors are identified by a keyed hash of their IP (IPv6: their /64); the address itself is never stored. If the counter can't be read, the live call is refused.
- Every stored field, typed or discovered, has a length cap and every prompt a size cap, which bounds what one live call can cost.
- `trust proxy` is enabled so per-visitor limits use the real client IP behind a proxy.

## Running it

```bash
DEMO_MODE=true ANTHROPIC_API_KEY=… DATABASE_URL=… npm run dev --prefix server
```

Use a dedicated database for the demo.
