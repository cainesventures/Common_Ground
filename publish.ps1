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
    Log "Step 1/3 — Fetching new bills from Legistar..."
    python scripts/worker.py --steps fetch
    if ($LASTEXITCODE -ne 0) { Fail "Bill fetch failed. Fix errors above before continuing." }
    Log "Fetch complete."
} else {
    Log "Step 1/3 — Skipping fetch."
}

# Step 2: Enrich with Ollama (full analysis pipeline)
if (-not $SkipEnrich) {
    Log "Step 2/3 — Running Ollama enrichment pipeline..."
    python scripts/worker.py
    if ($LASTEXITCODE -ne 0) { Fail "Enrichment failed. Fix errors above before continuing." }
    Log "Enrichment complete."
} else {
    Log "Step 2/3 — Skipping enrichment."
}

# Step 3: Sync to Backblaze B2 + trigger Railway redeploy
Log "Step 3/3 — Uploading DB to Backblaze B2..."
& "C:\tools\litestream.exe" replicate -config "$ROOT\litestream.yml" -once -force-snapshot
if ($LASTEXITCODE -ne 0) { Fail "Litestream upload failed. Check B2 credentials and bucket." }
Log "Upload complete."

Log "Triggering Railway redeploy..."
$headers = @{ Authorization = "Bearer $env:RAILWAY_TOKEN" }
$body = @{ query = "mutation { serviceInstanceRedeploy(environmentId: \"$env:RAILWAY_ENVIRONMENT_ID\", serviceId: \"$env:RAILWAY_SERVICE_ID\") }" } | ConvertTo-Json
try {
    Invoke-RestMethod -Uri "https://backboard.railway.com/graphql/v2" -Method Post -Headers $headers -Body $body -ContentType "application/json" | Out-Null
    Log "Redeploy triggered. Production will update in ~2 minutes."
} catch {
    Log "Could not auto-trigger Railway redeploy — trigger it manually in the Railway dashboard."
}

Log ""
Log "Done. opencommonground.com will reflect new data shortly."
