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

- Passwordless sign-in via magic links
- CSV catalogue upload with automatic parsing
- Real-time case rounding indicators
- Flexible claiming (exact, can take more, can take less, flexible)
- Delivery tracking and reconciliation
- Fair proportional allocation when deliveries differ from orders
- Per-member cost breakdowns with VAT
- Inline confirmation for destructive actions
- Works on mobile

## Self-hosting

The app runs on Cloudflare Pages + Workers + D1 (SQLite). You'll need:

- A [Cloudflare](https://cloudflare.com) account (free tier works)
- A [Resend](https://resend.com) account for sending magic link emails
- [Bun](https://bun.sh) installed locally for building

See [DEVELOPMENT.md](DEVELOPMENT.md) for setup instructions.
