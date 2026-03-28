# fresh_start.ps1 - Stop everything, wipe DB, reseed, restart backend + frontend

$ProjectRoot = "C:\Projects\Common_Ground"
$FrontendDir = "$ProjectRoot\frontend"

# -- 1. Stop backend and frontend ---------------------------------------------
Write-Host "`nStopping existing processes..." -ForegroundColor Yellow

$backendPids = (Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue).OwningProcess | Select-Object -Unique
if ($backendPids) {
    $backendPids | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
    Write-Host "  Backend stopped (port 8000)" -ForegroundColor Green
} else {
    Write-Host "  Backend was not running" -ForegroundColor Gray
}

$frontendPids = (Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue).OwningProcess | Select-Object -Unique
if ($frontendPids) {
    $frontendPids | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
    Write-Host "  Frontend stopped (port 3000)" -ForegroundColor Green
} else {
    Write-Host "  Frontend was not running" -ForegroundColor Gray
}

Start-Sleep -Seconds 1

# -- 2. Fresh start (wipe DB, reseed, run moderator) --------------------------
Write-Host "`nRunning fresh start..." -ForegroundColor Yellow
Set-Location $ProjectRoot
python fresh_start.py
if ($LASTEXITCODE -ne 0) {
    Write-Host "`nFresh start failed - aborting." -ForegroundColor Red
    exit 1
}

# -- 3. Start backend ---------------------------------------------------------
Write-Host "`nStarting backend..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$ProjectRoot'; python -m uvicorn main:app --host 0.0.0.0 --port 8000"

Start-Sleep -Seconds 2

# -- 4. Start frontend --------------------------------------------------------
Write-Host "Starting frontend..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$FrontendDir'; npm run dev"

Write-Host "Waiting for frontend to be ready..." -ForegroundColor Yellow
$attempts = 0
do {
    Start-Sleep -Seconds 2
    $attempts++
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:3000" -TimeoutSec 2 -ErrorAction SilentlyContinue
        if ($response.StatusCode -eq 200) { break }
    } catch {}
} while ($attempts -lt 15)

Write-Host "Opening browser..." -ForegroundColor Yellow
Start-Process "http://localhost:3000"

Write-Host "`nDone! Backend on :8000, Frontend on :3000`n" -ForegroundColor Green
