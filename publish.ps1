# publish.ps1 — Full pipeline: fetch new bills, enrich with Ollama, push to production
#
# Usage: .\publish.ps1
# Optional: .\publish.ps1 -SkipFetch   (skip bill fetch, just enrich + publish)
# Optional: .\publish.ps1 -SkipEnrich  (skip enrichment, just publish DB as-is)

param(
    [switch]$SkipFetch,
    [switch]$SkipEnrich
)

$ErrorActionPreference = "Stop"
$ROOT = "C:\Projects\Common_Ground"

function Log($msg) {
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] $msg" -ForegroundColor Cyan
}

function Fail($msg) {
    Write-Host "[ERROR] $msg" -ForegroundColor Red
    exit 1
}

# Load .env
Get-Content "$ROOT\.env" | ForEach-Object {
    if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
        [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), "Process")
    }
}

Set-Location $ROOT

# Step 1: Fetch new bills from Legistar
if (-not $SkipFetch) {
    Log "Step 1/4 — Fetching new bills from Legistar..."
    python scripts/worker.py --steps fetch
    if ($LASTEXITCODE -ne 0) { Fail "Bill fetch failed. Fix errors above before continuing." }
    Log "Fetch complete."
} else {
    Log "Step 1/4 — Skipping fetch."
}

# Step 2: Enrich with Ollama (full analysis pipeline)
if (-not $SkipEnrich) {
    Log "Step 2/4 — Running Ollama enrichment pipeline..."
    python scripts/worker.py
    if ($LASTEXITCODE -ne 0) { Fail "Enrichment failed. Fix errors above before continuing." }
    Log "Enrichment complete."
} else {
    Log "Step 2/4 — Skipping enrichment."
}

# Step 3: Regenerate static sitemap.xml
Log "Step 3/4 — Regenerating sitemap.xml..."
python scripts/generate_sitemap.py
if ($LASTEXITCODE -ne 0) { Fail "Sitemap generation failed." }
Log "Sitemap updated."

# Step 4: Sync to Backblaze B2 + trigger Railway redeploy
Log "Step 4/4 — Uploading DB to Backblaze B2..."
& "C:\tools\litestream.exe" replicate -config "$ROOT\litestream.yml" -once -force-snapshot
if ($LASTEXITCODE -ne 0) { Fail "Litestream upload failed. Check B2 credentials and bucket." }
Log "Upload complete."

Log ""
Log "============================================================"
Log " DB uploaded to Backblaze B2 successfully."
Log ""
Log " ACTION REQUIRED: Trigger a redeploy in Railway dashboard."
Log "   1. Go to railway.com → opencommonground-api"
Log "   2. Click Redeploy"
Log "   3. Production updates in ~2 minutes"
Log "============================================================"
