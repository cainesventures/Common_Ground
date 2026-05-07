# schedule_publish.ps1
# Registers a weekly Windows Task Scheduler job that runs the full publish pipeline:
#   fetch new bills → enrich with Ollama → regenerate narrative + sitemap → push to B2 → Railway redeploy
#
# Runs every Friday at 6:00am (after Thursday City Council sessions).
# Run once as Administrator to register. Re-run to update settings.
#
# Usage:
#   .\scripts\schedule_publish.ps1                       # schedule at default time (Friday 6am)
#   .\scripts\schedule_publish.ps1 -DayOfWeek Monday     # different day
#   .\scripts\schedule_publish.ps1 -AtTime "08:00"       # different time
#   .\scripts\schedule_publish.ps1 -Remove               # remove the scheduled task

param(
    [string]$DayOfWeek = "Friday",
    [string]$AtTime = "06:00",
    [switch]$Remove
)

$TaskName   = "CommonGroundPublish"
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

$Action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NonInteractive -ExecutionPolicy Bypass -File `"$PublishScript`"" `
    -WorkingDirectory $ProjectRoot

$Trigger = New-ScheduledTaskTrigger `
    -Weekly `
    -DaysOfWeek $DayOfWeek `
    -At $AtTime

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
    -Description "Common Ground weekly publish: fetch Legistar bills, enrich with Ollama, push to B2 + Railway" `
    | Out-Null

Write-Host ""
Write-Host "Registered: $TaskName"
Write-Host "  Schedule: Every $DayOfWeek at $AtTime"
Write-Host "  Script  : $PublishScript"
Write-Host ""
Write-Host "Commands:"
Write-Host "  Run now  : Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "  Status   : Get-ScheduledTask  -TaskName '$TaskName' | Select-Object -ExpandProperty State"
Write-Host "  Last run : (Get-ScheduledTaskInfo -TaskName '$TaskName').LastRunTime"
Write-Host "  Disable  : Disable-ScheduledTask -TaskName '$TaskName'"
Write-Host "  Remove   : .\scripts\schedule_publish.ps1 -Remove"
Write-Host ""
