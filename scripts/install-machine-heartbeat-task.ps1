<#
.SYNOPSIS
    Installs the RPA Monitoring heartbeat agent as a Windows scheduled task.

.DESCRIPTION
    Copies the agent to C:\ProgramData\RpaMonitoring, stores the API key in a file
    readable only by SYSTEM and Administrators, and registers a task that repeats
    every minute. Before finishing it sends one heartbeat and reports the result,
    so a broken installation is visible immediately instead of a day later.
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$ApiBaseUrl,

    [Parameter(Mandatory = $true)]
    [ValidateScript({ $_.Length -ge 32 })]
    [string]$ApiKey,

    [string]$TaskName = "RPA Monitoring Machine Heartbeat",

    [int]$IntervalMinutes = 1
)

$ErrorActionPreference = "Stop"

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Run PowerShell as Administrator to install the heartbeat task."
}

$normalizedBaseUrl = $ApiBaseUrl.Trim().TrimEnd("/")
if (-not [System.Uri]::IsWellFormedUriString($normalizedBaseUrl, [System.UriKind]::Absolute)) {
    throw "ApiBaseUrl is not a valid absolute URL: $normalizedBaseUrl"
}

$installDirectory = Join-Path $env:ProgramData "RpaMonitoring"
$installedScript = Join-Path $installDirectory "send-machine-heartbeat.ps1"
$apiKeyFile = Join-Path $installDirectory "api-key.txt"
$logFile = Join-Path $installDirectory "heartbeat.log"
$sourceScript = Join-Path $PSScriptRoot "send-machine-heartbeat.ps1"

if (-not (Test-Path -LiteralPath $sourceScript)) {
    throw "Agent script not found: $sourceScript"
}

New-Item -ItemType Directory -Path $installDirectory -Force | Out-Null
Copy-Item -LiteralPath $sourceScript -Destination $installedScript -Force

# The previous version stored the key in a machine wide environment variable,
# which every process on the host could read and which services only pick up
# after a reboot. A file locked to SYSTEM and Administrators avoids both.
Set-Content -LiteralPath $apiKeyFile -Value $ApiKey -Encoding UTF8 -NoNewline

$systemSid = New-Object System.Security.Principal.SecurityIdentifier(
    [System.Security.Principal.WellKnownSidType]::LocalSystemSid, $null)
$administratorsSid = New-Object System.Security.Principal.SecurityIdentifier(
    [System.Security.Principal.WellKnownSidType]::BuiltinAdministratorsSid, $null)

$acl = Get-Acl -LiteralPath $apiKeyFile
$acl.SetAccessRuleProtection($true, $false)
foreach ($rule in @($acl.Access)) {
    [void]$acl.RemoveAccessRule($rule)
}
$acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
    $systemSid, "FullControl", "Allow")))
$acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
    $administratorsSid, "FullControl", "Allow")))
Set-Acl -LiteralPath $apiKeyFile -AclObject $acl

$arguments = @(
    "-NoProfile"
    "-NonInteractive"
    "-ExecutionPolicy Bypass"
    "-File `"$installedScript`""
    "-ApiBaseUrl `"$normalizedBaseUrl`""
) -join " "

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arguments

$interval = New-TimeSpan -Minutes $IntervalMinutes
$startTime = (Get-Date).AddMinutes(1)
try {
    $trigger = New-ScheduledTaskTrigger -Once -At $startTime -RepetitionInterval $interval -RepetitionDuration ([TimeSpan]::MaxValue)
} catch {
    # Older builds reject TimeSpan.MaxValue; an omitted duration also means forever.
    $trigger = New-ScheduledTaskTrigger -Once -At $startTime -RepetitionInterval $interval
}

$triggers = @($trigger)
try {
    # Restart the repetition cycle promptly after a reboot instead of waiting for
    # Task Scheduler to catch up on the missed occurrence.
    $startupTrigger = New-ScheduledTaskTrigger -AtStartup
    $startupTrigger.Repetition = $trigger.Repetition
    $triggers += $startupTrigger
} catch {
    Write-Warning "Could not add the startup trigger: $($_.Exception.Message)"
}

# Defaults matter here. New-ScheduledTaskSettingsSet disallows starting on
# battery and stops the task when a host switches to battery, which is why the
# agent never ran on laptops and on VMs that report a battery. The execution
# time limit stops a hung run from blocking every later one, because
# MultipleInstances IgnoreNew skips new runs while an old one is still alive.
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 5) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers `
    -Settings $settings -User "SYSTEM" -RunLevel Highest -Force | Out-Null

Write-Output "Installed scheduled task: $TaskName"
Write-Output "Heartbeat target: $normalizedBaseUrl/api/machines/heartbeat"
Write-Output "Machine name reported: $env:COMPUTERNAME"
Write-Output "Log file: $logFile"
Write-Output ""
Write-Output "Sending a verification heartbeat..."

& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass `
    -File $installedScript -ApiBaseUrl $normalizedBaseUrl
$verificationExitCode = $LASTEXITCODE

if ($verificationExitCode -eq 0) {
    Write-Output ""
    Write-Output "Verification heartbeat accepted. Starting the scheduled task."
    Start-ScheduledTask -TaskName $TaskName

    # Only drop the legacy machine wide key once the file based key is proven.
    if (-not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable("RPA_API_KEY", "Machine"))) {
        [Environment]::SetEnvironmentVariable("RPA_API_KEY", $null, "Machine")
        Write-Output "Removed the legacy machine wide RPA_API_KEY environment variable."
    }
} else {
    Write-Warning "The verification heartbeat failed with exit code $verificationExitCode."
    Write-Warning "The task is installed but will keep failing until this is fixed."
    Write-Warning "Read $logFile for the reason. Exit code 1 means configuration, 2 means network or API key."
    exit $verificationExitCode
}

Write-Output ""
Write-Output "Check the task status at any time with:"
Write-Output "  Get-ScheduledTaskInfo -TaskName '$TaskName'"
Write-Output "  Get-Content '$logFile' -Tail 20"
