<#
.SYNOPSIS
    Sends one machine heartbeat to the RPA Central Monitoring dashboard.

.DESCRIPTION
    Runs every minute from Task Scheduler as SYSTEM. The script never throws:
    every outcome is appended to a log file and reported through the exit code,
    so a machine that stops reporting can actually be diagnosed instead of
    silently disappearing from the Machines screen.

    Exit codes:
      0  heartbeat accepted
      1  configuration problem (missing API key, bad URL)
      2  the dashboard rejected the heartbeat or could not be reached
      3  unexpected agent failure
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$ApiBaseUrl,

    [string]$ApiKey,

    [string]$ApiKeyFile = (Join-Path $env:ProgramData "RpaMonitoring\api-key.txt"),

    [string]$LogFile = (Join-Path $env:ProgramData "RpaMonitoring\heartbeat.log"),

    [string]$AnyDeskPath,

    [int]$TimeoutSeconds = 20,

    [int]$MaxAttempts = 3
)

$AgentVersion = "2.0.0"
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$LogMaxBytes = 1MB
$AnyDeskCacheFile = Join-Path (Split-Path -Parent $LogFile) "anydesk-id.txt"
$AnyDeskCacheHours = 24
$AnyDeskTimeoutSeconds = 10

function Write-HeartbeatLog {
    param(
        [ValidateSet("INFO", "WARN", "ERROR")]
        [string]$Level,
        [string]$Message
    )

    $line = "{0} [{1}] {2}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Level, $Message

    # Console output only matters when an operator runs the script by hand.
    if ($Level -eq "ERROR") {
        Write-Host $line -ForegroundColor Red
    } elseif ($Level -eq "WARN") {
        Write-Host $line -ForegroundColor Yellow
    } else {
        Write-Host $line
    }

    try {
        $logDirectory = Split-Path -Parent $LogFile
        if (-not (Test-Path -LiteralPath $logDirectory)) {
            New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
        }
        if (Test-Path -LiteralPath $LogFile) {
            $existing = Get-Item -LiteralPath $LogFile
            if ($existing.Length -gt $LogMaxBytes) {
                Move-Item -LiteralPath $LogFile -Destination "$LogFile.old" -Force
            }
        }
        Add-Content -LiteralPath $LogFile -Value $line -Encoding UTF8
    } catch {
        # Logging must never be the reason a heartbeat fails.
    }
}

function Resolve-ApiKey {
    if (-not [string]::IsNullOrWhiteSpace($ApiKey)) {
        return $ApiKey.Trim()
    }
    if (Test-Path -LiteralPath $ApiKeyFile) {
        try {
            $fromFile = (Get-Content -LiteralPath $ApiKeyFile -Raw).Trim()
            if (-not [string]::IsNullOrWhiteSpace($fromFile)) {
                return $fromFile
            }
        } catch {
            Write-HeartbeatLog "WARN" "Could not read the API key file: $($_.Exception.Message)"
        }
    }
    # Kept for machines installed by the previous agent version.
    if (-not [string]::IsNullOrWhiteSpace($env:RPA_API_KEY)) {
        return $env:RPA_API_KEY.Trim()
    }
    return $null
}

function Get-PrimaryIpAddress {
    try {
        return Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
            Where-Object {
                $_.IPAddress -notlike "127.*" -and
                $_.IPAddress -notlike "169.254.*" -and
                $_.AddressState -eq "Preferred"
            } |
            Sort-Object -Property SkipAsSource, InterfaceMetric |
            Select-Object -First 1 -ExpandProperty IPAddress
    } catch {
        Write-HeartbeatLog "WARN" "Could not read the IPv4 address: $($_.Exception.Message)"
        return $null
    }
}

function Find-AnyDeskExecutable {
    $candidates = @(
        $AnyDeskPath,
        (Join-Path ${env:ProgramFiles(x86)} "AnyDesk\AnyDesk.exe"),
        (Join-Path $env:ProgramFiles "AnyDesk\AnyDesk.exe")
    ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique

    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) {
            return $candidate
        }
    }
    return $null
}

function Read-AnyDeskIdFromExecutable {
    param([string]$ExecutablePath)

    # AnyDesk.exe --get-id can block indefinitely when Task Scheduler runs it as
    # SYSTEM in session 0. Give it a hard deadline and kill it if it overruns,
    # otherwise one stuck process silently blocks every later heartbeat.
    $stdoutFile = [System.IO.Path]::GetTempFileName()
    $stderrFile = [System.IO.Path]::GetTempFileName()
    try {
        $process = Start-Process -FilePath $ExecutablePath -ArgumentList "--get-id" -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdoutFile -RedirectStandardError $stderrFile

        if (-not $process.WaitForExit($AnyDeskTimeoutSeconds * 1000)) {
            try { $process.Kill() } catch { }
            Write-HeartbeatLog "WARN" "AnyDesk --get-id timed out after $AnyDeskTimeoutSeconds seconds."
            return $null
        }

        $output = Get-Content -LiteralPath $stdoutFile -Raw -ErrorAction SilentlyContinue
        if ([string]::IsNullOrWhiteSpace($output)) {
            return $null
        }
        $match = [regex]::Match($output, "\d[\d\s]{5,}")
        if (-not $match.Success) {
            return $null
        }
        return $match.Value.Trim()
    } catch {
        Write-HeartbeatLog "WARN" "AnyDesk ID lookup failed: $($_.Exception.Message)"
        return $null
    } finally {
        Remove-Item -LiteralPath $stdoutFile, $stderrFile -Force -ErrorAction SilentlyContinue
    }
}

