# Data Sources

This page documents where each piece of journalist data comes from, what's automated, and where we hit technical or cost constraints.

---

## How journalist data is collected

### 1. RSS feeds & staff page scans (automatic discovery)

Publication RSS feeds are the primary discovery mechanism. When a feed is scanned, the system extracts:
- Journalist name (from `<author>` tags or bylines)
- Publication name (known from the feed)
- Beat (inferred from article categories and title keywords)
- Recent articles (up to the last 10 items)
- Last published date (updated every Friday by the RSS cron job)

Staff page scans (triggered manually per publication) use Cheerio to parse the publication's `/authors`, `/staff`, or `/team` page for journalist names and profile links.

### 2. Claude AI scoring (automatic on accept)

When a journalist suggestion is accepted, Claude Opus 4.8 receives:
- Journalist name and publication
- Publication tier (A/B/C)
- Up to 10 recent article titles
- Social following (if previously filled in)
- Detected follower count (if available from SerpAPI)

Claude returns:
- Refined beat description
- Scores across 6 dimensions (see [Journalists → Scoring](features/journalists.md))
- Best pitch angle
- System notes explaining the scoring rationale

Scoring also re-runs automatically in the background when a follower count is newly detected by SerpAPI.

### 3. Email finder (automatic on accept)

The system tries up to 14 URL patterns on the publication's website in order:
`/author/{slug}` → `/authors/{slug}` → `/staff/{slug}` → `/people/{slug}` → `/contributors/{slug}` → `/writer/{slug}` → `/reporter/{slug}` → `/profile/{slug}` → `/about/{slug}` → `/team/{slug}` → `/about` → `/about-us` → `/contact` → `/contact-us`

For each page that loads successfully, it scans for `mailto:` links and email patterns in the HTML, preferring addresses on the publication's own domain.

**Limitation:** Major publications (TechCrunch, GeekWire, Wired, etc.) are protected by Cloudflare, which blocks automated HTTP requests. For these, the system saves the contact page URL so you can visit it manually — but cannot extract the email address.

### 4. SerpAPI profile search ("Find Profiles" button)

Triggered per journalist or in bulk from the Journalists list. Runs a Google search for `"[Name]" "[Publication]"` and parses the top 10 results for:
- LinkedIn profile URL (`linkedin.com/in/...`)
- MuckRack profile URL (`muckrack.com/...`)
- Twitter/X profile URL
- Author page on the publication's own domain
- **Follower count** — parsed from organic result snippets (e.g. "3K followers" in a LinkedIn snippet). When detected, auto-populates the Social Following field and triggers a Claude re-score.

A data freshness strip on each journalist's profile shows when this search was last run and which fields were found, so the team knows what still needs manual entry.

**Cost:** SerpAPI charges per search. The free tier includes ~100 searches/month. Paid plans start at $50/month for 5,000 searches.

### 5. Profile photo (automatic via SerpAPI image search)

On accept and when "Find Profiles" is run, the system performs a Google Image search for `"[Name]" [Publication] journalist` and picks the best result, preferring images hosted on MuckRack or Gravatar (which tend to be professional headshots).

Photos can also be uploaded manually by hovering over the avatar on the profile page.

---

## Data we wanted but can't collect automatically

These signals would improve scoring accuracy — particularly the Audience Reach dimension — but are blocked by technical limitations or cost:

| Signal | Status | Notes |
|---|---|---|
| **Follower count (from snippets)** | ✅ Partially automated | Detected from Google search result snippets during "Find Profiles". Not always present — depends on what Google indexes. Enter manually in Social Following if you know it. |
| **Twitter/X follower count (API)** | ⚠️ Manual only | Twitter API requires a paid plan ($100/month minimum). Follower counts are not extractable from the public profile page. Use the snippet detection above as a fallback. |
| **LinkedIn follower count (API)** | ❌ Not available | LinkedIn blocks all automated access. No public API for follower data. |
| **Article view / read counts** | ❌ Not available | Publications almost never expose view counts publicly. No aggregator has this data. |
| **Article share counts** | ❌ Not available | Most social share count APIs were shut down (e.g. Facebook public share counts removed in 2015). BuzzSumo ($99+/month) is the main remaining option. |
| **Backlinks / citations** | ⚠️ Rough proxy only | Accurate backlink data requires Ahrefs ($179/month) or Moz ($99/month). SerpAPI can provide a rough count but it's not reliable enough to use in scoring. |

**Workaround:** The **Social Following** field on each journalist profile accepts freetext (e.g. "~25K Twitter, 3K LinkedIn, 50K newsletter subscribers"). Claude uses this when it's provided to calibrate the Audience Reach score. It's auto-populated when a follower count is detected by SerpAPI, and can also be filled in manually from the journalist's Twitter bio or MuckRack profile.

---

## Manual data (entered by team)

| Field | Notes |
|---|---|
| Role / Title | Scraped role titles from publication pages were too noisy and inconsistent. Enter manually from their byline or LinkedIn. |
| Social following | Auto-filled by SerpAPI snippet detection when possible; fill in manually otherwise. |
| Preferred contact method | Only knowable after first contact or from their own stated preferences. |
| Topics to avoid | Based on reading their work and noting what they don't cover. |
| Best time to reach | Discovered through experience or stated in their public bio. |
| Email (for Cloudflare-protected sites) | Visit the saved Contact Page URL and copy the email manually. |
| Admin notes | Internal observations, pitch strategy, and follow-up reminders — stored separately from the system-generated notes. |
