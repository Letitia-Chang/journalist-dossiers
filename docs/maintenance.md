# Maintenance Guide

## What's automated

| Job | Schedule | What it does |
|---|---|---|
| RSS article refresh | Fridays 7am | Fetches new articles from all active publication feeds; updates "last published" dates |
| Publication health check | Weekly | Checks RSS feed reachability, flags unreachable ones |
| AI publication suggestions | Weekly | Claude suggests new publications to consider tracking |

Dashboard alerts appear automatically for stale journalists, overdue follow-ups, and unreachable publications — no manual checks needed to surface these.

## What needs manual attention

| Task | How often | Where |
|---|---|---|
| Review journalist suggestions | Weekly | RSS Suggestions (Admin) |
| Review publication suggestions | Weekly | Publications (Admin) — amber banner |
| Log outreach after every contact | After each pitch | Journalist profile → Outreach tab |
| Add press coverage | When articles appear | Press Coverage page |
| Find social profiles + email | When new journalists added | Journalist profile → Find Profiles (SerpAPI) |
| Run "Find Profiles" for new journalists | Shortly after accepting | Journalist profile or Journalists list (bulk) |
| Re-run "Find Profiles" for stale profiles | Every 90 days | Dashboard alert flags when due |
| Update journalist notes / beat | When they change roles | Journalist profile → Edit |
| Update House Style | When tone/approach changes | House Style (Admin) |

## Periodic maintenance (dashboard alerts)

The dashboard **System Alerts** section flags four conditions automatically:

| Alert | Meaning | Action |
|---|---|---|
| **Overdue follow-ups** | Journalists with status "Pitched" or "Responded" whose follow-up date has passed | Log your next step or update the status |
| **Stale journalists** | No new articles in 60+ days | Check if they've changed beats or left the publication |
| **Needs re-search** | "Find Profiles" hasn't been run in 90+ days | Run "Find Profiles" to refresh social data and check for updated follower counts |
| **Unreachable publications** | RSS feeds returning errors | Click "Sync Feeds" or fix the feed URL manually |

## Understanding RSS feed statuses

Each publication in the Publications admin shows one of four feed statuses:

| Status | Meaning |
|---|---|
| 🟢 **Active** | At least one feed URL is working and returning articles |
| 🔴 **Failed** | Feed URL(s) were saved but none are responding (404, 403, or timeout) |
| ✖ **No RSS** | No feeds saved and auto-discovery found nothing |
| 🟡 **Unknown** | Publication was just added — discovery hasn't run yet |

### What to do when a feed shows Failed

**Step 1 — Hover the Failed badge.** A tooltip will appear with an AI-generated explanation of why it failed and a specific next step (e.g. a URL to try, or a recommendation to add journalists manually).

**Step 2 — Run Sync Feeds.** Click the "Sync Feeds" button in the Publications toolbar. This re-runs discovery on all publications and automatically removes broken feeds that have no working replacement. If new feed URLs are found, they'll be saved and verified.

**Step 3 — Manually fix the feed URL** (if Sync Feeds doesn't help). Click the feed count to expand the feeds panel, delete the broken feed (✕ button), then paste a new URL in the "Add feed" field. To find the right URL:
- Visit the publication's website and look for an RSS icon
- Try appending `/feed`, `/rss`, or `/feed.xml` to the section URL (e.g. `https://techcrunch.com/category/artificial-intelligence/feed/`)
- Check the AI tooltip — it often suggests a specific URL to try

**Step 4 — Deactivate if no public RSS exists.** Some publications (Bloomberg, WSJ, Boston Globe, Beehiiv newsletters) don't offer public RSS feeds. Toggle the publication off (Active switch) and add journalists from that outlet manually instead.

## Keeping scores fresh

Scores are generated when a journalist is first accepted. They're also re-generated automatically when a follower count is detected during "Find Profiles." No manual re-scoring button exists — the system handles it.

If a journalist's beat changes significantly (new role, different publication), update their profile in Edit form and run "Find Profiles" to trigger a fresh score.

## Pushing updates to GitHub

After any session of changes:

```bash
git add -A
git commit -m "describe what changed"
git push
```

GitBook will automatically update the public docs site when changes are pushed to the `main` branch.

Railway (backend) and Vercel (frontend) also auto-deploy on every push to `main`.
