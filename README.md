# Common Ground — Philadelphia City Council Tracker

A free, citizen-friendly tracker for Philadelphia City Council legislation. Every bill gets a plain-language name and summary, 17 AI perspectives, related news articles, and filterable category tags — so any Philadelphian can understand what their City Council is actually doing.

## What It Does

- **Browse bills** — search and filter all Philadelphia City Council legislation by keyword, status, impact level, analysis status, category tag, sponsor, month, and bill type
- **Filter persistence** — all active filters are preserved in the URL, so the back button and shared links always work
- **Plain-English names** — AI rewrites cryptic legal titles into plain language
- **Plain-language summaries** — AI explains each bill in plain English after analysis
- **Category tags** — AI assigns category tags (housing, zoning, transportation, budget, etc.) for easy filtering
- **17 AI perspectives** — Political, Policy, Demographic, and Special viewpoints with a support/oppose tally and stacked bar
- **Perspective timestamps** — each generated perspective shows how long ago it was created
- **Impact scoring** — each bill rated 1–10 on how broadly it affects Philadelphians
- **Bill status timeline** — visual Introduced → In Committee → Signed/Failed/Vetoed progress bar
- **Related bills** — sidebar on bill detail page surfacing bills with similar tags or sponsor
- **In the News** — Google News RSS articles related to each bill, shown on the bill detail page
- **Upcoming hearings** — amber badge on bills with hearings within 7 days; full banner with Google Calendar link on detail page
- **Council member profiles** — all 17 Philadelphia City Council members with bio, district map, term start, years serving, next election year, live bills-sponsored count, and bill activity chart
- **Full-city district map** — interactive map on the Council page showing all 10 districts
- **"Contact my councilmember"** — enter your address to find your district member and draft a Gmail message
- **Vote** — cast Support / Oppose / Neutral on any bill
- **Save bills** — bookmark bills to your personal saved list (requires login)
- **Bill tracking toast notifications** — success/error feedback when saving or voting
- **Search term highlighting** — matched keywords highlighted in bill titles and summaries
- **Weekly email digest** — opt in to receive a weekly summary of newly analyzed bills with AI perspectives
- **Metrics dashboard** — site-wide stats: bills analyzed, perspectives generated, user counts, position breakdown
- **Donations** — one-time Stripe donations to support the project
- **Dark mode** — light / dark / system toggle in the navbar, persists across sessions
- **Share button** — copy a bill's URL to clipboard from the detail page

## Stack

| Layer | Tech |
|-------|------|
| Frontend | Next.js 16 (App Router), TailwindCSS, TypeScript |
| Maps | Leaflet + react-leaflet (OpenStreetMap tiles, no API key needed) |
| Backend | FastAPI (async Python), SQLAlchemy ORM |
| Database | SQLite (dev) / PostgreSQL (production) |
| AI | Plug-and-play: Ollama (default, free), Claude, or OpenAI — set via env vars |
| Ingestion | Playwright headless browser scraper (Philadelphia Legistar) |
| Auth | Google OAuth 2.0 + JWT (dev-only bypass available) |
| Email | Resend (weekly digest emails) |
| Payments | Stripe Checkout (one-time donations) |

---

## Quick Start

See [GETTING_STARTED.md](GETTING_STARTED.md) for the full walkthrough.

