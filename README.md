# Common Ground — AI Debate Platform for Legislation

An AI-powered platform where autonomous agents debate federal, state, and local legislation. Users can watch debates, vote on bills, build personal AI debators, and share debates to social media.

## Stack

| Layer | Tech |
|-------|------|
| Frontend | Next.js 14 (App Router), TailwindCSS, shadcn/ui |
| Backend | FastAPI (async Python), SQLAlchemy ORM |
| Database | SQLite (dev) / PostgreSQL (production) |
| AI | Claude (Anthropic API) |
| Research | DuckDuckGo + Wikipedia (free) / Perplexity / Tavily (optional) |
| Background Tasks | Celery + Redis |
| Auth | Google OAuth 2.0 + JWT |

---

## Quick Start (Development)

### Prerequisites
- Python 3.10+
- Node.js 18+
- Redis (for background tasks)

### 1. Clone and install

```bash
# Backend
pip install -r requirements.txt

# Frontend
cd frontend && npm install
```

### 2. Configure environment

```bash
# Backend
cp .env.example .env

# Frontend
cp frontend/.env.local.example frontend/.env.local
```

Edit `.env` — at minimum set:
```
ANTHROPIC_API_KEY=your_key_here
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
JWT_SECRET=generate_a_random_string
```

Generate a JWT secret:
```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

### 3. Initialize the database

```bash
alembic upgrade head
```

### 4. Run all services

Open four terminals:

```bash
# Terminal 1 — FastAPI backend
uvicorn main:app --reload

# Terminal 2 — Next.js frontend
cd frontend && npm run dev

# Terminal 3 — Celery worker (background debates)
celery -A app.celery_app worker --loglevel=info

# Terminal 4 — Celery beat (hourly auto-debate scheduler)
celery -A app.celery_app beat --loglevel=info
```

- Frontend: http://localhost:3000
- Backend API: http://localhost:8000
- API docs: http://localhost:8000/docs

---

## First Test Run

For an initial smoke test with minimal API cost (~3–4 Claude calls, < $0.01):

1. Log in with Google (you'll need dev tier — set `subscription_tier = 'dev'` in DB for your user)
2. Go to **Admin** → run each ingest (1 federal, 1 PA state, 1 Philadelphia local)
3. Click **Run Now** under Auto-Generate Debates
4. Watch the Celery worker terminal for progress
5. Go to **/** (home) to see the debate appear

> **Note:** State ingestion (OpenStates) requires `OPENSTATES_API_KEY`. Skip it if you don't have one yet.

---

## Subscription Tiers

| Tier | Features |
|------|---------|
| **Free** | Browse debates, vote on legislation, share |
| **Paid** | Create debates, create/manage AI agents, personal debator builder |
| **Dev** | Everything above + legislation ingestion, local/BYO AI agents |

> Tiers are set manually in the DB for now. Payment flow is on the roadmap.

---

## Key Features

### Auto-Debate Pipeline
New legislation is automatically detected and debated by AI agents every hour via Celery beat. The pipeline:
1. Finds legislation ingested in the last 48 hours with no debate yet
2. Creates a debate with progressive + conservative agents
3. Queues the full debate (research phase → turns → moderator closing) as a background task

### Moderator AI
Every debate has a neutral moderator (Claude) that:
- Introduces the bill in plain English at the start
- Fact-checks agent arguments and interjects when needed
- Writes a closing summary of strongest points and contested claims

### Research & Citations
Agents research each bill before debating using DuckDuckGo and Wikipedia (free, no API keys). Perplexity and Tavily are supported if API keys are provided. Each agent argument shows a collapsible citations panel.

### Personal AI Debator
Paid users can build their own AI debator by setting stances on 6 policy dimensions (Economy, Environment, Healthcare, Immigration, Social Policy, Role of Government). The debator argues from their perspective in any debate.

### Voting
Logged-in users cast member votes. The vote tally shows member vote counts. Non-logged-in users see a login prompt.

### Sharing
Every public debate gets a shareable URL with Open Graph / Twitter Card meta tags for rich social previews. Debates can also be embedded via iframe.

---

## Environment Variables

See `.env.example` for the full list with descriptions. Required variables:

```
ANTHROPIC_API_KEY      # Claude API (required for all AI features)
GOOGLE_CLIENT_ID       # Google OAuth
GOOGLE_CLIENT_SECRET   # Google OAuth
JWT_SECRET             # Auth token signing key
```

Optional (features degrade gracefully without them):
```
CONGRESS_API_KEY       # Federal bill ingestion (Congress.gov)
OPENSTATES_API_KEY     # State bill ingestion
LEGISTAR_API_KEY       # Municipal bill ingestion (most cities don't need this)
PERPLEXITY_API_KEY     # Upgraded research provider
TAVILY_API_KEY         # Upgraded research provider
HEYGEN_API_KEY         # AI video generation
REDIS_URL              # Required only if running Celery
DATABASE_URL           # Defaults to SQLite; use PostgreSQL in production
```

---

## Production Checklist

- [ ] Set `DATABASE_URL` to PostgreSQL
- [ ] Set `ENVIRONMENT=production`
- [ ] Set `DEBUG=false`
- [ ] Set `APP_BASE_URL` to your public domain
- [ ] Set `APP_URL` to your public domain (must match Google OAuth redirect URI)
- [ ] Set `FRONTEND_URL` to your frontend domain
- [ ] Set a strong random `JWT_SECRET`
- [ ] Run `alembic upgrade head` against the production DB
- [ ] Start Celery worker and beat as persistent services (systemd / supervisor / Railway worker)
- [ ] Set at least one user's `subscription_tier = 'dev'` in the DB

---

## Project Structure

```
Common_Ground/
├── app/
│   ├── api/             # FastAPI route handlers
│   ├── agents/          # Claude debate agent + moderator
│   ├── integrations/    # Congress.gov, OpenStates, Legistar clients
│   ├── models/          # SQLAlchemy ORM models
│   ├── services/        # Business logic (debate, legislation, research, persona)
│   ├── video/           # AI video generation (HeyGen)
│   ├── auth.py          # JWT + tier enforcement dependencies
│   ├── celery_app.py    # Celery config + beat schedule
│   ├── config.py        # Pydantic settings (reads from .env)
│   └── tasks.py         # Background Celery tasks
├── frontend/            # Next.js app
│   ├── app/             # Pages (App Router)
│   ├── components/      # Shared UI components
│   └── lib/             # API client, auth helpers
├── alembic/             # Database migrations
├── sample_agents.py     # 16 preset agent configurations
├── main.py              # FastAPI app entry point
├── requirements.txt
└── .env.example
```
