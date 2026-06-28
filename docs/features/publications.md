# Publications

Publications are the outlets you source journalists from. Managing them well is the foundation of the whole system.

## Adding publications

Three ways to add publications:

1. **Manually** — click Add, fill in name, URL, tier, and focus
2. **Discover** — search Feedly, Substack, and Medium in one query; results are deduplicated and filtered against what you already track
3. **Import OPML** — import an OPML file exported from Feedly, Feedspot, or any RSS reader

## RSS feeds

Each publication can have multiple RSS feeds (main feed + category feeds). The RSS scanner uses these to find journalist bylines.

- **Auto-discover feeds** — scans the publication's homepage for AI/tech section RSS feeds
- **Scan staff page** — crawls the publication's authors/staff page for journalist names
- **Scan feeds** (↻ icon on each row) — runs the RSS parser to find new journalist suggestions

## AI suggestions

The **Suggest with AI** button (and a weekly cron job) asks Claude to suggest new relevant publications based on the North Star AI Labs focus areas. Suggestions appear in a review banner — accept or reject each one.

## Publication tiers

| Tier | Description | Examples |
|---|---|---|
| A | Major Tech & AI — large audience, primary AI/tech beat | TechCrunch, Wired, MIT Technology Review |
| B | Business / Mid-tier — exec/investor audience | Forbes Tech, Fast Company, Bloomberg Technology |
| C | Regional & Niche — targeted reach | Hypepotamus, local business journals, AI newsletters |
