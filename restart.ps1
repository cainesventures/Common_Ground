# restart.ps1 - Stop and restart Common Ground backend + frontend

$ProjectRoot = "C:\Projects\Common_Ground"
$FrontendDir = "$ProjectRoot\frontend"

Write-Host "`nStopping existing processes..." -ForegroundColor Yellow

# Helper: kill a process and its parent PowerShell window
function Stop-ProcessAndWindow($procId) {
    $parentPid = (Get-CimInstance Win32_Process -Filter "ProcessId = $procId" -ErrorAction SilentlyContinue).ParentProcessId
    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    if ($parentPid) {
        $parent = Get-Process -Id $parentPid -ErrorAction SilentlyContinue
        if ($parent -and $parent.Name -match "powershell|pwsh") {
            Stop-Process -Id $parentPid -Force -ErrorAction SilentlyContinue
        }
    }
}

# Kill backend (port 8000)
$backendPids = (Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue).OwningProcess | Select-Object -Unique
if ($backendPids) {
    $backendPids | ForEach-Object { Stop-ProcessAndWindow $_ }
    Write-Host "  Backend stopped (port 8000)" -ForegroundColor Green
} else {
    Write-Host "  Backend was not running" -ForegroundColor Gray
}

# Kill frontend (port 3000)
$frontendPids = (Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue).OwningProcess | Select-Object -Unique
if ($frontendPids) {
    $frontendPids | ForEach-Object { Stop-ProcessAndWindow $_ }
    Write-Host "  Frontend stopped (port 3000)" -ForegroundColor Green
} else {
    Write-Host "  Frontend was not running" -ForegroundColor Gray
}

Start-Sleep -Seconds 1

Write-Host "`nStarting backend..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$ProjectRoot'; python -m uvicorn main:app --host 0.0.0.0 --port 8000"

Start-Sleep -Seconds 2

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

Stop-Process -Id $PID
