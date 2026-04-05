# Development Guide

## Prerequisites

- [Bun](https://bun.sh) (latest)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (installed as a dev dependency)
- A Cloudflare account (for deployment)
- A [Resend](https://resend.com) API key (for magic link emails)

## Tech stack

| Layer    | Technology                                                            |
| -------- | --------------------------------------------------------------------- |
| Frontend | SvelteKit (static SPA via `adapter-static`), Svelte 5 runes, Pico CSS |
| API      | Hono on Cloudflare Workers (via Pages Functions)                      |
| Database | Cloudflare D1 (SQLite) with Drizzle ORM                               |
| Auth     | Magic links via Resend, JWT (HS256, Web Crypto API)                   |
| Build    | Vite, Bun                                                             |
| CI/CD    | GitHub Actions → Cloudflare Pages                                     |

## Project structure

```sh
├── db/
│   ├── schema.ts              # Drizzle ORM schema (10 tables)
│   └── migrations/            # Generated D1 migrations
├── functions/
│   └── api/[[route]].ts       # Cloudflare Pages catch-all → Hono
├── server/
│   ├── routes/                # Hono route handlers
│   │   ├── auth.ts
│   │   ├── catalogues.ts
│   │   ├── orders.ts
│   │   ├── items.ts
│   │   ├── claims.ts
│   │   └── reconciliation.ts
│   ├── middleware/auth.ts     # JWT verification middleware
│   └── services/              # Pure business logic
│       ├── csv.ts
│       ├── jwt.ts
│       ├── orders.ts
│       └── reconciliation.ts
├── shared/
│   ├── types.ts               # Domain types shared between client/server
│   ├── rounding.ts            # Case rounding calculations
│   └── costs.ts               # Cost estimation with VAT
├── src/
│   ├── app.html
│   ├── app.css
│   ├── lib/
│   │   ├── api.ts             # apiFetch wrapper with auth
│   │   ├── auth.svelte.ts     # Auth store (Svelte 5 runes)
│   │   ├── catalogue.ts       # Catalogue search/filter
│   │   ├── claims.ts          # Claims API client
│   │   ├── format.ts          # Price/weight formatting
│   │   ├── orders.ts          # Orders API client
│   │   ├── reconciliation.ts  # Reconciliation API client
│   │   └── components/        # Reusable Svelte components
│   └── routes/                # SvelteKit file-based routing
├── static/                    # Static assets (favicon)
├── tests/                     # Vitest test files
├── wrangler.toml              # Cloudflare config
├── drizzle.config.ts          # Drizzle Kit config
└── vite.config.ts             # Vite config (proxies /api to Wrangler)
```

## Getting started

```bash
# Install dependencies
bun install

# Create the local D1 database and apply migrations
bun run db:migrate

# Start the dev server (SvelteKit on :5173, Wrangler on :8787)
bun run dev
```

Vite proxies `/api` requests to the Wrangler dev server on port 8787.

For magic links to work locally, you'll need to set `RESEND_API_KEY` and `JWT_SECRET` in a `.dev.vars` file (Wrangler's local secrets):

```
RESEND_API_KEY=re_xxxxxxxxxxxx
JWT_SECRET=some-local-secret
```

## Scripts

| Command               | What it does                              |
| --------------------- | ----------------------------------------- |
| `bun run dev`         | Start SvelteKit + Wrangler concurrently   |
| `bun run build`       | Build static SPA to `build/`              |
| `bun run test`        | Run all tests (Vitest)                    |
| `bun run test:watch`  | Run tests in watch mode                   |
| `bun run lint`        | Lint with oxlint                          |
| `bun run check`       | Svelte type checking                      |
| `bun run db:generate` | Generate D1 migration from schema changes |
| `bun run db:migrate`  | Apply migrations to local D1              |

## Testing

Tests live in `tests/` and cover pure business logic — CSV parsing, rounding, cost estimation, JWT, order validation, items, and reconciliation. Currently 91 tests.

```bash
bun run test          # Single run
bun run test:watch    # Watch mode
```

Tests use TDD — write tests first when adding new business logic.

## Database

The schema is defined in `db/schema.ts` using Drizzle ORM. There are 10 tables:

- `members`, `auth_tokens` — authentication
- `catalogues`, `catalogue_items` — uploaded price lists
- `orders`, `order_members` — order events and membership
- `order_items`, `claims` — items on an order and member claims
- `delivery_items`, `allocations` — reconciliation and final allocation

To modify the schema:

```bash
# 1. Edit db/schema.ts
# 2. Generate a migration
bun run db:generate
# 3. Apply locally
bun run db:migrate
# 4. Apply to production (manual — not automated in CI)
bunx wrangler d1 migrations apply DB --remote
```

## Key patterns

- **Hono routes** use `new Hono<{ Bindings: Bindings }>()`. Access D1 via `drizzle(c.env.DB)`. Generate IDs with `nanoid()`.
- **Auth middleware** (`requireAuth`) verifies the Bearer JWT and sets `c.get('memberId')` on the Hono context. Applied to all protected routes.
- **Timestamps** are Unix seconds stored as integers.
- **Booleans** in D1 are stored as `0`/`1` integers.
- **Svelte 5 runes** are used throughout: `$state`, `$derived`, `$effect`, `$props()`.
- **CSV parsing** handles Infinity Foods format quirks — blank rows, `999xxx` filtering, VAT markers, organic flags, loose vs packaged items.

## Deployment

The app deploys to Cloudflare Pages via GitHub Actions. The workflow (`.github/workflows/deploy.yml`) has two jobs:

1. **CI** (runs on every push and PR): lint, test, build
2. **Deploy** (runs on push to `main` only, after CI passes): deploys to Cloudflare Pages

### Required GitHub secrets

| Secret                  | Description                                      |
| ----------------------- | ------------------------------------------------ |
| `CLOUDFLARE_API_TOKEN`  | Cloudflare API token with Pages + D1 permissions |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID                       |

### Required Cloudflare secrets

Set these in the Cloudflare dashboard (Workers & Pages → your project → Settings → Environment variables):

| Secret           | Description                                  |
| ---------------- | -------------------------------------------- |
| `RESEND_API_KEY` | Resend API key for sending magic link emails |
| `JWT_SECRET`     | Secret key for signing JWTs                  |

### First deployment

See the [Self-hosting section in README.md](README.md#self-hosting) for full setup instructions (creating the Pages project, D1 database, R2 bucket, and secrets).

D1 migrations are applied manually — they're too risky to automate in CI.