### Prerequisites
- Python 3.10+
- Node.js 18+
- [Ollama](https://ollama.ai) installed (for local AI) — or a Claude/OpenAI API key

> **Ollama auto-starts:** If Ollama is installed but not running when you trigger an AI action, the backend will start it automatically and retry.

### 1. Install dependencies

```bash
pip install -r requirements.txt
playwright install chromium
cd frontend && npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Minimum required in `.env`:
```env
DATABASE_URL=sqlite:///./common_ground.db
JWT_SECRET=your_random_secret
ENVIRONMENT=development

# AI provider (defaults to Ollama — free, local, private)
AI_PROVIDER=ollama
AI_MODEL=llama3.1:8b
AI_BASE_URL=http://localhost:11434
```

Google OAuth is optional during development — use the small **Dev** button on the navbar instead (only visible in development mode).

### 3. Initialize the database

```bash
alembic upgrade head
```

### 4. Run the app

```bash
# Terminal 1 — backend
uvicorn main:app --reload

# Terminal 2 — frontend
cd frontend && npm run dev
```

- Frontend: http://localhost:3000
- Backend API docs: http://localhost:8000/docs

---

## Admin Panel

The admin panel at `/admin` is restricted to users with `subscription_tier = 'dev'`. In development, use the **Dev Login** button on the navbar — it automatically creates and logs in a dev user.

The panel has three sections:

### 1. Ingestion
- **Ingest Bills** — scrapes Philadelphia Legistar for new bills. Check **Bulk Export** to import all ~8,500 bills at once via Legistar's Excel export.
- **Scrape Council Members** — scrapes phlcouncil.com for all 17 council member profiles (~2 minutes).

### 2. Bill Pipeline
A single unified workflow that processes bills through up to four steps in sequence. Configure which steps to run, set a date scope, and start — a live SSE progress bar streams results as each bill is processed. A **Stop** button halts the run at any time, and pipeline state persists across navigation.

| Step | Default | What it does |
|------|---------|--------------|
| **Step 1: Sponsors** | Off | Backfills missing sponsor data from Legistar |
| **Step 2: Analyze** | On | Fetches full bill text, generates plain title, auto-tags, runs AI analysis (summary, impact, bill type, 3 base perspectives) |
| **Step 3: Perspectives** | On | Generates all 17 perspectives; multi-select for specific perspective types |
| **Step 4: News** | Off | Fetches Google News articles for each bill |

**Date scope** — filter which bills are processed by year, month, or a custom date range.  
**Force re-analyze** — toggle to reprocess bills that have already been analyzed.

### 3. Utilities
- **Backfill Sponsors** — standalone SSE stream to fill in missing sponsor data
- **Sync Bill Statuses** — re-fetches status from Legistar for all introduced/in-committee bills to detect passage, failure, or veto
- **Refresh Hearings** — pulls upcoming hearing dates from the City Council calendar
- **Weekly Digest** — triggers the digest email to all opted-in users
- **Metrics** — displays site-wide stats inline

---

## AI Features

All AI features use the same plug-and-play provider — switch between Ollama, Claude, or OpenAI via env vars with no code changes. If Ollama is not running when an AI action is triggered, the backend starts it automatically.

### Plain-English Titles
Short, human-friendly bill names generated by AI. Shown prominently on cards with the official legal title beneath it labeled `LEGAL TITLE:`.

### Auto-Tagging
AI assigns 1–3 category tags from a fixed list:
`housing` · `zoning` · `transportation` · `public safety` · `budget` · `education` · `environment` · `health` · `parks` · `business` · `infrastructure` · `labor` · `technology` · `social services`

Tags appear as filterable dropdowns on the home feed and legislation page, ordered by frequency. Tag counts update dynamically to reflect all active filters.

### Bill Analysis (per bill)
Run via the pipeline (Step 2). Generates:
- Plain-language summary
- Impact score (1–10) and level (low / medium / high)
- Bill type (substantive / ceremonial / procedural)
- 3 base perspectives (Progressive, Conservative, Libertarian)

### 17 Perspectives
Each bill can be viewed through 17 lenses:

| Group | Perspectives |
|-------|-------------|
| Political | progressive, conservative, libertarian, socialist, centrist |
| Policy | economic, civil_liberties, environmental, public_health, urban_planning |
| Demographic | working_class, business, youth, elderly, neighborhood |
| Special | christian_ethicist, conspiracy_theorist |

The 3 base perspectives are generated during analysis. The remaining 14 are generated on demand from the bill detail page and cached. Each perspective shows: `position` (support/oppose/neutral/mixed), `key_arguments`, `concerns`, and a 50-word `assessment`.

A **perspectives tally** at the top of the section shows support/oppose/neutral/mixed counts with percentages and a stacked bar. Click any row to expand the full perspective inline.

### News Feed
On each bill's detail page, related news articles are pulled from Google News RSS using the bill's topic tags and keywords. Articles are fetched during the pipeline (Step 4) and can be refreshed individually.

---

## User Features

### Bill Tracking
Logged-in users can bookmark any bill from the home feed, legislation browser, or bill detail page. Saved bills are accessible at `/my-bills`.

### Weekly Email Digest
Users can opt in to weekly digest emails from their `/profile` page. The digest is sent by the **Weekly Digest** utility in the admin panel and includes up to 10 recently analyzed bills with summaries, impact levels, and links to perspectives. Powered by [Resend](https://resend.com).

Requires `RESEND_API_KEY` in `.env`.

### Metrics Dashboard
Available at `/dashboard` for dev users. Shows:
- Total bills, analyzed count, analysis rate progress bar
- Total perspectives generated, broken down by position (support/oppose/neutral/mixed)
- User count, digest opt-ins, total bill saves

---

## Donations

The `/donate` page lets supporters make one-time contributions via Stripe Checkout ($5 / $10 / $20 / $50 / $100, plus a custom "Other" amount). Successful payments are recorded to the `donations` table and redirect to `/donate/success`.

Requires `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, and `STRIPE_WEBHOOK_SECRET` in `.env`.

---

## Council Members

The `/councilmembers` page shows:
- An interactive full-city district map with all 10 districts color-coded and labeled with the member's name
- All 17 members grouped by district / at-large with live bills-sponsored counts and a sponsorship bar chart (sorted by bills sponsored)

Each member's detail page shows:
- Bio, contact info, link to phlcouncil.com
- District map highlighting their specific district
- Stats: bills sponsored (live count) · years serving · next election year (2027) · district
- Bill activity chart (year/month drilldown)
- All sponsored bills with status and impact level

---

## AI Provider Configuration

```env
# Ollama (default — free, local, private)
AI_PROVIDER=ollama
AI_MODEL=llama3.1:8b
AI_BASE_URL=http://localhost:11434

# Claude (Anthropic)
AI_PROVIDER=claude
AI_MODEL=claude-sonnet-4-6
AI_API_KEY=sk-ant-...

# OpenAI (or any compatible API)
AI_PROVIDER=openai
AI_MODEL=gpt-4o
AI_BASE_URL=https://api.openai.com/v1
AI_API_KEY=sk-...
```

---

## Key API Endpoints

```
GET  /api/legislation/search?q=...&level=local&analyzed=true&tag=housing&impact=high&sponsor=...&status=...
GET  /api/legislation/tag-counts?sponsor=...&status=...&impact=...   Tag frequency counts (filter-aware)
GET  /api/legislation/year-counts?q=...&analyzed=...&tag=...&impact=...&status=...&sponsor=...
GET  /api/legislation/month-counts?q=...&analyzed=...&tag=...&impact=...&status=...&sponsor=...
GET  /api/legislation/{id}                      Bill detail (includes news_links, perspectives eager-loaded)
POST /api/legislation/{id}/analyze              Trigger analysis + news fetch (dev tier)
POST /api/legislation/{id}/fetch-news           Fetch news for one bill (dev tier)
POST /api/legislation/fetch-news-all            Fetch news for all local bills (dev tier)
POST /api/legislation/plain-titles              Generate plain titles for all bills (dev tier)
POST /api/legislation/tag-all                   Auto-tag all untagged bills (dev tier)
POST /api/legislation/sync-statuses             Re-fetch Legistar status for in-flight bills (dev tier)
GET  /api/legislation/stream/pipeline           SSE: unified pipeline (steps, force_analyze, perspective_types, year, month, date_from, date_to)
GET  /api/legislation/stream/backfill-sponsors  SSE: backfill missing sponsor data
GET  /api/legislation/{id}/perspectives         All perspectives for a bill
POST /api/legislation/{id}/perspectives/{type}  Generate one perspective (90s timeout)
POST /api/legislation/{id}/vote                 Cast a vote
GET  /api/councilmembers                        List all council members
GET  /api/councilmembers/{id}                   Council member detail + sponsored bills (paginated)
GET  /api/councilmembers/districts-geojson      Philadelphia district boundaries (proxied)
POST /api/councilmembers/scrape                 Scrape phlcouncil.com profiles (dev tier)
GET  /api/auth/google                           Redirect to Google OAuth consent screen
GET  /api/auth/google/callback                  OAuth callback — issues JWT, redirects to frontend
GET  /api/auth/me                               Current user profile
POST /api/auth/dev-login                        Dev-only login bypass (development only)
POST /api/users/me/track/{bill_id}              Toggle save/unsave a bill
GET  /api/users/me/tracked-bills                List saved bills (full detail)
GET  /api/users/me/tracked-bill-ids             List saved bill IDs (fast lookup)
PATCH /api/users/me/preferences                 Update digest opt-in preference
POST /api/users/send-digest                     Send weekly digest to opted-in users (dev tier)
GET  /api/hearings/upcoming                     Bills with upcoming hearings
POST /api/hearings/refresh                      Scrape City Council calendar for hearing dates (dev tier)
GET  /api/metrics                               Site-wide metrics
GET  /api/donations/config                      Stripe publishable key
POST /api/donations/checkout                    Create Stripe Checkout session
POST /api/donations/webhook                     Stripe webhook (payment confirmation)
```

Full interactive docs at `http://localhost:8000/docs`.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | No | Defaults to SQLite |
| `JWT_SECRET` | Yes | Auth token signing key |
| `ENVIRONMENT` | No | `development` (default) or `production` |
| `AI_PROVIDER` | No | `ollama` (default), `claude`, `openai` |
| `AI_MODEL` | No | Model name (e.g. `llama3.1:8b`) |
| `AI_BASE_URL` | No | Provider base URL |
| `AI_API_KEY` | No | API key (blank for Ollama) |
| `GOOGLE_CLIENT_ID` | Prod only | Google OAuth |
| `GOOGLE_CLIENT_SECRET` | Prod only | Google OAuth |
| `FRONTEND_URL` | Prod only | Public frontend URL for CORS |
| `APP_URL` | Prod only | Public backend URL for OAuth redirect |
| `FRONTEND_BASE_URL` | Prod only | Used in email digest links (defaults to localhost:3000) |
| `REDIS_URL` | No | Required for Celery background tasks |
| `RESEND_API_KEY` | Optional | Enables weekly email digests (resend.com) |
| `EMAIL_FROM` | No | Sender address for digest emails |
| `STRIPE_SECRET_KEY` | Optional | Enables donation checkout (Stripe dashboard) |
| `STRIPE_PUBLISHABLE_KEY` | Optional | Stripe frontend key |
| `STRIPE_WEBHOOK_SECRET` | Optional | Stripe webhook signature verification |

---

## Project Structure

```
Common_Ground/
├── app/
│   ├── api/
│   │   ├── legislation_routes.py     # Bill CRUD, search, analyze, perspectives, voting, news, pipeline SSE
│   │   ├── councilmember_routes.py   # Council member profiles + district GeoJSON proxy
│   │   ├── auth_routes.py            # Google OAuth + dev login
│   │   ├── user_routes.py            # Bill tracking, preferences, digest trigger
│   │   ├── metrics_routes.py         # Site-wide metrics
│   │   └── donation_routes.py        # Stripe checkout + webhook
│   ├── integrations/
│   │   ├── legistar.py               # Legistar REST client (non-Philly cities)
│   │   └── legistar_scraper.py       # Playwright scraper (Philadelphia)
│   ├── models/
│   │   └── __init__.py               # SQLAlchemy ORM models
│   ├── services/
│   │   ├── ai_provider.py            # Plug-and-play AI abstraction (auto-starts Ollama)
│   │   ├── bill_research_service.py  # Summary, impact, tags analysis
│   │   ├── email_service.py          # Weekly digest email builder + sender (Resend)
│   │   ├── legislation_service.py    # Ingestion, search, auto-tagging
│   │   ├── news_service.py           # Google News RSS fetcher
│   │   ├── perspectives_service.py   # 17 perspective prompts + generation
│   │   └── councilmember_service.py  # Playwright scraper for phlcouncil.com
│   ├── auth.py                       # JWT + tier enforcement
│   └── config.py                     # Pydantic settings
├── frontend/
│   ├── app/
│   │   ├── page.tsx                  # Home — bill feed with filters + metrics strip
│   │   ├── legislation/              # Bill browser + detail + perspectives + news
│   │   ├── councilmembers/           # Council member list + detail pages
│   │   ├── contexts/
│   │   │   └── pipeline-context.tsx  # Global SSE pipeline state (persists across navigation)
│   │   ├── layout.tsx                # Root layout — wraps app with PipelineProvider
│   │   ├── my-bills/                 # Saved bills list (requires login)
│   │   ├── donate/                   # Donation page + success page
│   │   ├── dashboard/                # Metrics dashboard (dev tier)
│   │   ├── profile/                  # User profile + digest toggle
│   │   └── admin/                    # Ingestion, pipeline, utilities panel
│   ├── components/
│   │   ├── Navbar.tsx
│   │   ├── PerspectivesPanel.tsx     # Tally + expandable perspective cards
│   │   └── DistrictMap.tsx           # Leaflet map — single district or full city
│   └── lib/
│       ├── api.ts                    # Typed API client
│       └── auth.ts                   # JWT helpers
├── alembic/                          # Database migrations
├── main.py                           # FastAPI entry point
└── .env
```

---

## Production Checklist

- [ ] Set `DATABASE_URL` to PostgreSQL
- [ ] Set `ENVIRONMENT=production` and `DEBUG=false`
- [ ] Set `APP_URL`, `FRONTEND_URL`, `FRONTEND_BASE_URL` to your public domains
- [ ] Generate a strong `JWT_SECRET` (`python -c "import secrets; print(secrets.token_hex(32))"`)
- [ ] Configure `AI_PROVIDER` and `AI_API_KEY` for production model
- [ ] Run `alembic upgrade head` against production DB
- [ ] Set up Google OAuth and add redirect URI to Google Cloud Console
- [ ] Set at least one user's `subscription_tier = 'dev'` in the DB
- [ ] Set up HTTPS on frontend and backend
- [ ] Add `next.config.ts` remote patterns for any additional image domains
- [ ] Set `RESEND_API_KEY` and `EMAIL_FROM` to enable weekly digests
- [ ] Set `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` to enable donations
- [ ] Register the Stripe webhook endpoint (`POST /api/donations/webhook`) in the Stripe dashboard
- [ ] Set up a server-side cron job for daily bill ingest (do not rely on local machine — see Scheduled Ingest note below)

## Scheduled Ingest

The app has no built-in scheduler — ingest must be triggered either manually from the admin panel or via a server-side cron job. On a VPS or cloud provider, add a cron entry like:

```bash
# Daily at 2am — ingest new Philadelphia bills and sync statuses
3 2 * * * curl -s -X POST https://your-domain.com/api/legislation/ingest/local/philadelphia \
  -H "Authorization: Bearer $ADMIN_TOKEN"
4 2 * * * curl -s -X POST https://your-domain.com/api/legislation/sync-statuses \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```
