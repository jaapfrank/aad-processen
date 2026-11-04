$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $projectRoot '.tools/dotnet10-windows/dotnet.exe'
$application = Join-Path $projectRoot 'backend/src/ServiceProcesgids.Api/bin/Release/net10.0/ServiceProcesgids.Api.dll'
$contentRoot = Join-Path $projectRoot '.tools/product-preview'

foreach ($requiredPath in @($runtime, $application, (Join-Path $contentRoot 'wwwroot/index.html'))) {
    if (-not (Test-Path -LiteralPath $requiredPath)) {
        throw "Testomgeving ontbreekt: $requiredPath"
    }
}

if (Get-NetTCPConnection -LocalPort 5088 -State Listen -ErrorAction SilentlyContinue) {
    Write-Host 'Poort 5088 is al in gebruik. Controleer http://127.0.0.1:5088 in je browser.'
    exit 0
}

Write-Host 'Testomgeving: http://127.0.0.1:5088'
Write-Host 'Laat dit venster open tijdens het testen. Stoppen kan met Ctrl+C.'
$env:Logging__EventLog__LogLevel__Default = 'None'
& $runtime $application --contentRoot $contentRoot --urls 'http://127.0.0.1:5088'
exit $LASTEXITCODE
