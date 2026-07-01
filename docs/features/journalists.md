# Journalists

The core of the system. Each journalist has a full profile with AI-generated relevance scores, contact details, outreach history, and contextual notes to help personalise pitches.

---

## Journalist profile fields

### Auto-populated on accept

When a journalist suggestion is accepted, the system immediately kicks off background jobs to populate:

| Field | Source |
|---|---|
| Name, Publication, Beat | From the RSS feed or staff page scan |
| Articles | Seeded from the RSS items that surfaced this journalist |
| All relevance scores + pitch angle | Claude Opus 4.8 (see Scoring below) |
| Email | Fetched from the publication's author/contact pages (see Data Sources) |
| Contact Page URL | Same fetch — or saved as a fallback link if the page blocks automated access |
| Photo | SerpAPI Google Image search, preferring MuckRack or Gravatar headshots |

### Populated by "Find Profiles" (SerpAPI)

Triggered from the journalist profile or in bulk from the Journalists list. Runs a Google search and parses the top organic results:

| Field | Source |
|---|---|
| LinkedIn URL | Google results parsed for `linkedin.com/in/` links |
| MuckRack URL | Google results parsed for `muckrack.com/` links |
| Twitter/X URL | Google results parsed for `twitter.com/` or `x.com/` links |
| Contact Page URL | Google results checked for publication domain + author-path patterns |
| Follower count | Parsed from organic result snippets (e.g. "3K followers" in a LinkedIn snippet) |
| Photo | SerpAPI image search if not already set |

When a follower count is detected, it auto-populates the Social Following field and triggers an automatic Claude re-score in the background.

A **data freshness strip** on the profile shows the date of the last SerpAPI search and which fields were found (LinkedIn ✓, MuckRack ✓, etc.) so the team knows at a glance what still needs manual entry.

### Manually entered (Edit form)

| Field | Notes |
|---|---|
| Role / Title | Not scraped — too unreliable from automated sources |
| Email | Can be added or corrected manually |
| Photo | Hover the avatar → camera icon → upload from your files |
| Social Following | Freetext, e.g. "~25K Twitter, 3K LinkedIn, 50K newsletter". Auto-filled when a follower count is detected by SerpAPI. |
| Preferred Contact Method | Multi-select: Email, Twitter/X DM, LinkedIn DM, Contact Form, Newsletter Reply |
| Topics to Avoid | Freetext, e.g. "doesn't cover enterprise B2B" |
| Best Time to Reach | Freetext, e.g. "Tuesday mornings" |
| Location, Personal Website, Pitch Angle | All manual |

---

## Scoring (out of 100)

Claude scores each journalist across 6 dimensions when they're first accepted. If a follower count is later detected via SerpAPI, Claude re-scores automatically in the background — no action required.

| Dimension | Max | What it measures |
|---|---|---|
| AI Relevance | 25 | How often they cover AI/ML/LLM topics |
| Startup Relevance | 20 | Coverage of startups, funding rounds, and founders |
| North Star Fit | 20 | Likelihood they would cover an AI enterprise startup like ours |
| Publication Authority | 15 | Reach and prestige of their outlet |
| Audience Reach | 10 | Estimated readership, article shares, and social following |
| Contactability | 10 | Whether verified contact info is available |

### What we wanted to score but can't (or can't fully)

| Signal | Status | Notes |
|---|---|---|
| Follower count | ✅ Partially automated | Detected from Google search result snippets when running "Find Profiles". Not always present — depends on what Google surfaces. Enter manually in Social Following if you know it. |
| Twitter/X follower count (API) | ⚠️ Manual | Twitter API now requires a paid plan ($100/month minimum). Use the snippet detection above as a fallback. |
| LinkedIn follower count (API) | ❌ Not available | LinkedIn blocks all automated access to follower data. Manual entry only. |
| Article view/read counts | ❌ Not available | Publications almost never expose view counts publicly. |
| Article share counts | ❌ Not available | Most social share count APIs were shut down. BuzzSumo ($99+/month) is the main remaining option. |

---

## Outreach status

Each journalist has a relationship status that you control manually. The status progresses as your relationship develops:

| Status | When to use |
|---|---|
| **Not Started** | Default. No research or contact has happened yet. |
| **Researching** | Actively researching this journalist — reading their work, checking social profiles — before deciding to pitch. Set this yourself when you begin digging in. |
| **Ready to Pitch** | Research complete and you've decided they're a good fit. Pitch is being drafted. |
| **Pitched** | First outreach sent. Waiting for a response. |
| **Responded** | They replied — positive, negative, or asking for more info. |
| **No Response** | Pitched but no reply after a reasonable wait. May follow up. |
| **Covered** | They wrote about North Star AI Labs. |
| **Declined** | Explicitly declined or confirmed they won't cover us. |

> **Note:** SerpAPI profile searches run automatically in the background and do **not** change outreach status. "Researching" is a deliberate signal — set it yourself when you're actively evaluating a journalist, not something the system sets automatically.

---

## Activity signals

### Last published

The journalist list and profile both show **"last published X days ago"** based on the most recent article in the system from their RSS feed. This is refreshed every Friday by the automated RSS cron job.

If a journalist hasn't published in 30+ days, they're flagged as **stale** and the date is highlighted in amber. A stale flag doesn't mean they're gone — they may be on leave, writing long-form pieces, or between jobs. Check their LinkedIn or publication page before removing them.

---

## Profile tabs

### Overview
Score breakdown with descriptions, best pitch angle, relationship history summary, and Outreach Context (social following, preferred contact method, topics to avoid, etc.).

### Articles
All articles written by this journalist tracked in the system. Articles are seeded automatically from RSS and can be added manually.

### Outreach
Full log of every pitch, follow-up, and response. Each entry captures channel, message type, subject line, and outcome.

### Admin Notes
Two sections:
- **System notes** (read-only) — auto-generated by Claude during scoring. Captures the AI's reasoning about this journalist's beat and relevance. Cannot be edited.
- **Admin notes** (editable) — freetext field for the team's own observations, follow-up reminders, or pitch strategy notes.
