# Common Ground — Philadelphia City Council Tracker

A free, citizen-friendly tracker for Philadelphia City Council legislation. Every bill gets a plain-language summary and 17 AI perspectives — Progressive, Conservative, Libertarian, Christian Ethicist, Conspiracy Theorist, and 12 more — so you can understand what different communities and viewpoints actually think about local legislation.

## What It Does

- **Browse bills** — search and filter all Philadelphia City Council legislation
- **Plain-language summaries** — AI explains each bill in terms a high schooler can understand
- **17 AI perspectives** — Political, Policy, Demographic, and Special viewpoints generated on demand and cached
- **Impact scoring** — each bill rated 1–10 on how broadly it affects Philadelphians
- **Vote** — cast Support / Oppose / Neutral on any bill

## Stack

| Layer | Tech |
|-------|------|
| Frontend | Next.js 14 (App Router), TailwindCSS, shadcn/ui |
| Backend | FastAPI (async Python), SQLAlchemy ORM |
| Database | SQLite (dev) / PostgreSQL (production) |
| AI | Plug-and-play: Ollama (default), Claude, or OpenAI — set via env vars |
| Ingestion | Playwright headless browser scraper (Philadelphia Legistar) |
| Auth | Google OAuth 2.0 + JWT |
| Background Tasks | Celery + Redis (optional) |

---

## Quick Start

