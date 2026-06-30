# Maintenance Guide

## What's automated

All background jobs run on **Mondays at 6am ET** so the team starts each week with fresh data:

| Job | What it does |
|---|---|
| RSS article refresh | Fetches new articles from all active publication feeds |
| Publication health check | Checks RSS feed reachability, flags unreachable ones |
| AI publication suggestions | Claude suggests new publications to consider tracking |

Alerts for stale journalists and unreachable publications appear on the Dashboard automatically.

## What needs manual attention

| Task | How often | Where |
|---|---|---|
| Review journalist suggestions | Weekly | RSS Suggestions (Admin) |
| Review publication suggestions | Weekly | Publications (Admin) — amber banner |
| Log outreach after every contact | After each pitch | Journalist profile → Outreach tab |
| Add press coverage | When articles appear | Press Coverage page |
| Enrich emails via Apollo | When new journalists added | Journalists list → "Find emails via Apollo" |
| Update journalist notes / beat | When they change roles | Journalist profile → Edit |
| Update House Style | When tone/approach changes | House Style (Admin) |

## Understanding RSS feed statuses

Each publication in the Publications admin shows one of four feed statuses:

| Status | Meaning |
|---|---|
| 🟢 **Active** | At least one feed URL is working and returning articles |
| 🔴 **Failed** | Feed URL(s) were saved but none are responding (404, 403, or timeout) |
| ✖ **No RSS** | No feeds saved and auto-discovery found nothing |
| 🟡 **Unknown** | Publication was just added — discovery hasn't run yet |

### What to do when a feed shows Failed

**Failed** means a feed URL was saved at some point but is now broken. This happens when a site changes its RSS structure or moves behind a paywall.

**Step 1 — Hover the Failed badge.** A tooltip will appear with an AI-generated explanation of why it failed and a specific next step (e.g. a URL to try, or a recommendation to add journalists manually).

**Step 2 — Run Sync Feeds.** Click the "Sync Feeds" button in the Publications toolbar. This re-runs discovery on all publications and automatically removes broken feeds that have no working replacement. If new feed URLs are found, they'll be saved and verified.

**Step 3 — Manually fix the feed URL** (if Sync Feeds doesn't help). Click the feed count to expand the feeds panel, delete the broken feed (✕ button), then paste a new URL in the "Add feed" field. To find the right URL:
- Visit the publication's website and look for an RSS icon
- Try appending `/feed`, `/rss`, or `/feed.xml` to the section URL (e.g. `https://techcrunch.com/category/artificial-intelligence/feed/`)
- Check the AI tooltip — it often suggests a specific URL to try

**Step 4 — Deactivate if no public RSS exists.** Some publications (Bloomberg, WSJ, Boston Globe, Beehiiv newsletters) don't offer public RSS feeds. Toggle the publication off (Active switch) and add journalists from that outlet manually instead.

## Keeping the system healthy

- **Stale journalists** — if a journalist hasn't had new articles in 30+ days, they'll be flagged on the dashboard. Check if they've changed beats or left the publication.
- **Failed feeds** — click "Sync Feeds" in the Publications toolbar to re-run discovery and verification across all publications at once. Do this whenever you notice several Failed statuses.
- **Score freshness** — scores are generated once when a journalist is accepted. If their beat changes significantly, use "Re-score with Claude" on the Journalists list.

## Pushing updates to GitHub

After any session of changes:

```bash
git add -A
git commit -m "describe what changed"
git push
```

GitBook will automatically update the public docs site when changes are pushed to the `main` branch.

Railway (backend) and Netlify (frontend) also auto-deploy on every push to `main`.
