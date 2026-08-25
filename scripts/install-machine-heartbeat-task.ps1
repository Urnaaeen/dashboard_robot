param(
    [Parameter(Mandatory = $true)]
    [string]$ApiBaseUrl,

    [Parameter(Mandatory = $true)]
    [ValidateScript({ $_.Length -ge 32 })]
    [string]$ApiKey,

    [string]$TaskName = "RPA Monitoring Machine Heartbeat"
)

$ErrorActionPreference = "Stop"

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
$isAdministrator = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdministrator) {
    throw "Run PowerShell as Administrator to install the heartbeat task."
}

$installDirectory = Join-Path $env:ProgramData "RpaMonitoring"
$installedScript = Join-Path $installDirectory "send-machine-heartbeat.ps1"
$sourceScript = Join-Path $PSScriptRoot "send-machine-heartbeat.ps1"

New-Item -ItemType Directory -Path $installDirectory -Force | Out-Null
Copy-Item -LiteralPath $sourceScript -Destination $installedScript -Force
[Environment]::SetEnvironmentVariable("RPA_API_KEY", $ApiKey, "Machine")

$arguments = @(
    "-NoProfile"
    "-NonInteractive"
    "-ExecutionPolicy Bypass"
    "-File `"$installedScript`""
    "-ApiBaseUrl `"$($ApiBaseUrl.TrimEnd('/'))`""
) -join " "

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arguments
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes 1)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Settings $settings -User "SYSTEM" -RunLevel Highest -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

Write-Output "Installed and started scheduled task: $TaskName"
Write-Output "Heartbeat target: $($ApiBaseUrl.TrimEnd('/'))/api/machines/heartbeat"
