# LocalMapr

LocalMapr is a Vite + React app for building small map-first webapps. The
frontend runs as a client-side app, while Stripe billing endpoints live in
Vercel serverless functions under `api/`.

## Getting Started

Install dependencies and start the Vite dev server:

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) with your browser.

`npm run dev` runs the Vite UI only. The billing and webhook routes under
`api/` are Vercel serverless functions and are available in production, or
through `vercel dev` when testing those routes locally.

## Environment

Client-exposed values use Vite's `VITE_` prefix:

```bash
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_APP_URL=
```

Server-only values are used by the Vercel functions:

```bash
SUPABASE_SERVICE_ROLE_KEY=
STRIPE_SECRET_KEY=
STRIPE_PRO_PRICE_ID=
STRIPE_MAP_TOUR_CREDIT_PRICE_ID=
STRIPE_MAP_POINT_UPGRADE_PRICE_ID=
STRIPE_WEBHOOK_SECRET=
```

For local development, put these in `.env.local`. Run the database schema in
`supabase/schema.sql` before using the dashboard.

## Scripts

```bash
npm run dev
npm run build
npm run preview
npm run lint
```

## Deploy

The Vercel config builds the Vite app and rewrites non-API routes to
`index.html` so direct visits to `/dashboard`, `/admin`, and `/login` work in
production.
