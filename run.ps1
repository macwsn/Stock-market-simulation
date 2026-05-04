[CmdletBinding()]
param(
    [int]$Port = 8080
)

$ErrorActionPreference = "Stop"
$env:PORT = $Port

Set-Location -Path $PSScriptRoot

Write-Host "Starting stock-market-simulation on http://localhost:$Port"

docker compose down -v --remove-orphans 2>&1 | Out-Null

docker compose up --build -d
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Waiting for HAProxy + backends to become ready..."
$deadline = (Get-Date).AddSeconds(120)
while ((Get-Date) -lt $deadline) {
    try {
        $hz  = Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:$Port/healthz" -TimeoutSec 2
        $stk = Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:$Port/stocks"  -TimeoutSec 2
        if ($hz.StatusCode -eq 200 -and $stk.StatusCode -eq 200) {
            Write-Host "Ready. API at http://localhost:$Port"
            exit 0
        }
    } catch {
        Start-Sleep -Seconds 1
    }
}

Write-Error "Service did not become ready within 120s"
docker compose ps
exit 1
