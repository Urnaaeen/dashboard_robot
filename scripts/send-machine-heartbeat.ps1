param(
    [Parameter(Mandatory = $true)]
    [string]$ApiBaseUrl,

    [string]$ApiKey = $env:RPA_API_KEY,

    [string]$AnyDeskPath = "C:\Program Files (x86)\AnyDesk\AnyDesk.exe"
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($ApiKey)) {
    throw "RPA_API_KEY is required. Pass -ApiKey or set the RPA_API_KEY environment variable."
}

$machineIp = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object {
        $_.IPAddress -notlike "127.*" -and
        $_.IPAddress -notlike "169.254.*" -and
        $_.AddressState -eq "Preferred"
    } |
    Select-Object -First 1 -ExpandProperty IPAddress

$anyDeskId = $null
$anyDeskCandidates = @(
    $AnyDeskPath,
    "$env:ProgramFiles\AnyDesk\AnyDesk.exe",
    "${env:ProgramFiles(x86)}\AnyDesk\AnyDesk.exe"
) | Select-Object -Unique
$installedAnyDesk = $anyDeskCandidates | Where-Object {
    $_ -and (Test-Path -LiteralPath $_)
} | Select-Object -First 1
if ($installedAnyDesk) {
    $anyDeskId = (& $installedAnyDesk --get-id 2>$null | Select-Object -First 1)
}

$body = @{
    machineName = $env:COMPUTERNAME
    machineIp = $machineIp
    anydeskId = $anyDeskId
    metadata = @{
        os = [System.Environment]::OSVersion.VersionString
        agent = "powershell-heartbeat"
    }
} | ConvertTo-Json -Depth 4

$uri = "{0}/api/machines/heartbeat" -f $ApiBaseUrl.TrimEnd("/")
Invoke-RestMethod -Method Post -Uri $uri -Headers @{
    "X-RPA-API-Key" = $ApiKey
} -ContentType "application/json" -Body $body
