# Bulk Order Co-op

A web app for coordinating bulk food orders with your community. It replaces the shared spreadsheet — giving everyone a clear view of what's been claimed, what cases are filling up, and what they owe.

Built for ordering from [Infinity Foods Co-operative](https://www.infinityfoodswholesale.coop/), but could work with any wholesaler that provides a CSV price list.

## How it works

### 1. Create an order

An organiser creates a new order and uploads the wholesaler's CSV price list. The app parses it into a browsable catalogue with search, brand filtering, and organic indicators.

### 2. Invite members

Each order gets a shareable invite link. Members sign in with their email (magic link, no password needed) and join the order.

### 3. Claim items

Members browse the catalogue and claim the items they want. The app tracks how claims are filling up towards full wholesale cases — so everyone can see at a glance whether a case is ready to order, nearly there, or needs more interest.

Flexibility options let members say "I could take more to fill a case" or "I'd accept less if needed", making it easier for the organiser to round things off.

### 4. Close and reconcile

When the deadline passes, the organiser closes the order and places it with the wholesaler. Once the delivery arrives, they record what actually turned up — arrived, missing, partial, or at a different price.

The app then generates fair allocations based on what each member claimed versus what was delivered, calculates costs including VAT, and lets members confirm their allocation.

### 5. Settle up

The order totals page shows exactly what each member owes, broken down by net, VAT, and gross. The organiser marks the order complete once everyone has confirmed and paid.

## Features

- Works on mobile
- Passwordless sign-in via magic links
- CSV catalogue upload with automatic parsing
- Real-time case rounding indicators
- Flexible claiming (exact, can take more, can take less, flexible)
- Fair proportional allocation when deliveries differ from orders
- Per-member cost breakdowns with VAT
- PDF invoice upload for reconciliation

## Self-hosting

The app runs on Cloudflare Pages + Workers + D1 (SQLite) + KV. You'll need:

- A [Cloudflare](https://cloudflare.com) account (free tier works)
- A [Resend](https://resend.com) account for sending magic link emails, with custom domain set up
- [Bun](https://bun.sh) installed locally for building

### 1. Install dependencies and build

```bash
bun install
bun run build
```

### 2. Create Cloudflare resources

```bash
# Create the Pages project
bunx wrangler pages project create bulk-order-coop --production-branch main

# Create the D1 database
bunx wrangler d1 create bulk-order-coop-db

# Create the KV namespace for catalogue storage
bunx wrangler kv namespace create CATALOGUE_KV
```

Update `database_id` in `wrangler.toml` with the UUID returned by the D1 create command.

### 3. Apply database migrations

```bash
bunx wrangler d1 migrations apply DB --remote
```

### 4. Set secrets

In the Cloudflare dashboard (Workers & Pages → bulk-order-coop → Settings → Variables and Secrets), add:

| Secret           | Description                                                           |
| ---------------- | --------------------------------------------------------------------- |
| `RESEND_API_KEY` | Resend API key for sending magic link emails                          |
| `EMAIL_FROM`     | Email from field such as "Bulk Order Co-op <noreply@your-domain.com>" |
| `JWT_SECRET`     | Secret key for signing JWTs (generate with `openssl rand -base64 32`) |

### 5. Deploy

```bash
bunx wrangler pages deploy build/
```

Or set up CI — see [DEVELOPMENT.md](DEVELOPMENT.md) for the GitHub Actions workflow and required secrets.

### Updating the database schema

```bash
bun run db:generate    # Generate migration from schema changes
```

With the GitHub Actions deploy, pending migrations are rehearsed on a copy of
production and applied automatically if nothing is lost or broken; otherwise
the deploy stops with a diagnosis — see [DEVELOPMENT.md](DEVELOPMENT.md). Without CI,
apply them yourself with `bunx wrangler d1 migrations apply DB --remote`.
