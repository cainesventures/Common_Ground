# Getting Started — Common Ground

Get the app running locally in about 10 minutes.

---

## Prerequisites

- Python 3.10+
- Node.js 18+
- [Ollama](https://ollama.ai/download) (for free local AI) — **or** a Claude/OpenAI API key

---

## 1. Install dependencies

```bash
# Backend
pip install -r requirements.txt
playwright install chromium   # headless browser for Legistar scraper

# Frontend
cd frontend && npm install && cd ..
```

---

## 2. Set up environment

```bash
cp .env.example .env
```

Edit `.env` — minimum required for local dev:

```env
DATABASE_URL=sqlite:///./common_ground.db
JWT_SECRET=some_random_string_here
ENVIRONMENT=development
DEBUG=true

# AI (defaults to Ollama — free and local)
AI_PROVIDER=ollama
AI_MODEL=llama3.1:8b
AI_BASE_URL=http://localhost:11434
```

Generate a random JWT secret:
```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

> **Google OAuth is not required for local development.** Use the **Dev Login** button on the navbar instead. See the production checklist in README.md when you're ready to go live.

See `LOCAL_AI_SETUP.md` for Ollama setup, or switch to Claude/OpenAI — see README for provider config.

---

## 3. Initialize the database

```bash
alembic upgrade head
```

---

## 4. Start the app

```bash
# Terminal 1 — FastAPI backend
uvicorn main:app --reload

# Terminal 2 — Next.js frontend
cd frontend && npm run dev
```

- **Frontend:** http://localhost:3000
- **API docs:** http://localhost:8000/docs

Or use the restart script (Windows):
```bash
powershell.exe -ExecutionPolicy Bypass -File restart.ps1
```

---

## 5. First run walkthrough

### Log in
Click **Dev Login** on the navbar. This creates a dev user with full admin access — no Google OAuth required.

### Ingest bills
1. Go to **http://localhost:3000/admin**
2. Set **Limit** to `10` and click **Ingest Bills**

The Playwright scraper opens a headless browser, navigates to phila.legistar.com, and imports 10 real Philadelphia ordinances. For all ~8,500 bills, check **Bulk Export** instead.

### Generate plain titles
Click **Generate Plain Titles** in the admin panel. Ollama reads each bill's title and description and writes a short, human-friendly name (e.g. "City Agrees to Buy Electricity and Fuel for a Few Years").

### Auto-tag bills
Click **Tag Untagged Bills**. Ollama assigns 1–3 category tags (housing, zoning, budget, etc.) to each bill. Tags appear as filterable pills on the home feed.

### Analyze a bill
In the **Analyze Bills** section, click **Analyze** on any bill. This generates:
- Plain-language summary
- Impact score (1–10) and level (low/medium/high)
- Bill type (substantive/ceremonial/procedural)
- 3 base perspectives (Progressive, Conservative, Libertarian)

### View bills
Go to **http://localhost:3000** — bills appear as a list with plain titles, category tags, and status badges. Click any bill for the full detail page including perspectives.

### Scrape council members (optional)
Click **Scrape Council Members** in the admin panel. Playwright scrapes all 17 council member profiles from phlcouncil.com (~2 minutes). Council members then appear at `/councilmembers` and their names link from bill detail pages.

---

## 6. Bulk ingest

To pull all ~8,500 Philadelphia bills at once:
1. In admin, check **Bulk Export** and click **Ingest Bills**
2. Takes 2–3 minutes; bills are stored without analysis
3. Run **Generate Plain Titles** and **Tag Untagged Bills** to process them
4. Analyze individually as needed

---

## 7. Troubleshooting

**"No module named 'app'"** — run all commands from the `Common_Ground/` root directory.

**Playwright timeout on Legistar** — Legistar can be slow. The scraper has a 60s timeout. Try again; it's usually a transient load issue.

**AI returns empty response** — check Ollama is running (`ollama serve`) and the model is pulled (`ollama list`). Verify the model name in `.env` matches exactly (e.g. `llama3.1:8b` not `llama3`).

**Tags/plain titles not appearing** — run **Tag Untagged Bills** and **Generate Plain Titles** from the admin panel after ingesting bills.

**Frontend build errors** — run `cd frontend && npm install` to ensure dependencies are up to date.

**Admin panel redirects to home** — you must be logged in as a dev user. Click **Dev Login** on the navbar.
