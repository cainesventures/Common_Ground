# schedule_publish.ps1
# Registers the Windows Task Scheduler job that runs the full publish pipeline.
#
# Why three triggers rather than one:
#
#   A single -AtLogOn trigger only fires on an actual interactive logon. With
#   Fast Startup enabled (the default), a normal "Shut down" usually resumes
#   from a hiberfile instead, which produces no logon event, so the task can sit
#   idle for weeks on a machine that is in use every day. That is exactly what
#   happened here: the task's last run was 18 seconds after the last real boot,
#   and nothing fired in the six days of sleep/wake cycles afterwards.
#
#   So: logon AND startup AND a daily clock trigger. The daily one is the
#   dependable one -- with StartWhenAvailable, a trigger missed because the
#   machine was asleep runs shortly after it wakes. The publish script's own
#   -MinDaysSinceLastRun gate is what stops three triggers causing three
#   publishes.
#
# Run once as Administrator to register. Re-run to update settings.
#
# Usage:
#   .\scripts\schedule_publish.ps1                  - register (default: 5-day gate, 10:00 daily)
#   .\scripts\schedule_publish.ps1 -MinDays 7       - publish at most once per week
#   .\scripts\schedule_publish.ps1 -DailyAt 03:30   - move the daily check
#   .\scripts\schedule_publish.ps1 -Status          - trigger/settings/last-run diagnostics
#   .\scripts\schedule_publish.ps1 -Remove          - remove the scheduled task
#   Start-ScheduledTask -TaskName CommonGroundPublish - run now (gate still applies)

param(
    [int]$MinDays = 5,
    [string]$DailyAt = "10:00",
    [int]$StartupDelayMinutes = 5,
    [switch]$Status,
    [switch]$Remove
)

$TaskName      = "CommonGroundPublish"
$ProjectRoot   = "C:\Projects\Common_Ground"
$PublishScript = "$ProjectRoot\publish.ps1"

# Registering and unregistering a task need elevation, and both fail as
# NON-terminating errors -- without this check the script would print its
# "Registered:" banner over the top of an "Access is denied" and leave the old
# task in place, which is the sort of silent half-success this whole file is
# meant to eliminate. -Status is read-only and needs no elevation.
function Assert-Elevated {
    $isAdmin = ([Security.Principal.WindowsPrincipal] `
        [Security.Principal.WindowsIdentity]::GetCurrent() `
    ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $isAdmin) {
        Write-Host ""
        Write-Host "This needs an elevated prompt (Task Scheduler refuses otherwise)." -ForegroundColor Red
        Write-Host "Start PowerShell as Administrator and re-run this script with the same flags:" -ForegroundColor Yellow
        Write-Host "  cd $ProjectRoot" -ForegroundColor Yellow
        Write-Host "  .\scripts\schedule_publish.ps1 -MinDays $MinDays -DailyAt $DailyAt" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "Nothing was changed. '-Status' works unelevated if you just want to look." -ForegroundColor Yellow
        Write-Host ""
        exit 1
    }
}

# -- Status -------------------------------------------------------------------
if ($Status) {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if (-not $task) { Write-Host "Task '$TaskName' is not registered."; exit 0 }

    $info = Get-ScheduledTaskInfo -TaskName $TaskName
    Write-Host ""
    Write-Host "Task      : $TaskName"
    Write-Host "State     : $($task.State)"
    Write-Host "Last run  : $($info.LastRunTime)  (result $($info.LastTaskResult))"
    Write-Host "Next run  : $($info.NextRunTime)"
    Write-Host "Missed    : $($info.NumberOfMissedRuns)"
    Write-Host ""
    Write-Host "Triggers  :"
    foreach ($t in $task.Triggers) {
        $kind  = $t.CimClass.CimClassName -replace '^MSFT_Task', '' -replace 'Trigger$', ''
        $extra = if ($t.StartBoundary) { " at $($t.StartBoundary)" } else { "" }
        $delay = if ($t.Delay)         { " (delay $($t.Delay))" }    else { "" }
        Write-Host "  - $kind$extra$delay"
    }

    $s = $task.Settings
    Write-Host ""
    Write-Host "Settings  :"
    Write-Host "  StartWhenAvailable         : $($s.StartWhenAvailable)   <- runs after a missed trigger"
    Write-Host "  DisallowStartIfOnBatteries : $($s.DisallowStartIfOnBatteries)"
    Write-Host "  StopIfGoingOnBatteries     : $($s.StopIfGoingOnBatteries)"
    Write-Host "  RunOnlyIfNetworkAvailable  : $($s.RunOnlyIfNetworkAvailable)"
    Write-Host "  StopOnIdleEnd              : $($s.IdleSettings.StopOnIdleEnd)   <- true can kill a long publish"
    Write-Host "  ExecutionTimeLimit         : $($s.ExecutionTimeLimit)"

    $lastFile = "$ProjectRoot\.last_publish"
    Write-Host ""
    if (Test-Path $lastFile) {
        $lp   = [datetime](Get-Content $lastFile -Raw).Trim()
        $days = [math]::Round(((Get-Date) - $lp).TotalDays, 1)
        Write-Host "Last publish (.last_publish): $lp  ($days days ago)"
        Write-Host "  The gate skips a run until this is $MinDays+ days old. Manual publishes count."
    } else {
        Write-Host "Last publish (.last_publish): never"
    }

    $logs = Get-ChildItem "$ProjectRoot\logs\publish-*.log" -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending | Select-Object -First 3
    Write-Host ""
    if ($logs) {
        Write-Host "Recent publish logs:"
        $logs | ForEach-Object { Write-Host "  $($_.LastWriteTime)  $($_.Name)  ($([int]($_.Length / 1KB)) KB)" }
    } else {
        Write-Host "Recent publish logs: none yet (logging was added after the last run)"
    }
    Write-Host ""
    exit 0
}

