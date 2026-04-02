# Common Ground — Frontend

Next.js 16 (App Router) frontend for the Common Ground Philadelphia City Council tracker.

## Stack

- **Next.js 16** — App Router, server components, TypeScript
- **TailwindCSS** — utility-first styling
- **Leaflet / react-leaflet** — interactive district maps (OpenStreetMap tiles, no API key)
- **Recharts** — bill activity bar charts on the legislation page and council member pages

## Dev server

```bash
npm run dev
```

Runs at http://localhost:3000. Requires the FastAPI backend running at http://localhost:8000 — see the root `GETTING_STARTED.md`.

## Project structure

```
frontend/
├── app/
│   ├── page.tsx                  # Home — bill feed, filters, live metrics strip
│   ├── layout.tsx                # Root layout — wraps app with PipelineProvider
│   ├── contexts/
│   │   └── pipeline-context.tsx  # Global SSE pipeline state (persists across navigation)
│   ├── legislation/
│   │   ├── page.tsx              # Bill browser — search, filter, activity chart
│   │   └── [id]/page.tsx         # Bill detail — summary, perspectives, news
│   ├── councilmembers/
│   │   ├── page.tsx              # Member list — full-city map, sponsorship bar chart
│   │   └── [id]/page.tsx         # Member detail — bio, district map, bill activity chart
│   ├── admin/
│   │   └── page.tsx              # Admin panel — Ingestion, Bill Pipeline, Utilities
│   ├── my-bills/page.tsx         # Saved bills (requires login)
│   ├── donate/
│   │   ├── page.tsx              # Stripe donation page
│   │   └── success/page.tsx      # Post-payment confirmation
│   ├── dashboard/page.tsx        # Metrics dashboard (dev tier)
│   └── profile/page.tsx          # User profile + digest opt-in
├── components/
│   ├── Navbar.tsx                # Top nav with auth state + saved bills link
│   ├── PerspectivesPanel.tsx     # Tally bar + expandable perspective cards
│   └── DistrictMap.tsx           # Leaflet map — single district or full-city view
└── lib/
    ├── api.ts                    # Typed fetch wrappers for every backend endpoint
    └── auth.ts                   # JWT decode + local storage helpers
```

## Key patterns

### API client (`lib/api.ts`)
All backend calls go through typed functions in `api.ts`. No raw `fetch` calls in page components. The base URL defaults to `http://localhost:8000` in development and reads `NEXT_PUBLIC_API_URL` in production.

### Pipeline context (`app/contexts/pipeline-context.tsx`)
The admin pipeline runs as a server-sent events (SSE) stream. `PipelineContext` holds the live progress state (running, current bill, counts, errors) so the progress bar persists if you navigate away from the admin page mid-run. Provided at the root layout level via `PipelineProvider`.

### Filter persistence (legislation page)
All active filters (keyword, tag, sponsor, status, impact, year, month, analyzed-only) are synced to URL query params with `useSearchParams` / `router.replace`. The back button and shared URLs restore the exact filter state. The activity chart and tag-count dropdown both update to reflect whichever filters are currently active.

### Leaflet SSR
`DistrictMap` is loaded with `dynamic(..., { ssr: false })` to avoid the `window is not defined` error that Leaflet throws during server-side rendering.

## Environment

```env
NEXT_PUBLIC_API_URL=http://localhost:8000   # optional, defaults to localhost:8000
```

No other frontend-specific env vars are required for local development.

## Build

```bash
npm run build
npm start
```