### Prerequisites
- Python 3.10+
- Node.js 18+
- [Ollama](https://ollama.ai) installed and running (for local AI) — or a Claude/OpenAI API key

### 1. Install dependencies

```bash
# Backend
pip install -r requirements.txt
playwright install chromium

# Frontend
cd frontend && npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Minimum required in `.env`:
```
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
JWT_SECRET=your_random_secret

# AI provider (defaults to Ollama)
AI_PROVIDER=ollama
AI_MODEL=llama3
AI_BASE_URL=http://localhost:11434
```

To use Claude instead of Ollama:
```
AI_PROVIDER=claude
AI_MODEL=claude-sonnet-4-6
AI_API_KEY=your_anthropic_key
```

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
- Backend API: http://localhost:8000/docs

---

## Ingesting Philadelphia Bills

Bills are ingested via a Playwright scraper (Philadelphia's Legistar is IP-restricted).

### Small batch (via admin panel)
1. Log in with Google
2. Set your user's `subscription_tier = 'dev'` in the DB
3. Go to **Admin → Local tab**, enter `philadelphia`, click **Ingest Local Bills**

### Bulk ingest (all ~8,500 bills)
Check **Bulk Export** in the admin panel — this uses the Legistar Excel export and imports everything at once. Bills are stored without analysis.

### Via API
```bash
# 10 bills (with detail scraping)
curl -X POST "http://localhost:8000/api/legislation/ingest/local/philadelphia?limit=10" \
  -H "Authorization: Bearer YOUR_TOKEN"

# All bills via Excel export
curl -X POST "http://localhost:8000/api/legislation/ingest/local/philadelphia?bulk=true" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

## Analyzing Bills

Bills are **not** auto-analyzed on ingest — analysis is triggered manually per bill.

### Via admin panel
Go to **Admin → Analyze Bills**, click **Analyze** on any bill. This generates:
- Plain-language summary
- Impact score (1–10) and level (low/medium/high)
- Bill type (substantive/ceremonial/procedural)
- Topic tags
- 3 base perspectives (Progressive, Conservative, Libertarian)

### Via API
```bash
curl -X POST "http://localhost:8000/api/legislation/{id}/analyze" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### On-demand perspectives
The remaining 14 perspectives are generated on demand from the bill detail page (public, no auth required) and cached after first generation:

```bash
curl -X POST "http://localhost:8000/api/legislation/{id}/perspectives/urban_planning"
```

---

## 17 Perspective Types

| Group | Perspectives |
|-------|-------------|
| Political | progressive, conservative, libertarian, socialist, centrist |
| Policy | economic, civil_liberties, environmental, public_health, urban_planning |
| Demographic | working_class, business, youth, elderly, neighborhood |
| Special | christian_ethicist, conspiracy_theorist |

Each perspective returns: `position` (support/oppose/neutral/mixed), `key_arguments`, `concerns`, and a 50-word `assessment`.

---

## AI Provider Configuration

The AI system is fully plug-and-play — no code changes needed to switch providers:

```env
# Ollama (default — free, local, private)
AI_PROVIDER=ollama
AI_MODEL=llama3
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
GET  /api/legislation/search?q=...&level=local    Search bills
GET  /api/legislation/{id}                         Bill detail
POST /api/legislation/{id}/analyze                 Trigger analysis (dev tier)
GET  /api/legislation/{id}/perspectives            All perspectives for a bill
POST /api/legislation/{id}/perspectives/{type}     Generate one perspective
POST /api/legislation/{id}/vote                    Cast a vote
GET  /api/legislation/{id}/votes                   Get vote tallies
```

Full interactive docs at `http://localhost:8000/docs`.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GOOGLE_CLIENT_ID` | Yes | Google OAuth |
| `GOOGLE_CLIENT_SECRET` | Yes | Google OAuth |
| `JWT_SECRET` | Yes | Auth token signing |
| `AI_PROVIDER` | No | `ollama` (default), `claude`, `openai` |
| `AI_MODEL` | No | Model name (default: `llama3`) |
| `AI_BASE_URL` | No | Provider base URL |
| `AI_API_KEY` | No | API key (blank for Ollama) |
| `DATABASE_URL` | No | Defaults to SQLite |
| `CONGRESS_API_KEY` | No | Federal bill ingestion |
| `OPENSTATES_API_KEY` | No | State bill ingestion |
| `REDIS_URL` | No | Required for Celery background tasks |

---

## Project Structure

```
Common_Ground/
├── app/
│   ├── api/                  # FastAPI route handlers
│   │   ├── legislation_routes.py
│   │   └── auth_routes.py
│   ├── integrations/
│   │   ├── legistar.py             # Legistar REST client (non-Philly cities)
│   │   └── legistar_scraper.py     # Playwright scraper (Philadelphia)
│   ├── models/               # SQLAlchemy ORM models
│   ├── services/
│   │   ├── ai_provider.py          # Plug-and-play AI abstraction
│   │   ├── bill_research_service.py  # Summary + impact analysis
│   │   ├── legislation_service.py    # Ingestion orchestration
│   │   └── perspectives_service.py  # 17 perspective prompts + generation
│   ├── auth.py               # JWT + tier enforcement
│   ├── config.py             # Pydantic settings
│   └── celery_app.py         # Celery config
├── frontend/
│   ├── app/                  # Next.js pages (App Router)
│   │   ├── page.tsx          # Home — bill feed
│   │   ├── legislation/[id]/ # Bill detail + perspectives
│   │   └── admin/            # Ingestion + analyze panel
│   ├── components/
│   │   ├── PerspectivesPanel.tsx
│   │   └── Navbar.tsx
│   └── lib/
│       ├── api.ts            # API client
│       └── auth.ts           # JWT helpers
├── alembic/                  # Database migrations
├── main.py                   # FastAPI entry point
├── requirements.txt
└── .env.example
```

---

## Production Checklist

- [ ] Set `DATABASE_URL` to PostgreSQL
- [ ] Set `ENVIRONMENT=production` and `DEBUG=false`
- [ ] Set `APP_BASE_URL`, `APP_URL`, `FRONTEND_URL` to your public domains
- [ ] Set a strong random `JWT_SECRET`
- [ ] Configure `AI_PROVIDER` and `AI_API_KEY` for production model
- [ ] Run `alembic upgrade head` against production DB
- [ ] Set at least one user's `subscription_tier = 'dev'` in the DB
- [ ] Configure Google OAuth redirect URI to match `APP_URL`
