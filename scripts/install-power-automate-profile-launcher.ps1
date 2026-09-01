$ErrorActionPreference = "Stop"

$sourceLauncher = Join-Path $PSScriptRoot "open-power-automate-profile.ps1"
if (-not (Test-Path -LiteralPath $sourceLauncher)) {
    throw "Launcher script not found: $sourceLauncher"
}

$installDirectory = Join-Path $env:LOCALAPPDATA "RPA Monitoring"
$installedLauncher = Join-Path $installDirectory "open-power-automate-profile.ps1"
New-Item -ItemType Directory -Path $installDirectory -Force | Out-Null
Copy-Item -LiteralPath $sourceLauncher -Destination $installedLauncher -Force

$protocolRoot = "HKCU:\Software\Classes\rpa-power-automate"
New-Item -Path $protocolRoot -Force | Out-Null
Set-Item -Path $protocolRoot -Value "URL:RPA Power Automate Launcher"
New-ItemProperty -Path $protocolRoot -Name "URL Protocol" -Value "" -PropertyType String -Force | Out-Null

$commandKey = Join-Path $protocolRoot "shell\open\command"
New-Item -Path $commandKey -Force | Out-Null
$powershellPath = Join-Path $PSHOME "powershell.exe"
$command = "`"$powershellPath`" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$installedLauncher`" `"%1`""
Set-Item -Path $commandKey -Value $command

$localStatePath = Join-Path $env:LOCALAPPDATA "Microsoft\Edge\User Data\Local State"
$profileNames = @()
if (Test-Path -LiteralPath $localStatePath) {
    $localState = Get-Content -LiteralPath $localStatePath -Raw | ConvertFrom-Json
    $profileNames = $localState.profile.info_cache.PSObject.Properties |
        ForEach-Object { [string]$_.Value.name } |
        Sort-Object
}

Write-Output "RPA Power Automate Launcher installed."
Write-Output "Account Name must match one of these Edge profile names:"
$profileNames | ForEach-Object { Write-Output "- $_" }
