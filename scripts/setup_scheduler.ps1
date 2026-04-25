# setup_scheduler.ps1
# Registers two Common Ground workers as Windows Task Scheduler jobs.
# Run once as Administrator. Re-run to update settings.
#
# CommonGroundWorkerFast  — text, analyze, headline, metadata, news (batch=150, parallel=10)
# CommonGroundWorkerPersp — perspectives only (batch=28, parallel=10)
# Both run every 30 minutes, staggered by 2 minutes.

param(
    [int]$IntervalMinutes = 30,
    [switch]$AllowOnBattery = $false
)

$ProjectRoot = "C:\Projects\Common_Ground"
$PythonExe = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $PythonExe) { $PythonExe = "C:\Users\acain\AppData\Local\Microsoft\WindowsApps\python.exe" }
Write-Host "Using Python: $PythonExe"

$LogDir = "$ProjectRoot\logs"
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }

function Register-Worker {
    param(
        [string]$TaskName,
        [string]$ScriptArgs,
        [int]$DelaySeconds = 0
    )

    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "Removed existing task '$TaskName'"
    }

    $StartAt = (Get-Date).AddSeconds($DelaySeconds)

    $Action = New-ScheduledTaskAction `
        -Execute $PythonExe `
        -Argument $ScriptArgs `
        -WorkingDirectory $ProjectRoot

    $Trigger = New-ScheduledTaskTrigger `
        -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) `
        -Once `
        -At $StartAt

    $Settings = New-ScheduledTaskSettingsSet `
        -RunOnlyIfNetworkAvailable:$false `
        -StartWhenAvailable `
        -ExecutionTimeLimit (New-TimeSpan -Minutes 29) `
        -MultipleInstances IgnoreNew `
        -Hidden

    if (-not $AllowOnBattery) {
        $Settings.DisallowStartIfOnBatteries = $true
        $Settings.StopIfGoingOnBatteries = $false
    }

    $Principal = New-ScheduledTaskPrincipal `
        -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) `
        -LogonType Interactive `
        -RunLevel Limited

    Register-ScheduledTask `
        -TaskName $TaskName `
        -Action $Action `
        -Trigger $Trigger `
        -Settings $Settings `
        -Principal $Principal `
        -Description "Common Ground background worker: $ScriptArgs" `
        | Out-Null

    Write-Host "  Registered: $TaskName"
}

# Fast worker — starts immediately (text, analyze, headline, metadata, news)
Register-Worker `
    -TaskName "CommonGroundWorkerFast" `
    -ScriptArgs "scripts\worker_fast.py --batch 1000 --parallel 25" `
    -DelaySeconds 0

# Perspectives worker — starts 2 minutes later to stagger Ollama load
Register-Worker `
    -TaskName "CommonGroundWorkerPersp" `
    -ScriptArgs "scripts\worker_perspectives.py --batch 28 --parallel 10" `
    -DelaySeconds 120

Write-Host ""
Write-Host "Both tasks registered. Interval: every $IntervalMinutes minutes."
Write-Host "  Fast worker  : batch=1000 parallel=25 (text/analyze/headline/metadata/news)"
Write-Host "  Persp worker : batch=28  parallel=10 (perspectives, GPU-bound)"
Write-Host ""
Write-Host "Commands:"
Write-Host "  Status       : python scripts\worker_status.py"
Write-Host "  Run fast now : Start-ScheduledTask -TaskName 'CommonGroundWorkerFast'"
Write-Host "  Run persp now: Start-ScheduledTask -TaskName 'CommonGroundWorkerPersp'"
Write-Host "  Pause fast   : Disable-ScheduledTask -TaskName 'CommonGroundWorkerFast'"
Write-Host "  Pause persp  : Disable-ScheduledTask -TaskName 'CommonGroundWorkerPersp'"
Write-Host "  Remove all   : Unregister-ScheduledTask -TaskName 'CommonGroundWorkerFast' -Confirm:`$false; Unregister-ScheduledTask -TaskName 'CommonGroundWorkerPersp' -Confirm:`$false"
Write-Host ""
