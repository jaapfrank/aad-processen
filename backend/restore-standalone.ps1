<#
.SYNOPSIS
Verifies and restores a complete standalone snapshot into a NEW installation folder.
.DESCRIPTION
Never overwrites a live installation and does not register or start a service.
Use the same Windows architecture. Validate locally before switching production.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$BackupDir,
  [Parameter(Mandatory = $true)][string]$Destination,
  [switch]$VerifyOnly
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'operations-common.ps1')
$backup = Get-SpgFullPath $BackupDir
$target = Get-SpgFullPath $Destination
$parent = Split-Path -Parent $target
$null = Assert-SpgChildPath $target $parent
if (Test-Path -LiteralPath $target) { throw "Herstel overschrijft nooit een bestaande map: $target" }
if ($target.StartsWith($backup + '\', [StringComparison]::OrdinalIgnoreCase) -or $target -eq $backup) { throw 'Herstelmap moet buiten de back-upmap liggen.' }
$manifest = Test-SpgSnapshot $backup
if ($VerifyOnly) { Write-Host "Back-up geldig: $(@($manifest.files).Count) gecontroleerde bestanden."; return }
New-Item -ItemType Directory -Path $parent -Force | Out-Null
$stage = Assert-SpgChildPath (Join-Path $parent ('.spg-restore-' + [guid]::NewGuid().ToString('N'))) $parent
try {
  New-Item -ItemType Directory -Path $stage | Out-Null
  Set-SpgPrivateDirectory $stage
  Copy-SpgTree (Join-Path $backup 'installation') $stage
  # Verify the actual restored bytes as well as the source snapshot.
  $restored = @(Get-SpgFileManifest $stage)
  if (@(Compare-Object @($manifest.files | ForEach-Object { "$($_.path)|$($_.bytes)|$($_.sha256)" }) @($restored | ForEach-Object { "$($_.path)|$($_.bytes)|$($_.sha256)" })).Count) {
    throw 'Controle van de herstelde bestanden is mislukt.'
  }
  Move-Item -LiteralPath $stage -Destination $target
} finally { Remove-SpgTree $stage $parent }
Write-Host "Hersteld naar $target. Nog niet gestart; voer de herstelproef in DEPLOY.md uit."
