# Journalists

The core of the system. Each journalist has a full profile with AI-generated relevance scores, outreach history, and contact details.

## Scoring (out of 100)

Claude scores each journalist across 6 dimensions when they're first accepted into the system:

| Dimension | Max points | What it measures |
|---|---|---|
| AI Relevance | 25 | How often they cover AI/ML topics |
| Startup Relevance | 20 | Coverage of startups and funding |
| North Star Fit | 20 | Alignment with North Star AI Labs specifically |
| Publication Authority | 15 | Reach and prestige of their outlet |
| Audience Reach | 10 | Estimated audience size |
| Contactability | 10 | Whether contact info is publicly available |

Scores map to tiers: **Tier 1** (80–100), **Tier 2** (60–79), **Tier 3** (40–59), **Tier 4** (below 40).

## Outreach status

Each journalist has a relationship status that auto-updates when you log outreach:

`Not Started` → `Ready to Pitch` → `Pitched` → `Responded` / `No Response` → `Covered` / `Declined`

## Email enrichment

Use **Find email via Apollo** on any journalist profile to look up their professional email via the Apollo People Match API. Bulk enrichment is available from the Journalists list page.

## Briefing tab

The **Briefing** tab on each journalist profile shows:
- Recommended next action based on current status
- Quick profile facts (beat, role, publication)
- Writing themes derived from tracked articles
- Best pitch angle (from Claude's scoring analysis)
- Recent articles
