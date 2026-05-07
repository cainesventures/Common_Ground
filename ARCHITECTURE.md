# Open Common Ground — Architecture & Infrastructure Reference

Last updated: May 2026

---

## System Diagram

```
 YOUR MACHINE (local)
 ┌──────────────────────────────────────────────────┐
 │  Admin panel → ingest bills (Playwright/Legistar) │
 │  Ollama llama3.1:8b → analyze + enrich bills      │
 │  publish.ps1 → orchestrates the full pipeline     │
 │  SQLite DB (common_ground_test.db, ~140MB)         │
 │       │                                            │
 │  Litestream replicate -once -force-snapshot        │
 └───────┼────────────────────────────────────────────┘
         │
         ▼
 ┌───────────────────┐
 │   Backblaze B2    │  bucket: opencommonground-db
 │  (DB snapshots)   │  endpoint: s3.us-east-005.backblazeb2.com
 └───────┬───────────┘
         │ restore on startup
         ▼
 ┌───────────────────┐       ┌──────────────────────────────┐
 │     Railway       │◄──────│        Cloudflare            │
 │  FastAPI backend  │       │  DNS · CDN · Email routing   │
 │  SQLite + WAL     │       │  api.opencommonground.com    │
 │  port: $PORT      │       └──────────────┬───────────────┘
 └───────────────────┘                      │
                                            │ opencommonground.com
                                 ┌──────────▼───────────┐
                                 │       Vercel          │
                                 │   Next.js 15 frontend │
                                 │   auto-deploy on push │
                                 └──────────────────────┘

 EXTERNAL SERVICES (called by backend or frontend)
 ┌──────────────┐  ┌───────────┐  ┌─────────┐  ┌──────────┐
 │ Google OAuth │  │  Stripe   │  │  Sentry │  │  PostHog │
 │   (auth)     │  │(donations)│  │ (errors)│  │(analytics│
 └──────────────┘  └───────────┘  └─────────┘  └──────────┘

 AUTOMATION
 ┌─────────────────────────────────────────────┐
 │  GitHub Actions — daily 9am ET              │
 │  workers/bluesky_bot.py → posts to Bluesky  │
 │  API_BASE: Railway URL (bypasses Cloudflare)│
 └─────────────────────────────────────────────┘

 MONITORING
 ┌──────────────────────────────────────┐
 │  UptimeRobot — checks every 5 min   │
 │  opencommonground.com                │
 │  api.opencommonground.com/health     │
 │  Alerts → cainesventures@gmail.com  │
 └──────────────────────────────────────┘
```

---

## Data Flow

### User visits the site
```
Browser → Cloudflare → Vercel (Next.js)
                            │ API calls (/api/*)
                            ▼
                     Cloudflare → Railway (FastAPI) → SQLite
```

### Publish new bills to production
```
1. Admin panel → scrape Legistar → new bills in local SQLite
2. Admin panel → Ollama pipeline → bills enriched (titles, tags, impact, perspectives)
3. publish.ps1 → generate_sitemap.py → frontend/public/sitemap.xml updated
4. publish.ps1 → Litestream replicate → DB snapshot uploaded to Backblaze B2
5. Railway dashboard → Redeploy → Railway restores DB from B2 on startup
6. git push → Vercel auto-deploys new sitemap.xml
```

### User signs in
```
Browser → /api/auth/google → Google OAuth consent screen
       ← Google callback → Railway issues JWT → stored in localStorage
```

### User makes a donation
```
Browser → /api/donations/checkout → Railway → Stripe Checkout session
       ← Stripe redirects to /donate/success
Stripe webhook → /api/donations/webhook → Railway records payment
```

---

## Service Inventory

| Service | Purpose | Dashboard | Credentials |
|---------|---------|-----------|-------------|
| **Cloudflare** | DNS, CDN, email routing, bot protection | dash.cloudflare.com | Cloudflare account |
| **Vercel** | Frontend hosting, auto-deploy on push | vercel.com/dashboard | GitHub OAuth |
| **Railway** | Backend hosting, auto-deploy on push | railway.com | GitHub OAuth |
| **Backblaze B2** | SQLite DB snapshots (publish + backup) | backblaze.com/b2/buckets | `.env` B2_APPLICATION_KEY_ID / B2_APPLICATION_KEY |
| **Google OAuth** | User authentication | console.cloud.google.com | Railway env: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET |
| **Stripe** | One-time donations | dashboard.stripe.com | Railway env: STRIPE_SECRET_KEY / STRIPE_PUBLISHABLE_KEY / STRIPE_WEBHOOK_SECRET |
| **Sentry** | Error tracking (frontend + backend) | sentry.io | Railway env: SENTRY_DSN · Vercel env: NEXT_PUBLIC_SENTRY_DSN |
| **PostHog** | Product analytics | app.posthog.com | Vercel env: NEXT_PUBLIC_POSTHOG_KEY / NEXT_PUBLIC_POSTHOG_HOST |
| **GitHub Actions** | Bluesky bot (runs daily 9am ET) | github.com → Actions tab | GitHub secrets: BLUESKY_HANDLE / BLUESKY_APP_PASSWORD |
| **Bluesky** | Social media bot posts | bsky.app / @opencommonground.bsky.social | GitHub secrets (above) |
| **UptimeRobot** | Uptime alerts every 5 min | uptimerobot.com | cainesventures@gmail.com account |
| **Ollama** | Local AI enrichment (your machine only) | localhost:11434 | Not cloud — installed locally |
| **Resend** | Weekly email digests (optional, not active) | resend.com | Railway env: RESEND_API_KEY |

---

## Environment Variables

