# /publish — Fetch, enrich, and publish new bills to production

Run the full data pipeline: scrape new bills from Legistar, enrich with Ollama, upload DB to Backblaze B2, and trigger a Railway redeploy.

## What this does

1. Fetches any new bills from Philadelphia Legistar into the local DB
2. Runs the Ollama enrichment pipeline (full text, analysis, perspectives, news)
3. Uploads the updated DB snapshot to Backblaze B2 via Litestream
4. Triggers a Railway redeploy so production picks up the new data

## How to run

Tell the user to run this in PowerShell from the project root:

```powershell
.\publish.ps1
```

Options:
- `.\publish.ps1 -SkipFetch` — skip Legistar scrape, just enrich + publish (use when bills are already fetched)
- `.\publish.ps1 -SkipEnrich` — skip Ollama, just publish current DB as-is (use after manual DB changes)

## Prerequisites

Make sure the following are set in `.env`:
- `B2_APPLICATION_KEY_ID` — Backblaze App Key ID
- `B2_APPLICATION_KEY` — Backblaze App Key
- `RAILWAY_TOKEN` — Railway API token (optional — for auto-redeploy; otherwise redeploy manually in dashboard)

Litestream must be installed at `C:\tools\litestream.exe`.

## After running

Production updates in ~2 minutes after Railway redeploys. Check https://api.opencommonground.com/health to confirm the service is up.

## Instructions

Walk the user through any step that fails. Common issues:
- Ollama not running → start Ollama first: `ollama serve`
- B2 credentials expired → rotate App Key in Backblaze dashboard, update `.env`
- Railway redeploy failed → go to Railway dashboard and click Redeploy manually
