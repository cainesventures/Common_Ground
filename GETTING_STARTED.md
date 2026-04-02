# Getting Started — Common Ground

Get the app running locally in about 10 minutes.

---

## Prerequisites

- Python 3.10+
- Node.js 18+
- [Ollama](https://ollama.ai/download) (for free local AI) — **or** a Claude/OpenAI API key

> **Ollama auto-start:** Once installed, you don't need to manually run `ollama serve`. The backend detects when Ollama is not running and starts it automatically, then retries the AI request. You'll see the pipeline show **"Starting AI…"** for a few seconds on the first request after a cold start.

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
2. In the **Ingestion** section, set **Limit** to `10` and click **Ingest Bills**

The Playwright scraper opens a headless browser, navigates to phila.legistar.com, and imports real Philadelphia ordinances. For all ~8,500 bills, check **Bulk Export** instead.

### Run the Bill Pipeline
The **Bill Pipeline** section is a single unified workflow. By default Steps 2 (Analyze) and 3 (Perspectives) are checked. For a first run with a small batch, this is all you need:

1. Optionally set a **date scope** (year or month) to limit which bills are processed
2. Review the step checkboxes:
   - **Step 1: Sponsors** — backfills missing sponsor data from Legistar (off by default)
   - **Step 2: Analyze** — fetches full bill text, generates a plain title, auto-tags, and runs AI analysis (summary, impact score, bill type, 3 base perspectives)
   - **Step 3: Perspectives** — generates all 17 perspectives (use the multi-select to pick specific types)
   - **Step 4: News** — fetches Google News articles (off by default)
3. Click **Start Pipeline**

A live progress bar streams results as each bill is processed. Click **Stop** at any time to halt the run. Pipeline state persists across navigation — you can browse the site while it runs.

### Scrape council members
In the **Ingestion** section, click **Scrape Council Members**. Playwright scrapes all 17 council member profiles from phlcouncil.com (~2 minutes). Council members then appear at `/councilmembers` with their bio, district map, term start date, years serving, and next election year. Their names link from bill detail pages.

### View bills
Go to **http://localhost:3000** — bills appear as a list with plain titles, category tags, and status badges. Use the filter bar to search by keyword, tag, sponsor, impact level, or analysis status. All active filters are preserved in the URL. Click any bill for the full detail page including AI perspectives and news.

### View perspectives
On any analyzed bill's detail page, scroll to **AI Perspectives**. The tally at the top shows support/oppose/neutral/mixed counts with percentages. Click any row to expand the full perspective inline. Click **Generate** on any pending perspective to generate it on demand.

### Save bills
After logging in, click the bookmark icon on any bill card to save it. Access your saved bills at `/my-bills` (also in the navbar).

### Metrics
Go to **http://localhost:3000/dashboard** (dev users only). Shows bills analyzed, perspectives generated, position breakdown, user counts, and total bill saves.

---

## 6. Bulk ingest

To pull all ~8,500 Philadelphia bills at once:
1. In admin → **Ingestion**, check **Bulk Export** and click **Ingest Bills**
2. Takes 2–3 minutes; bills are stored without analysis
3. Go to **Bill Pipeline**, enable the steps you want, and click **Start Pipeline** to process them

---

## 7. Optional features

### Email digests (requires Resend)
1. Get a free API key at [resend.com](https://resend.com)
2. Add to `.env`:
   ```env
   RESEND_API_KEY=re_...
   EMAIL_FROM=Common Ground <digest@yourdomain.com>
   FRONTEND_BASE_URL=http://localhost:3000
   ```
3. Users opt in from their `/profile` page
4. Trigger a test send from admin → **Utilities** → **Send Digest**

### Donations (requires Stripe)
1. Create a Stripe account and get test keys from the [Stripe dashboard](https://dashboard.stripe.com)
2. Add to `.env`:
   ```env
   STRIPE_SECRET_KEY=sk_test_...
   STRIPE_PUBLISHABLE_KEY=pk_test_...
   STRIPE_WEBHOOK_SECRET=whsec_...   # from Stripe webhook settings
   ```
3. The donate page is at `/donate` — accessible to all visitors

To test webhooks locally, use the [Stripe CLI](https://stripe.com/docs/stripe-cli):
```bash
stripe listen --forward-to localhost:8000/api/donations/webhook
```

---

## 8. Troubleshooting

**"No module named 'app'"** — run all commands from the `Common_Ground/` root directory.

**Playwright timeout on Legistar** — Legistar can be slow. The scraper has a 60s timeout. Try again; it's usually a transient load issue.

**AI returns empty response or "Generation failed"** — Check that Ollama is installed. The backend will try to start it automatically, but if it's not installed you'll see an error banner. Run `ollama list` to verify the model is pulled.

**"model not found"** — The model name in `.env` doesn't match what's installed. Run `ollama list` to see exact names (e.g. `llama3.1:8b` not `llama3`).

**Tags/plain titles not appearing** — run the pipeline with Step 2 enabled after ingesting bills.

**News not showing on bill detail page** — run the pipeline with Step 4 (News) enabled.

**District map shows "Could not load district boundaries"** — the backend proxies Philadelphia GIS data from the city's ArcGIS server. This requires an internet connection. Check backend logs for the specific error.

**Frontend build errors** — run `cd frontend && npm install` to ensure dependencies are up to date.

**Admin panel redirects to home** — you must be logged in as a dev user. Click **Dev Login** on the navbar.

**Email digest not sending** — check that `RESEND_API_KEY` is set and the user has `digest_enabled = true`. Check backend logs for the Resend API response.

**Stripe checkout fails** — ensure `STRIPE_SECRET_KEY` starts with `sk_test_` (test mode) or `sk_live_` (live mode) and that the key matches your Stripe account. Check backend logs for the Stripe error.
