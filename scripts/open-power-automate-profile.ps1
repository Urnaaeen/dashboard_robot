param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$RequestUri
)

$ErrorActionPreference = "Stop"

function Show-LauncherError {
    param([string]$Message)

    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show(
        $Message,
        "RPA Power Automate Launcher",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
}

try {
    $launcherUri = [System.Uri]$RequestUri
    if ($launcherUri.Scheme -ne "rpa-power-automate") {
        throw "Unsupported launcher request."
    }

    $query = @{}
    foreach ($part in $launcherUri.Query.TrimStart("?").Split("&", [System.StringSplitOptions]::RemoveEmptyEntries)) {
        $pair = $part.Split("=", 2)
        if ($pair.Count -eq 2) {
            $name = [System.Uri]::UnescapeDataString($pair[0])
            $value = [System.Uri]::UnescapeDataString($pair[1])
            $query[$name] = $value
        }
    }

    $profileName = [string]$query["profile"]
    $targetUrl = [string]$query["url"]
    if ([string]::IsNullOrWhiteSpace($profileName) -or [string]::IsNullOrWhiteSpace($targetUrl)) {
        throw "The Edge profile name or Power Automate URL is missing."
    }

    $targetUri = [System.Uri]$targetUrl
    if ($targetUri.Scheme -ne "https" -or $targetUri.Host -ne "make.powerautomate.com") {
        throw "Only https://make.powerautomate.com links are allowed."
    }

    $localStatePath = Join-Path $env:LOCALAPPDATA "Microsoft\Edge\User Data\Local State"
    if (-not (Test-Path -LiteralPath $localStatePath)) {
        throw "Microsoft Edge profile information was not found."
    }

    $localState = Get-Content -LiteralPath $localStatePath -Raw | ConvertFrom-Json
    $profile = $localState.profile.info_cache.PSObject.Properties |
        Where-Object { [string]$_.Value.name -ieq $profileName } |
        Select-Object -First 1
    if (-not $profile) {
        throw "Edge profile '$profileName' was not found. Account Name must exactly match the Edge profile name."
    }

    $edgeCandidates = @(
        (Join-Path ${env:ProgramFiles(x86)} "Microsoft\Edge\Application\msedge.exe"),
        (Join-Path $env:ProgramFiles "Microsoft\Edge\Application\msedge.exe")
    )
    $edgePath = $edgeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (-not $edgePath) {
        throw "Microsoft Edge was not found."
    }

    $profileDirectory = [string]$profile.Name
    Start-Process -FilePath $edgePath -ArgumentList @(
        "--profile-directory=`"$profileDirectory`"",
        "`"$($targetUri.AbsoluteUri)`""
    )
} catch {
    Show-LauncherError $_.Exception.Message
    exit 1
}
