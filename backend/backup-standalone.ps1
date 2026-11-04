<#
.SYNOPSIS
Complete, verified snapshot of a stopped standard Windows/SQLite installation.
.DESCRIPTION
Stop the service/application first. No services are changed by this script.
The snapshot includes all App_Data, keyring, configuration and exact binaries.
Store Destination on a protected backup volume; the directory is not encrypted.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$InstallDir,
  [Parameter(Mandatory = $true)][string]$Destination,
  [switch]$ApplicationStopped
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'operations-common.ps1')
if (-not $ApplicationStopped) { throw 'Stop eerst de service/app. Geef daarna -ApplicationStopped mee; houd de app gestopt tot de back-up klaar is.' }
$source = Get-SpgFullPath $InstallDir
$target = Get-SpgFullPath $Destination
$parent = Split-Path -Parent $target
$null = Assert-SpgChildPath $target $parent
if ($target -eq $source -or $target.StartsWith($source + '\', [StringComparison]::OrdinalIgnoreCase) -or $source.StartsWith($target + '\', [StringComparison]::OrdinalIgnoreCase)) {
  throw 'De back-upmap en installatiemap mogen niet in elkaar liggen.'
}
if (Test-Path -LiteralPath $target) { throw "Back-updoel bestaat al: $target. Kies een nieuwe map." }
Assert-SpgNoLinks $source
Assert-SpgStandaloneConfiguration $source
Assert-SpgNotRunning $source
New-Item -ItemType Directory -Path $parent -Force | Out-Null
$stage = Assert-SpgChildPath (Join-Path $parent ('.spg-backup-' + [guid]::NewGuid().ToString('N'))) $parent
try {
  New-Item -ItemType Directory -Path $stage | Out-Null
  Set-SpgPrivateDirectory $stage
  $payload = Join-Path $stage 'installation'
  Copy-SpgTree $source $payload
  $manifest = [ordered]@{
    format = 'ServiceProcesgids.StandaloneBackup/v1'
    createdUtc = [DateTime]::UtcNow.ToString('o')
    source = $source
    database = 'App_Data/service-procesgids.db'
    files = @(Get-SpgFileManifest $payload)
  }
  $manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $stage 'manifest.json') -Encoding UTF8
  $null = Test-SpgSnapshot $stage
  Move-Item -LiteralPath $stage -Destination $target
} finally { Remove-SpgTree $stage $parent }
Write-Host "Volledige, gecontroleerde back-up: $target"
