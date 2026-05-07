# schedule_publish.ps1
# Registers a Windows Task Scheduler job that runs the full publish pipeline
# at logon — but only if it hasn't run in the last 5 days.
#
# Resilient to your usage pattern:
#   - Computer asleep?  → runs on next wake/login
#   - Didn't log in for a week?  → runs immediately on next login
#   - Log in every day?  → only runs once every 5 days (gate check)
#
# Run once as Administrator to register. Re-run to update settings.
#
# Usage:
#   .\scripts\schedule_publish.ps1                  — register (default: 5-day interval)
#   .\scripts\schedule_publish.ps1 -MinDays 7       — run at most once per week
#   .\scripts\schedule_publish.ps1 -Remove          — remove the scheduled task
#   Start-ScheduledTask -TaskName CommonGroundPublish — run immediately (bypasses gate)

param(
    [int]$MinDays = 5,
    [switch]$Remove
)

$TaskName    = "CommonGroundPublish"
$ProjectRoot = "C:\Projects\Common_Ground"
$PublishScript = "$ProjectRoot\publish.ps1"

if ($Remove) {
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "Removed scheduled task '$TaskName'"
    } else {
        Write-Host "Task '$TaskName' not found."
    }
    exit 0
}

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Removed existing task '$TaskName'"
}

# Runs publish.ps1 with the minimum-interval gate so it only fires every $MinDays days
$scriptArgs = "-NonInteractive -ExecutionPolicy Bypass -File `"$PublishScript`" -MinDaysSinceLastRun $MinDays"

$Action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument $scriptArgs `
    -WorkingDirectory $ProjectRoot

# Fire at every logon — the MinDaysSinceLastRun gate inside publish.ps1 prevents
# it from actually running more than once per interval
$Trigger = New-ScheduledTaskTrigger -AtLogOn

$Settings = New-ScheduledTaskSettingsSet `
    -RunOnlyIfNetworkAvailable `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 4) `
    -MultipleInstances IgnoreNew `
    -Hidden

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
    -Description "Common Ground publish pipeline — runs at logon if $MinDays+ days since last run" `
    | Out-Null

Write-Host ""
Write-Host "Registered: $TaskName"
Write-Host "  Trigger : At every logon"
Write-Host "  Gate    : Only runs if last publish was $MinDays+ days ago"
Write-Host "  Script  : $PublishScript"
Write-Host ""
Write-Host "Commands:"
Write-Host "  Run now (bypasses gate) : Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "  Check last run time     : (Get-ScheduledTaskInfo -TaskName '$TaskName').LastRunTime"
Write-Host "  See last publish date   : Get-Content '$ProjectRoot\.last_publish'"
Write-Host "  Disable                 : Disable-ScheduledTask -TaskName '$TaskName'"
Write-Host "  Remove                  : .\scripts\schedule_publish.ps1 -Remove"
Write-Host ""
