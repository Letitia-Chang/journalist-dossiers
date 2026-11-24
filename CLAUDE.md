# Press Dossier: notes for AI coding assistants

Open-source PR research tool: company profile → journalist dossiers → evidence-backed fit scores → pitch drafts (Gmail drafts, never sent). One company per deployment.

## Stack and commands

React + Vite + Tailwind (`client/`), Express + TypeScript + PostgreSQL (`server/`), Claude for analysis.

```bash
npm run dev                          # API :3001, app :5173
npm run lint && npm run typecheck && npm test && npm run build
npm run migrate:up --prefix server   # apply migrations (needs DATABASE_URL)
```

Tests need `DATABASE_URL` pointing at a migrated Postgres for the API smoke test. Use a throwaway database, never a real one.

## Rules of the codebase

- Every AI prompt reads the company profile via `profileToPrompt()` (`server/src/lib/companyProfile.ts`). Never hard-code company details or example companies into prompts or UI copy.
- Scores carry a rationale and evidence URLs; evidence is filtered to the journalist's recorded articles (`parseScoringResponse`).
- Fetching third-party pages goes through `server/src/lib/http.ts` (honest User-Agent, robots.txt).
- Every query is scoped by `org_id` from the JWT. Roles: member < admin < owner (`requireRole`).
- Migrations are CommonJS files in `server/migrations`; add new ones, don't edit old ones.
- Express: register literal routes before parameterised ones.
- Human in the loop: no automatic sending, adding or publishing. Gmail scope is `gmail.compose` only.
- Never commit secrets (`.env`, `*.db`, `company.config.json` are ignored).

See `docs/architecture.md` and `docs/configuration.md`.
