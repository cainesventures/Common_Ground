# close.ps1 - Stop backend and frontend

Write-Host "`nStopping Common Ground..." -ForegroundColor Yellow

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

$backendPids = (Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue).OwningProcess | Select-Object -Unique
if ($backendPids) {
    $backendPids | ForEach-Object { Stop-ProcessAndWindow $_ }
    Write-Host "  Backend stopped (port 8000)" -ForegroundColor Green
} else {
    Write-Host "  Backend was not running" -ForegroundColor Gray
}

$frontendPids = (Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue).OwningProcess | Select-Object -Unique
if ($frontendPids) {
    $frontendPids | ForEach-Object { Stop-ProcessAndWindow $_ }
    Write-Host "  Frontend stopped (port 3000)" -ForegroundColor Green
} else {
    Write-Host "  Frontend was not running" -ForegroundColor Gray
}

Write-Host "`nDone.`n" -ForegroundColor Green

Stop-Process -Id $PID
