# Design notes

Why Press Dossier is built the way it is, what went wrong along the way, and what it still doesn't do.

## The problem

Most startups struggle to get noticed. A founder has news worth sharing, such as a feature launch, a funding round or a milestone, and people who would want to hear it: investors, sponsors, customers, or someone who might join the team. Without a marketing specialist, that news often goes nowhere.

Press is one way out, and it is easy to do badly. A good pitch needs three things in one place: what a journalist actually writes about, why they fit *this* company, and a draft that uses the company's real news and people. Press Dossier aims to give a small team all three without a marketing hire.

The risky parts are the AI ones: inventing sources, sounding sure without grounds, and sending things nobody read.

## Decisions

**One company profile drives the AI.** Scoring, pitch drafts and publication suggestions all read the same profile through one function (`profileToPrompt`), and discovery ranks by terms taken from it. Nothing about a particular company is written into the code.

**The model proposes, code checks.** Scores are clamped to each dimension's maximum. A cited URL is kept only if it is in that journalist's recorded articles. Malformed scoring output is repaired or salvaged where possible; a malformed draft is refused.

**A person is always the last step.** Discovered journalists and publications wait for accept or reject. Pitches become Gmail drafts: the app only calls Gmail's create-draft endpoint and contains no code that sends. (The permission Google offers for drafts would also allow sending, so this is a property of the code, not of the permission.) Once marked sent, a pitch can't be edited or regenerated.

**The public demo gets its own threat model.** Anyone can enter, and it spends real money, so:

- each visitor gets a private copy of a fictional company that expires, rather than a shared account
- live AI calls are counted atomically in Postgres: per visitor per hour, per network per day and in total per day. Past a limit, scoring shows the saved example and drafting says so
- every stored field, and every prompt a visitor can trigger, has a size cap, which bounds what one call can cost
- it refuses to start on a database that holds a real organization

**Boring infrastructure.** Express, Postgres and React, with the demo API on a host that sleeps when idle. The cost is a slow first load, which the client explains while it retries.

## Things that went wrong

**The rate limit that never tripped.** It passed its tests, then seven live calls in a row went through with a limit of five. Render sits behind Cloudflare, so the app was counting Cloudflare's addresses instead of visitors. It now reads the header Cloudflare sets and overwrites. Lesson: test limits on the deployed system, through the real proxies.

**One URL could stop the server.** In Express 4, a rejected async handler is an unhandled rejection, which ends the Node process. A malformed ID in a URL was enough, and because the limits lived in memory, each restart also reset them. The fix was Express 5, validation on every ID and body, and limits that live in the database. Lesson: two small weaknesses combined into a serious one.

**Fixing it twice.** An independent review, told to break the fixes, found that a database connection dropping mid-transaction still crashed the process, because the first fix only covered idle connections. It also found races in "last owner" checks, stale invites and double drafts. Lesson: "fixed" means someone else couldn't break it.

**Tests that couldn't fail.** Deliberately breaking important lines (mutation testing) showed that 14 of 52 breaks went unnoticed. Most now fail a test; the rest are backed by a second safeguard.

## What it doesn't do

- **The scores have not been evaluated against human judgments.** They are explainable, not validated. Rescoring one journalist three times gave 82, 83 and 82, which says something about stability and nothing about accuracy. The next step would be a labeled set of journalist and company pairs, with agreement measured against it.
- **The model sees article titles, not articles**, so a citation shows relevance to a topic, not that the article supports a claim.
- The client has no automated tests in the repository; it was checked in a real browser at phone and desktop widths.
- The demo's starting scores are set by hand, with explanations from templates. "Score with AI" replaces them with a live result, within the limits.
- One company per deployment.

## How it was built

The idea, the product design, the features, and the research into how to gather and combine the data are mine. AI coding tools wrote the implementation. I tested it, told them what was wrong, and had it fixed, round after round. Separate AI reviewers were also told to try to break the changes, and I approved every merge.

See [architecture](architecture.md), [demo mode](demo-mode.md) and [deployment](deployment.md).
