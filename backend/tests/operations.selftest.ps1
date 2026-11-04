$ErrorActionPreference = 'Stop'
$backend = Split-Path -Parent $PSScriptRoot
$repo = Split-Path -Parent $backend
. (Join-Path $backend 'operations-common.ps1')
$testRoot = Assert-SpgChildPath (Join-Path $repo ('.tools/ops-test-' + [guid]::NewGuid().ToString('N'))) $repo
New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
$source = Join-Path $testRoot 'source'
$backup = Join-Path $testRoot 'backup'
$restored = Join-Path $testRoot 'restored'
try {
  New-Item -ItemType Directory -Path (Join-Path $source 'App_Data/data-protection-keys') -Force | Out-Null
  Set-Content -LiteralPath (Join-Path $source 'ServiceProcesgids.Api.exe') -Value 'fixture binary, never executed'
  Set-Content -LiteralPath (Join-Path $source 'appsettings.json') -Value '{"ServiceProcesgids":{"Storage":"local"}}'
  Set-Content -LiteralPath (Join-Path $source 'App_Data/service-procesgids.db') -Value 'fixture database bytes'
  Set-Content -LiteralPath (Join-Path $source 'App_Data/service-procesgids.db-wal') -Value 'fixture WAL bytes'
  Set-Content -LiteralPath (Join-Path $source 'App_Data/data-protection-keys/key.xml') -Value 'fixture keyring'
  Set-Content -LiteralPath (Join-Path $source 'App_Data/branding.json') -Value '{"name":"fixture"}'
  & (Join-Path $backend 'backup-standalone.ps1') -InstallDir $source -Destination $backup -ApplicationStopped
  & (Join-Path $backend 'restore-standalone.ps1') -BackupDir $backup -Destination $restored
  foreach ($file in @(Get-SpgFileManifest $source)) {
    if ((Get-FileHash -LiteralPath (Join-Path $restored $file.path)).Hash -ne $file.sha256) { throw 'Roundtrip changed bytes.' }
  }
  $refused = $false
  try { & (Join-Path $backend 'restore-standalone.ps1') -BackupDir $backup -Destination $source }
  catch { $refused = $_.Exception.Message -like '*bestaande map*' }
  if (-not $refused) { throw 'Restore did not refuse existing installation.' }
  Set-Content -LiteralPath (Join-Path $backup 'installation/App_Data/branding.json') -Value 'corruption'
  $refused = $false
  try { $null = Test-SpgSnapshot $backup } catch { $refused = $_.Exception.Message -like '*controle mislukt*' }
  if (-not $refused) { throw 'Corrupt snapshot was accepted.' }
  $refused = $false
  try { $null = Assert-SpgChildPath (Join-Path $testRoot '../escape') $testRoot } catch { $refused = $true }
  if (-not $refused) { throw 'Parent traversal was accepted.' }
  $manifest = Get-Content -LiteralPath (Join-Path $backup 'manifest.json') -Raw | ConvertFrom-Json
  $manifest.files[0].path = '../escape'
  $manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $backup 'manifest.json')
  $refused = $false
  try { $null = Test-SpgSnapshot $backup } catch { $refused = $_.Exception.Message -like '*Onveilig bestandspad*' }
  if (-not $refused) { throw 'Manifest traversal was accepted.' }
  Write-Output 'PASS: complete backup/restore bytes incl WAL/keyring/config; overwrite refused; corruption and path traversal refused.'
} finally { Remove-SpgTree $testRoot $repo }
