<!-- Workspace-specific instructions for GitHub Copilot -->

## Common Ground — Philadelphia City Council Tracker

### Project Overview
A citizen-friendly web app for tracking Philadelphia City Council legislation. Each bill gets a plain-language AI summary and 17 AI perspectives (Progressive, Conservative, Libertarian, Christian Ethicist, Conspiracy Theorist, and more), so users can understand what different communities think about local legislation.

**Key design decisions:**
- Bills are ingested in bulk but NOT auto-analyzed — analysis is manually triggered per bill via an Analyze button
- AI provider is plug-and-play (Ollama by default, swappable to Claude/OpenAI via env vars — no code changes)
- Philadelphia Legistar is IP-restricted, so ingestion uses a Playwright headless browser scraper
- Perspectives are cached after first generation — idempotent

### Stack
- **Backend**: FastAPI + SQLAlchemy (async Python)
- **Frontend**: Next.js 14 (App Router), TailwindCSS, shadcn/ui
- **Database**: SQLite (dev) / PostgreSQL (production)
- **AI**: Plug-and-play via `app/services/ai_provider.py` — Ollama, Claude, or OpenAI
- **Ingestion**: Playwright scraper (`app/integrations/legistar_scraper.py`)
- **Auth**: Google OAuth 2.0 + JWT

### Project Structure
- `app/api/legislation_routes.py` — all bill endpoints (ingest, search, analyze, perspectives, vote)
- `app/integrations/legistar_scraper.py` — Playwright scraper for phila.legistar.com
- `app/services/ai_provider.py` — AIProvider abstraction (Ollama/Claude/OpenAI)
- `app/services/bill_research_service.py` — analyze_bill(): summary, impact score, tags
- `app/services/perspectives_service.py` — 17 perspective prompts + generate functions
- `app/services/legislation_service.py` — ingestion orchestration
- `app/models/__init__.py` — ORM models: Legislation, BillPerspective, User, etc.
- `frontend/app/page.tsx` — home bill feed
- `frontend/app/legislation/[id]/page.tsx` — bill detail + perspectives panel
- `frontend/app/admin/page.tsx` — ingestion controls + Analyze button per bill
- `frontend/components/PerspectivesPanel.tsx` — 17 perspectives UI

### Common Development Tasks

#### Ingest Philadelphia bills
```
POST /api/legislation/ingest/local/philadelphia?limit=10
POST /api/legislation/ingest/local/philadelphia?bulk=true   # all ~8500 via Excel export
```

#### Analyze a bill (generates summary + 3 base perspectives)
```
POST /api/legislation/{id}/analyze
```

#### Generate an on-demand perspective
```
POST /api/legislation/{id}/perspectives/{perspective_type}
```

Valid perspective types: progressive, conservative, libertarian, socialist, centrist, economic, civil_liberties, environmental, public_health, urban_planning, working_class, business, youth, elderly, neighborhood, christian_ethicist, conspiracy_theorist

#### Search bills
```
GET /api/legislation/search?q=zoning&level=local
```

### Important Notes
- Dev tier required for ingest and analyze endpoints (`subscription_tier = 'dev'` in DB)
- Perspective generation is public — no auth required
- `analyzed_at` on a Legislation row is the signal that it's been analyzed; NULL = pending
- AI responses are JSON — `_extract_json()` in both services handles malformed output
- The Legistar scraper uses `wait_until="load"` (not networkidle) to avoid timeouts
