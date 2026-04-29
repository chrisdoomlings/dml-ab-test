# Private Shopify Plus A/B Testing App (Single Store)

This project is a private Shopify app starter for running A/B tests on custom theme sections.

## Architecture

- Remix app (admin + APIs)
- Polaris + App Bridge admin UI
- Theme App Extension embed script for storefront execution
- PostgreSQL + Prisma for experiments, assignments, events, and order attribution

## Core Flow

1. Merchant creates experiment in admin.
2. Storefront script fetches active experiments.
3. API assigns visitor to A/B once and persists that assignment.
4. Script shows selected section and hides the other.
5. Script tracks impression/click/add-to-cart.
6. Orders webhook attributes revenue to variant.
7. Analytics page summarizes performance and winner.

## File Structure

- `prisma/schema.prisma` - database models
- `app/models/experiments.server.ts` - experiment logic + summaries
- `app/routes/app._index.tsx` - dashboard list
- `app/routes/app.experiments.new.tsx` - create experiment form
- `app/routes/app.experiments.$id.tsx` - experiment analytics view
- `app/routes/api.experiments.active.tsx` - active experiments + assignment API
- `app/routes/api.events.track.tsx` - event ingestion API
- `app/routes/webhooks.orders_create.tsx` - revenue attribution webhook
- `extensions/ab-test-embed/blocks/ab-test-script.liquid` - app embed block
- `extensions/ab-test-embed/assets/ab-test.js` - lightweight storefront script

## Setup

1. Create Shopify Remix app scaffold:
   - `npm create @shopify/app@latest`
   - Choose Remix + TypeScript template.
2. Copy/merge files in this repository into your generated app.
3. Create `.env` from `.env.example` and fill values.
4. Install dependencies:
   - `npm install`
5. Create Postgres database and run:
   - `npm run prisma:generate`
   - `npm run prisma:migrate -- --name init`
6. Start local dev:
   - `npm run dev`
7. Deploy app + extension to your single Shopify Plus store.
8. In theme editor, enable the `DML AB Test Embed` block and set `app_base_url`.

## Theme Requirements

- Create two section variants in your theme manually.
- Use stable selectors/IDs in experiments, e.g.:
  - `#section-featured-collection-a`
  - `#section-featured-collection-b`
- Keep Variant A as default visible in theme to ensure fail-open behavior if JS fails.

## Analytics Accuracy Notes

- Use one assignment per `experiment + visitorId`.
- Track only active variant clicks by binding click listener to selected node.
- Persist assignment in localStorage for consistency.
- Pass `ab_visitor_id`, `ab_experiment_id`, `ab_variant` as cart/order note attributes for strong purchase attribution.
- Keep webhook idempotent using unique `orderId`.

## Production Hardening (Recommended)

- Validate Shopify webhook HMAC before processing.
- Replace placeholder shop lookup/auth with `authenticate.admin` from `@shopify/shopify-app-remix`.
- Use batching/debounce for high-volume click events.
- Add bot filtering and internal-traffic exclusion.
- Add significance calculation (z-test/Bayesian) before declaring winner.
