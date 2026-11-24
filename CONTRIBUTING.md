# Contributing

Thanks for helping. Small, focused pull requests are easiest to review.

## Setup

See the [self-host guide](README.md#self-host-in-5-minutes). You need Node 20+ and a Postgres database. Run a throwaway one locally (Docker, or `initdb`) and point `DATABASE_URL` at it.

## Before you open a PR

```bash
npm run lint
npm run typecheck
npm test            # set DATABASE_URL to a migrated Postgres so the API smoke test runs
npm run build
```

CI runs the same checks plus a gitleaks scan.

## Conventions

- **Never commit secrets.** Use `server/.env.example` for placeholders. `.env`, `*.db` and `company.config.json` are ignored.
- **Every AI prompt reads the company profile** through `profileToPrompt()`. Don't hard-code company details, positioning or example companies into prompts.
- **Migrations** live in `server/migrations` as CommonJS files (`exports.up` / `exports.down`); add a new one rather than editing an old one.
- **Routes**: register specific paths before parameterised ones (`/discover` before `/:id`). Every query is scoped by `org_id`.
- **Fetching third-party pages** goes through `server/src/lib/http.ts` (honest User-Agent, robots.txt check).
- Keep a human in the loop: nothing is sent, added or published automatically.

## Reporting problems

Open an issue with what you expected, what happened, and the steps to reproduce. For security issues, please don't post details publicly; contact the maintainer.
