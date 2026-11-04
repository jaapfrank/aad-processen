[CmdletBinding()]
param(
  [ValidatePattern('^(win|linux|osx)-(x64|arm64)$')][string]$Runtime = 'win-x64',
  [string]$Configuration = 'Release',
  [string]$OutputRoot = 'artifacts',
  [switch]$SingleFile
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'operations-common.ps1')
$repo = Get-SpgFullPath (Join-Path $PSScriptRoot '..')
$output = Get-SpgFullPath (Join-Path $repo $OutputRoot)
$null = Assert-SpgChildPath $output $repo
$publish = Assert-SpgChildPath (Join-Path $output "service-procesgids-$Runtime") $output
if (Test-Path -LiteralPath (Join-Path $publish 'App_Data')) {
  throw 'Dit bouwdoel bevat App_Data en is een gebruikte installatie. Kies een andere OutputRoot en upgrade met install-windows.ps1. De bestaande data blijven ongemoeid.'
}
if (Test-Path -LiteralPath $publish) { Assert-SpgNoLinks $publish }
$dotnet = Get-Command dotnet -ErrorAction SilentlyContinue
$localSdk = Join-Path $repo '.tools/dotnet10-windows/dotnet.exe'
if (Test-Path -LiteralPath $localSdk) { $dotnet = Get-Item -LiteralPath $localSdk }
if (-not $dotnet) { throw '.NET 10 SDK ontbreekt.' }
$dotnetPath = if ($dotnet.Source) { $dotnet.Source } else { $dotnet.FullName }
$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npm) { $npm = Get-Command npm -ErrorAction Stop }
$frontend = Join-Path $repo 'frontend'
New-Item -ItemType Directory -Path $output -Force | Out-Null
$stage = Assert-SpgChildPath (Join-Path $output ('.publish-' + [guid]::NewGuid().ToString('N'))) $output
$previous = Assert-SpgChildPath (Join-Path $output ('.previous-' + [guid]::NewGuid().ToString('N'))) $output
$zip = "$publish.zip"
$stageZip = "$stage.zip"
$previousZip = "$previous.zip"
$swapped = $false
try {
  Push-Location $frontend
  try {
    Invoke-SpgNative $npm.Source @('ci', '--no-audit', '--no-fund')
    Remove-SpgTree (Join-Path $frontend 'dist') $frontend
    Invoke-SpgNative $npm.Source @('run', 'build')
  } finally { Pop-Location }
  $dist = Join-Path $frontend 'dist'
  if (-not (Test-Path -LiteralPath (Join-Path $dist 'index.html'))) { throw 'Frontend-build heeft geen index.html opgeleverd.' }
  Assert-SpgNoLinks $dist
  $arguments = @('publish', (Join-Path $PSScriptRoot 'src/ServiceProcesgids.Api/ServiceProcesgids.Api.csproj'), '-c', $Configuration, '-r', $Runtime,
    '--self-contained', 'true', '-o', $stage, "-p:FrontendDistPath=$dist")
  if ($SingleFile) { $arguments += '-p:PublishSingleFile=true' }
  Invoke-SpgNative $dotnetPath $arguments
  if (-not (Test-Path -LiteralPath (Join-Path $stage 'wwwroot/index.html'))) { throw 'Frontend ontbreekt in het pakket.' }
  if (Test-Path -LiteralPath (Join-Path $stage 'App_Data')) { throw 'Distributiepakket bevat onverwacht installatiegegevens.' }
  $contract = Join-Path $stage 'contract'
  New-Item -ItemType Directory -Path $contract -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $repo 'contract/openapi.yaml') -Destination $contract
  Copy-Item -LiteralPath (Join-Path $repo 'contract/fixtures') -Destination $contract -Recurse
  Get-ChildItem -LiteralPath $stage -File -Filter '*.pdb' | ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }
  foreach ($name in @('install-windows.ps1', 'installeer.bat', 'proberen-zonder-installatie.bat', 'bootstrap-local-admin.ps1', 'operations-common.ps1', 'backup-standalone.ps1', 'restore-standalone.ps1', 'DEPLOY.md')) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination $stage
  }
  foreach ($name in @('HANDLEIDING.md', 'HANDLEIDING.pdf')) {
    $source = Join-Path $repo $name
    if (Test-Path -LiteralPath $source) { Copy-Item -LiteralPath $source -Destination $stage }
  }
  Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $stageZip
  if (Test-Path -LiteralPath $publish) { Move-Item -LiteralPath $publish -Destination $previous }
  if (Test-Path -LiteralPath $zip) { Move-Item -LiteralPath $zip -Destination $previousZip }
  Move-Item -LiteralPath $stage -Destination $publish
  $swapped = $true
  Move-Item -LiteralPath $stageZip -Destination $zip
} catch {
  if ($swapped) { Remove-SpgTree $publish $output }
  if (Test-Path -LiteralPath $previous) { Move-Item -LiteralPath $previous -Destination $publish }
  if (Test-Path -LiteralPath $previousZip) { Move-Item -LiteralPath $previousZip -Destination $zip }
  throw
} finally {
  Remove-SpgTree $stage $output
  if (Test-Path -LiteralPath $stageZip) { Remove-Item -LiteralPath (Assert-SpgChildPath $stageZip $output) -Force }
}
Remove-SpgTree $previous $output
if (Test-Path -LiteralPath $previousZip) { Remove-Item -LiteralPath (Assert-SpgChildPath $previousZip $output) -Force }
Write-Host "Frontend + backend gepubliceerd: $zip"
