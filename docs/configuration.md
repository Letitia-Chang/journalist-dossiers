# Configuration

## Company profile

The profile is edited in the first-run wizard, in **Company Profile** (owners and admins), or loaded from `company.config.json`.

| Field | Used for |
|---|---|
| `name` (required), `website`, `one_liner`, `industry` | Context in every prompt |
| `products`, `target_audience`, `regions` | Scoring (audience match, geography) and pitches |
| `key_messages` | Story angles the pitch chooses from |
| `newsworthy_items` (`type`: launch, funding, research, hire, other; `title`, `date`, `description`, `url`) | News hooks in pitches |
| `competitors` | Spotting journalists who cover your space |
| `press_coverage` (`title`, `url`) | Existing coverage, as scoring context |
| `spokespeople` (`name`, `title`, `topics`) | The pitch names the one whose topics best match the journalist |
| `pitch_tone`, `email_signature` | Voice; the signature ends every draft verbatim |
| `app_name`, `logo_url`, `brand_color` | Sidebar, login screen, browser tab and theme (`brand_color` is a 6-digit hex, used as the 600 shade) |

Only `name` is required. Validation errors name the offending field.

## `company.config.json`

Copy `company.config.example.json`. Shape:

```json
{
  "company": { "name": "Example Co", "...": "any profile fields" },
  "scoringDimensions": [
    { "name": "Beat relevance", "description": "…", "weight": 40 }
  ]
}
```

- Looked up at `COMPANY_CONFIG_PATH`, `./company.config.json`, then `../company.config.json`.
- **Seeds only.** If a profile already exists it is left alone, so edits made in Settings survive restarts. Set `COMPANY_CONFIG_SYNC=true` to re-apply the file on every boot.
- `scoringDimensions` are applied only when the org has none yet. Without them, the six defaults are created.
- An invalid file stops the server at boot with a message naming the bad fields.
- `company.config.json` is git-ignored.

## Scoring dimensions

Admin → **Scoring Dimensions**. Each has a name, description and weight; the description is part of the prompt, so write it as an instruction ("Do the outlet's readers match our target audience?"). Weights are the maximum points for that dimension; keep them summing to 100 if you want the total to read as a percentage.

Defaults: beat relevance (25), audience match (20), recent coverage of similar companies (20), geography (10), outlet reach (15), responsiveness signals (10).

## Environment variables

See `server/.env.example` for the full annotated list.

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | – | Postgres connection string (required) |
| `SESSION_SECRET` | – | JWT signing key (required; in production at least 32 characters, `openssl rand -hex 32`) |
| `ANTHROPIC_API_KEY` | – | Claude key; AI features are disabled without it |
| `ANTHROPIC_MODEL` | `claude-opus-4-8` | Model for all AI steps |
| `PORT` | `3001` | API port |
| `FRONTEND_URL` | – | Allowed browser origin (CORS) and base for invite links |
| `COMPANY_CONFIG_PATH`, `COMPANY_CONFIG_SYNC` | – | See above |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | – | Create the first owner on boot |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | – | Gmail drafts |
| `BOT_NAME`, `BOT_CONTACT_URL`, `BOT_USER_AGENT` | `PressDossierBot` | How the crawler identifies itself |
| `TRUST_PROXY` | – | `true` behind a reverse proxy |
| `CLIENT_IP_HEADER` | – | Header holding the real client address, for the demo's per-visitor limits when a CDN sits in front of the proxy (Render: `cf-connecting-ip`). Only set it if every request passes through that CDN, or clients could spoof it |
| `DEMO_MODE`, `DEMO_AI_PER_HOUR`, `DEMO_AI_PER_DAY`, `DEMO_SANDBOX_HOURS` | – | See [demo-mode.md](demo-mode.md) |

Client: `VITE_API_URL` (default `http://localhost:3001/api`).