# -- Remove -------------------------------------------------------------------
if ($Remove) {
    Assert-Elevated
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction Stop
        Write-Host "Removed scheduled task '$TaskName'"
    } else {
        Write-Host "Task '$TaskName' not found."
    }
    exit 0
}

# -- Register -----------------------------------------------------------------
Assert-Elevated

if (-not (Test-Path $PublishScript)) {
    Write-Error "publish.ps1 not found at $PublishScript"
    exit 1
}

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction Stop
    Write-Host "Removed existing task '$TaskName'"
}

# -NoProfile so a slow or broken user profile cannot affect an unattended run.
# publish.ps1 transcribes its own output to logs\publish-<stamp>.log.
$scriptArgs = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$PublishScript`" -MinDaysSinceLastRun $MinDays"

$Action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument $scriptArgs `
    -WorkingDirectory $ProjectRoot

# Logon and startup both get a delay: at boot the network stack is often not up
# yet and RunOnlyIfNetworkAvailable would defer the run, and Ollama needs a
# moment to be ready for steps 2-4.
$delay = "PT$($StartupDelayMinutes)M"

$tLogon = New-ScheduledTaskTrigger -AtLogOn
$tLogon.Delay = $delay

$tStartup = New-ScheduledTaskTrigger -AtStartup
$tStartup.Delay = $delay

# The dependable trigger. StartWhenAvailable turns one missed while the machine
# was asleep into a run shortly after wake.
$tDaily = New-ScheduledTaskTrigger -Daily -At $DailyAt

$Settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -RunOnlyIfNetworkAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 4) `
    -MultipleInstances IgnoreNew `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 15) `
    -Hidden

# A desktop on AC today, but both of these defaulted to true, which would
# silently refuse to start and would stop a publish mid-flight on any battery
# hardware this ever moves to.
$Settings.DisallowStartIfOnBatteries = $false
$Settings.StopIfGoingOnBatteries     = $false
# Default is true: Task Scheduler would stop the publish the moment the machine
# stopped being idle, i.e. as soon as someone touched it.
$Settings.IdleSettings.StopOnIdleEnd = $false

$Principal = New-ScheduledTaskPrincipal `
    -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) `
    -LogonType Interactive `
    -RunLevel Limited

$desc = "Common Ground publish pipeline - logon, startup and daily at $DailyAt; " +
        "publishes only if $MinDays+ days since the last one. Logs to logs\publish-*.log."

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $Action `
    -Trigger @($tLogon, $tStartup, $tDaily) `
    -Settings $Settings `
    -Principal $Principal `
    -Description $desc `
    -ErrorAction Stop `
    | Out-Null

# Read the task back rather than trusting that the call above took effect.
$check = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $check -or $check.Triggers.Count -lt 3) {
    Write-Error "Registration did not take: expected 3 triggers, found $($check.Triggers.Count). Run -Status to inspect."
    exit 1
}

Write-Host ""
Write-Host "Registered: $TaskName"
Write-Host "  Triggers : at logon (+$StartupDelayMinutes min), at startup (+$StartupDelayMinutes min), daily at $DailyAt"
Write-Host "  Catch-up : StartWhenAvailable - a trigger missed while asleep runs after wake"
Write-Host "  Gate     : publishes only if the last publish was $MinDays+ days ago"
Write-Host "  Logs     : $ProjectRoot\logs\publish-<timestamp>.log"
Write-Host ""
Write-Host "Commands:"
Write-Host "  Diagnostics                  : .\scripts\schedule_publish.ps1 -Status"
Write-Host "  Run now (gate still applies) : Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "  Publish now, ignore gate     : .\publish.ps1"
Write-Host "  Disable                      : Disable-ScheduledTask -TaskName '$TaskName'"
Write-Host "  Remove                       : .\scripts\schedule_publish.ps1 -Remove"
Write-Host ""
