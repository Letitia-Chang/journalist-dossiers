# Design notes

Why Press Dossier is built the way it is, what went wrong along the way, and what it still doesn't do.

## The problem

Good pitches need three things in one place: what a journalist actually writes about, why they fit *this* company, and a draft that uses the company's real news and people. The risky parts are the AI ones: inventing sources, sounding sure without grounds, and sending things nobody read.

## Decisions

**One company profile drives every prompt.** Scoring, pitch drafts and publication suggestions all read the same validated profile through one function (`profileToPrompt`). Nothing about a company is written into a prompt, so the same code works for any company.

**The model proposes, code checks.** Scores are clamped to each dimension's maximum. A cited URL is kept only if it is in that journalist's recorded articles. Malformed output is repaired or salvaged where possible and refused otherwise.

**A person is always the last step.** Discovered journalists and publications wait for accept or reject. Pitches become Gmail drafts through a permission that can't send mail, and a sent pitch is locked.

**The public demo gets its own threat model.** Anyone can enter, and it spends real money, so:

- each visitor gets a private copy of a fictional company that expires, rather than a shared account
- live AI calls are counted atomically in Postgres per visitor, per network and per day, and fall back to saved examples
- every field and prompt has a size cap, which bounds what one call can cost
- it refuses to start on a database that holds a real organization

**Boring infrastructure.** Express, Postgres and React on free tiers. The cost is a slow first load after idle, which the client explains while it retries.

## Things that went wrong

**The rate limit that never tripped.** It passed its tests, then seven live calls in a row went through a limit of five. Render sits behind Cloudflare, so the app was counting Cloudflare's addresses instead of visitors. It now reads the header Cloudflare sets and overwrites. Lesson: test limits on the deployed system, through the real proxies.

**One URL could stop the server.** In Express 4, a rejected async handler is an unhandled rejection, which ends the Node process. A malformed ID in a URL was enough, and because the limits lived in memory, each restart also reset them. The fix was Express 5, validation on every ID and body, and limits that live in the database. Lesson: two small weaknesses combined into a serious one.

**Fixing it twice.** A second, adversarial review found that a database connection dropping mid-transaction still crashed the process, because the first fix only covered idle connections. It also found races in "last owner" checks, stale invites and double drafts. Lesson: "fixed" means someone else couldn't break it.

**Tests that couldn't fail.** Deliberately breaking important lines (mutation testing) showed that a number of passing tests would have passed anyway. Those were rewritten.

## What it doesn't do

- **The scores have not been evaluated against human judgments.** They are explainable, not validated. Rescoring one journalist three times gave 82, 83 and 82, which says something about stability and nothing about accuracy. The next step would be a labeled set of journalist and company pairs, with agreement measured against it.
- **The model sees article titles, not articles**, so a citation shows relevance to a topic, not that the article supports a claim.
- The client has no automated tests in the repository; it was checked in a real browser at phone and desktop widths.
- The demo's starting scores and explanations are hand-written examples. Press "Score with AI" for a live one.
- One company per deployment.

## How it was built

With an AI coding assistant, with changes reviewed by separate AI reviewers told to break them, and every merge approved by a person. See [architecture](architecture.md), [demo mode](demo-mode.md) and [deployment](deployment.md).
