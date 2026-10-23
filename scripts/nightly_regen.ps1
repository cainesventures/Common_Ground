# nightly_regen.ps1 - one-time overnight headline/lede cleanup (scheduled 2026-10-23 23:00)
#
# Runs the guarded regen scripts in short resumable slices. Every script
# checkpoints per bill, so a slice that stops (budget, VRAM guard, Ctrl-C)
# loses nothing and the next slice resumes.
#
# Refuses to start outside 22:30-06:00. The task is registered WITHOUT
# StartWhenAvailable, and this check is the second lock: a missed 11pm run
# must never fire the next morning while the owner is at the machine.

$ErrorActionPreference = 'Continue'
$root = 'C:\Projects\Common_Ground'
Set-Location $root
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$log = Join-Path $root "logs\nightly-regen-$stamp.log"
Start-Transcript -Path $log | Out-Null

$now = Get-Date
if ($now.Hour -ge 6 -and ($now.Hour -lt 22 -or ($now.Hour -eq 22 -and $now.Minute -lt 30))) {
    Write-Host "REFUSED - $($now.ToString('HH:mm')) is outside the 22:30-06:00 window."
    Stop-Transcript | Out-Null
    exit 1
}

try {
    Invoke-WebRequest -Uri 'http://localhost:11434/api/tags' -TimeoutSec 10 -UseBasicParsing | Out-Null
} catch {
    Write-Host "ABORT - Ollama is not answering on :11434."
    Stop-Transcript | Out-Null
    exit 1
}

function Run-Slice($label, $argsList) {
    if ((Get-Date).Hour -ge 6 -and (Get-Date).Hour -lt 22) {
        Write-Host "STOP - past 06:00, leaving the rest for another night."
        return $false
    }
    Write-Host "`n=== $label  $(Get-Date -Format 'HH:mm:ss') ==="
    & python @argsList
    Write-Host "=== $label exit $LASTEXITCODE ==="
    Start-Sleep -Seconds 60   # let the GPU and driver settle between slices
    return $true
}

# Quality headlines: up to 4 x 45 min. A slice with nothing left exits in seconds.
for ($i = 1; $i -le 4; $i++) {
    if (-not (Run-Slice "quality headlines slice $i" @('scripts\regenerate_headlines.py', '--target', 'quality', '--apply', '--budget-minutes', '45'))) { break }
}
Run-Slice 'never-enacted headlines' @('scripts\regenerate_headlines.py', '--apply', '--budget-minutes', '20') | Out-Null
Run-Slice 'live-bill ledes' @('scripts\regenerate_flagged_ledes.py', '--apply', '--budget-minutes', '15') | Out-Null

Write-Host "`n=== remaining after the run ==="
& python scripts\audit_headline_consistency.py
Write-Host "Done $(Get-Date -Format 'HH:mm:ss'). Revert with: python scripts\regenerate_headlines.py --target quality --revert --apply"
Stop-Transcript | Out-Null