function Get-AnyDeskId {
    # The ID does not change in practice, so serve it from cache and refresh daily.
    if (Test-Path -LiteralPath $AnyDeskCacheFile) {
        $cache = Get-Item -LiteralPath $AnyDeskCacheFile
        if ($cache.LastWriteTime -gt (Get-Date).AddHours(-$AnyDeskCacheHours)) {
            $cached = (Get-Content -LiteralPath $AnyDeskCacheFile -Raw).Trim()
            if (-not [string]::IsNullOrWhiteSpace($cached)) {
                return $cached
            }
        }
    }

    $executable = Find-AnyDeskExecutable
    if (-not $executable) {
        return $null
    }

    $anyDeskId = Read-AnyDeskIdFromExecutable -ExecutablePath $executable
    if ([string]::IsNullOrWhiteSpace($anyDeskId)) {
        return $null
    }

    try {
        Set-Content -LiteralPath $AnyDeskCacheFile -Value $anyDeskId -Encoding UTF8
    } catch {
        # A missing cache only means the next run looks the ID up again.
    }
    return $anyDeskId
}

function Get-UptimeMinutes {
    try {
        $lastBoot = (Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop).LastBootUpTime
        return [int]((Get-Date) - $lastBoot).TotalMinutes
    } catch {
        return $null
    }
}

try {
    # PowerShell 5.1 still negotiates TLS 1.0 on some builds, which fails against
    # the Caddy endpoint and used to surface as an unexplained network error.
    try {
        [Net.ServicePointManager]::SecurityProtocol =
            [Net.SecurityProtocolType]::Tls12 -bor [Net.ServicePointManager]::SecurityProtocol
    } catch {
        Write-HeartbeatLog "WARN" "Could not force TLS 1.2: $($_.Exception.Message)"
    }

    $resolvedKey = Resolve-ApiKey
    if ([string]::IsNullOrWhiteSpace($resolvedKey)) {
        Write-HeartbeatLog "ERROR" "No API key found. Pass -ApiKey, create $ApiKeyFile, or set RPA_API_KEY."
        exit 1
    }
    if ($resolvedKey.Length -lt 32) {
        Write-HeartbeatLog "ERROR" "The API key is shorter than the 32 characters the dashboard requires."
        exit 1
    }

    $baseUrl = $ApiBaseUrl.Trim().TrimEnd("/")
    if (-not [System.Uri]::IsWellFormedUriString($baseUrl, [System.UriKind]::Absolute)) {
        Write-HeartbeatLog "ERROR" "ApiBaseUrl is not a valid absolute URL: $baseUrl"
        exit 1
    }
    $uri = "$baseUrl/api/machines/heartbeat"

    $payload = @{
        machineName = $env:COMPUTERNAME
        machineIp = Get-PrimaryIpAddress
        anydeskId = Get-AnyDeskId
        metadata = @{
            agent = "powershell-heartbeat"
            agentVersion = $AgentVersion
            os = [System.Environment]::OSVersion.VersionString
            powerShell = $PSVersionTable.PSVersion.ToString()
            uptimeMinutes = Get-UptimeMinutes
            reportedAt = (Get-Date).ToString("o")
        }
    }
    $body = $payload | ConvertTo-Json -Depth 4
    $headers = @{ "X-RPA-API-Key" = $resolvedKey }

    for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
        try {
            $response = Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -ContentType "application/json" -Body $body -TimeoutSec $TimeoutSeconds

            $status = "unknown"
            if ($response -and $response.machine -and $response.machine.status) {
                $status = $response.machine.status
            }
            Write-HeartbeatLog "INFO" "Heartbeat accepted for $($payload.machineName) (status: $status, attempt $attempt)."
            exit 0
        } catch {
            $statusCode = 0
            if ($_.Exception.Response) {
                try { $statusCode = [int]$_.Exception.Response.StatusCode } catch { $statusCode = 0 }
            }
            $reason = $_.Exception.Message

            # A rejected request will be rejected again, so retry only transport
            # failures and server side errors.
            if ($statusCode -ge 400 -and $statusCode -lt 500) {
                Write-HeartbeatLog "ERROR" "Dashboard rejected the heartbeat with HTTP $statusCode. Check the API key. $reason"
                exit 2
            }

            if ($attempt -eq $MaxAttempts) {
                Write-HeartbeatLog "ERROR" "Heartbeat failed after $MaxAttempts attempts (HTTP $statusCode). $reason"
                exit 2
            }

            $backoffSeconds = $attempt * 3
            Write-HeartbeatLog "WARN" "Attempt $attempt failed (HTTP $statusCode). Retrying in $backoffSeconds seconds. $reason"
            Start-Sleep -Seconds $backoffSeconds
        }
    }

    exit 2
} catch {
    Write-HeartbeatLog "ERROR" "Unexpected agent failure: $($_.Exception.Message)"
    exit 3
}