### Railway (backend)
| Variable | What it does |
|----------|-------------|
| `DATABASE_URL` | `sqlite:////data/common_ground.db` — Railway volume path |
| `JWT_SECRET` | Signs auth tokens — must be a strong random value |
| `ENVIRONMENT` | `production` |
| `FRONTEND_URL` | `https://opencommonground.com` — CORS allow-list |
| `APP_BASE_URL` | `https://api.opencommonground.com` — OAuth redirect base |
| `GOOGLE_CLIENT_ID` | Google OAuth app credential |
| `GOOGLE_CLIENT_SECRET` | Google OAuth app credential |
| `STRIPE_SECRET_KEY` | `sk_live_...` — must be secret key, not publishable |
| `STRIPE_PUBLISHABLE_KEY` | `pk_live_...` |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` from Stripe webhook settings |
| `B2_APPLICATION_KEY_ID` | Backblaze B2 key ID (for Litestream restore on startup) |
| `B2_APPLICATION_KEY` | Backblaze B2 key |
| `SENTRY_DSN` | Backend Sentry project DSN |

### Vercel (frontend)
| Variable | What it does |
|----------|-------------|
| `NEXT_PUBLIC_API_URL` | `https://api.opencommonground.com` |
| `NEXT_PUBLIC_POSTHOG_KEY` | PostHog analytics key |
| `NEXT_PUBLIC_POSTHOG_HOST` | PostHog host (usually `https://app.posthog.com`) |
| `NEXT_PUBLIC_SENTRY_DSN` | Frontend Sentry project DSN |
| `NEXT_PUBLIC_BACKEND_URL` | Same as API_URL — used for server-side metadata fetches |

### GitHub Secrets (Actions)
| Secret | What it does |
|--------|-------------|
| `BLUESKY_HANDLE` | `opencommonground.bsky.social` |
| `BLUESKY_APP_PASSWORD` | App password from Bluesky settings |

---

## Deploy Checklist (after code changes)

**Frontend change** → `git push` → Vercel auto-deploys (~2 min)

**Backend change** → `git push` → Railway auto-deploys (~3 min)

**New bills / data update** → run `publish.ps1` → then redeploy Railway from dashboard

---

## Troubleshooting

### Site is down (frontend)
1. Check UptimeRobot alert email for which monitor failed
2. Go to vercel.com → check deployment status and logs
3. Check Cloudflare status at cloudflarestatus.com
4. If Vercel build failed: check the error in Vercel dashboard → fix code → push

### API is down (backend)
1. Go to railway.com → open the service → check deployment logs
2. Common causes:
   - DB restore from B2 failed on startup → check B2 credentials in Railway env vars
   - JWT_SECRET missing → Railway env vars → check ENVIRONMENT=production
   - Out of memory → Railway dashboard → check resource usage
3. Force a redeploy from Railway dashboard to trigger a fresh DB restore

### Data is stale (bills not updated)
Run the publish workflow:
```powershell
.\publish.ps1          # full pipeline
.\publish.ps1 -SkipFetch    # skip scrape, just re-enrich + publish
.\publish.ps1 -SkipFetch -SkipEnrich  # just upload current DB
```
Then redeploy Railway from the dashboard.

### Bluesky bot not posting
1. Go to GitHub → Actions → Bluesky Bot → check last run logs
2. Common causes:
   - No high-impact bills to spotlight → bot logs "No spotlight bill found"
   - Bluesky app password expired → regenerate at bsky.app → update GitHub secret
   - API unreachable → check Railway is up
3. Trigger a manual run: GitHub → Actions → Bluesky Bot → Run workflow

### Google OAuth not working (users can't sign in)
1. Check Google Cloud Console → APIs & Services → Credentials → OAuth client
2. Verify `https://api.opencommonground.com/api/auth/google/callback` is in authorized redirect URIs
3. Check Railway env vars: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, APP_BASE_URL
4. If "unverified app" warning: verification is pending — only test accounts can sign in

### Stripe donations failing
1. Check that Railway STRIPE_SECRET_KEY starts with `sk_live_` (not `sk_test_` or `pk_live_`)
2. Verify webhook is registered: Stripe dashboard → Webhooks → `POST /api/donations/webhook`
3. Check Sentry for the specific error from the checkout or webhook handler

### Sentry not receiving errors
1. Check SENTRY_DSN in Railway env vars (backend)
2. Check NEXT_PUBLIC_SENTRY_DSN in Vercel env vars (frontend)
3. Sentry free tier: 5,000 errors/month — check if quota is hit at sentry.io

### Litestream / DB out of sync
Test restore to verify B2 has a valid snapshot:
```powershell
$env:B2_APPLICATION_KEY_ID="your_id"
$env:B2_APPLICATION_KEY="your_key"
C:\tools\litestream.exe restore -o C:\Temp\test_restore.db -config litestream.yml
```
If restore fails: check B2 bucket at backblaze.com → verify snapshots exist.

---

## Key URLs

| What | URL |
|------|-----|
| Live site | https://opencommonground.com |
| API | https://api.opencommonground.com |
| API health | https://api.opencommonground.com/health |
| Vercel dashboard | https://vercel.com/dashboard |
| Railway dashboard | https://railway.com |
| Cloudflare dashboard | https://dash.cloudflare.com |
| Backblaze B2 | https://www.backblaze.com/b2/buckets |
| Sentry | https://sentry.io |
| PostHog | https://app.posthog.com |
| UptimeRobot | https://uptimerobot.com/dashboard |
| Bluesky profile | https://bsky.app/profile/opencommonground.bsky.social |
| GitHub Actions | https://github.com/cainesventures/Common_Ground/actions |
| Google Cloud Console | https://console.cloud.google.com |
| Stripe dashboard | https://dashboard.stripe.com |
