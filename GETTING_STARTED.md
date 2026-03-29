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
cd frontend && npm install
```

---

## 2. Set up environment

```bash
cp .env.example .env
```

Edit `.env` — minimum required:

```env
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
JWT_SECRET=some_random_string_here

# AI (defaults to Ollama — free and local)
AI_PROVIDER=ollama
AI_MODEL=llama3
AI_BASE_URL=http://localhost:11434
```

Generate a random JWT secret:
```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

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

---

## 5. First run walkthrough

### Give yourself dev access
After signing in with Google, set your account to dev tier in the DB:

```bash
python -c "
from app.models.database import SessionLocal
from app.models import User
db = SessionLocal()
u = db.query(User).first()
u.subscription_tier = 'dev'
db.commit()
print('Done:', u.email)
db.close()
"
```

### Ingest some bills
1. Go to **http://localhost:3000/admin**
2. Click the **Local** tab
3. City: `philadelphia`, Limit: `5`
4. Click **Ingest Local Bills**

The Playwright scraper will open a headless browser, navigate to phila.legistar.com, filter to Type=Bill, and import 5 real Philadelphia ordinances.

### Analyze a bill
Once bills appear in the **Analyze Bills** section at the top of the admin page:
1. Click **Analyze** on any bill
2. This calls the AI to generate a plain-language summary, impact score, and 3 base perspectives

You need Ollama running with a model pulled (`ollama pull llama3`) for this step. Or set `AI_PROVIDER=claude` with your API key.

### View a bill
Go to **http://localhost:3000** — click any bill to see the detail page with summary, impact badges, and the perspectives panel.

---

## 6. Bulk ingest (optional)

To pull all ~8,500 Philadelphia bills at once via Excel export:
- In admin, check **Bulk Export** and click **Ingest Local Bills**
- Takes 2–3 minutes; bills land in DB without analysis
- Analyze them individually as needed

---

## 7. Troubleshooting

**"No module named 'app'"** — run commands from the `Common_Ground/` root directory.

**Playwright timeout on Legistar** — Legistar can be slow. The scraper has a 60s timeout. Try again; it's usually a transient load issue.

**AI returns empty response** — check Ollama is running (`ollama serve`) and the model is pulled (`ollama list`). Or verify your `AI_API_KEY` if using Claude/OpenAI.

**Google OAuth redirect mismatch** — ensure `APP_URL=http://localhost:8000` and your Google Cloud Console has `http://localhost:8000/api/auth/google/callback` as an authorized redirect URI.

**Frontend build errors** — run `cd frontend && npm install` to ensure dependencies are up to date.
