# setup_scheduler.ps1
# Registers the Common Ground background worker as a Windows Task Scheduler job.
# Run once as Administrator. Re-run to update settings.
#
# The task:
#   - Runs every 30 minutes
#   - Runs missed executions when the computer wakes from sleep
#   - Does NOT run on battery power (configurable below)
#   - Runs in the background (hidden window)

param(
    [int]$IntervalMinutes = 30,
    [switch]$AllowOnBattery = $false
)

$TaskName    = "CommonGroundWorker"
$ProjectRoot = "C:\Projects\Common_Ground"
# Resolve full Python path so Task Scheduler can find it (it runs with a minimal PATH)
$PythonExe = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $PythonExe) { $PythonExe = "C:\Users\acain\AppData\Local\Microsoft\WindowsApps\python.exe" }
Write-Host "Using Python: $PythonExe"
$BatchSize   = 20
$LogDir      = "$ProjectRoot\logs"

# Ensure logs directory exists
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }

# Remove existing task if present
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Removed existing task '$TaskName'"
}

# Action: run python scripts/worker.py from the project root
$Action = New-ScheduledTaskAction `
    -Execute $PythonExe `
    -Argument "scripts\worker.py --batch $BatchSize --parallel 3" `
    -WorkingDirectory $ProjectRoot

# Trigger: every N minutes, starting now
$Trigger = New-ScheduledTaskTrigger `
    -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) `
    -Once `
    -At (Get-Date)

# Settings: run on wake, don't run on battery (unless overridden), hidden
$Settings = New-ScheduledTaskSettingsSet `
    -RunOnlyIfNetworkAvailable:$false `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 25) `
    -MultipleInstances IgnoreNew `
    -Hidden

if (-not $AllowOnBattery) {
    $Settings.DisallowStartIfOnBatteries = $true
    $Settings.StopIfGoingOnBatteries = $false
}

# Principal: run as current user
$Principal = New-ScheduledTaskPrincipal `
    -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) `
    -LogonType Interactive `
    -RunLevel Limited

# Register
Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $Action `
    -Trigger $Trigger `
    -Settings $Settings `
    -Principal $Principal `
    -Description "Common Ground background data enrichment worker. Processes bills through full pipeline (text, analyze, headline, metadata, perspectives, news)." `
    | Out-Null

Write-Host ""
Write-Host "Task '$TaskName' registered successfully."
Write-Host "  Interval  : every $IntervalMinutes minutes"
Write-Host "  On battery: $AllowOnBattery"
Write-Host "  Log file  : $LogDir\worker.log"
Write-Host ""
Write-Host "Commands:"
Write-Host "  View task   : Get-ScheduledTask -TaskName '$TaskName'"
Write-Host "  Run now     : Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "  Pause       : Disable-ScheduledTask -TaskName '$TaskName'"
Write-Host "  Resume      : Enable-ScheduledTask -TaskName '$TaskName'"
Write-Host "  Remove      : Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false"
Write-Host "  Status      : python scripts\worker_status.py"
Write-Host ""
