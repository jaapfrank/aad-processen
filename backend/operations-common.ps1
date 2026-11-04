# Shared checks for deployment and recovery. Compatible with Windows PowerShell 5.1.
function Get-SpgFullPath([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path)) { throw 'Een expliciet bestandspad is vereist.' }
  return [IO.Path]::GetFullPath($ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path)).TrimEnd('\', '/')
}

function Assert-SpgChildPath([string]$Path, [string]$Root) {
  $full = Get-SpgFullPath $Path
  $parent = Get-SpgFullPath $Root
  if (-not $full.StartsWith($parent + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Onveilig pad: '$full' moet binnen '$parent' liggen."
  }
  $cursor = $full
  while ($cursor) {
    if (Test-Path -LiteralPath $cursor) {
      if ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw "Symbolische links/junctions zijn niet toegestaan: $cursor"
      }
    }
    $cursor = [IO.Path]::GetDirectoryName($cursor)
  }
  return $full
}

function Assert-SpgNoLinks([string]$Path) {
  $full = Get-SpgFullPath $Path
  if (-not (Test-Path -LiteralPath $full -PathType Container)) { throw "Map ontbreekt: $full" }
  $null = Assert-SpgChildPath $full (Split-Path -Parent $full)
  $link = Get-ChildItem -LiteralPath $full -Force -Recurse |
    Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint } | Select-Object -First 1
  if ($link) { throw "Symbolische links/junctions zijn niet toegestaan: $($link.FullName)" }
}

function Remove-SpgTree([string]$Path, [string]$Root) {
  $full = Assert-SpgChildPath $Path $Root
  if (Test-Path -LiteralPath $full) {
    Assert-SpgNoLinks $full
    Remove-Item -LiteralPath $full -Recurse -Force
  }
}

function Invoke-SpgNative([string]$Command, [string[]]$Arguments) {
  & $Command @Arguments | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "$Command mislukte (exitcode $LASTEXITCODE)." }
}

function Assert-SpgNotRunning([string]$InstallDir) {
  $exe = Join-Path (Get-SpgFullPath $InstallDir) 'ServiceProcesgids.Api.exe'
  foreach ($process in @(Get-Process -Name 'ServiceProcesgids.Api' -ErrorAction SilentlyContinue)) {
    if (-not $process.Path -or [string]::Equals($process.Path, $exe, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Stop de applicatie volledig voordat u de bestanden kopieert ($exe)."
    }
  }
}

function Set-SpgPrivateDirectory([string]$Path, [switch]$LocalService) {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $grants = @("*${identity}:(OI)(CI)F", '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F')
  if ($LocalService) { $grants += '*S-1-5-19:(OI)(CI)M' }
  Invoke-SpgNative 'icacls.exe' (@($Path, '/inheritance:r', '/grant:r') + $grants)
}

function Copy-SpgTree([string]$Source, [string]$Destination) {
  Assert-SpgNoLinks $Source
  $sourceRoot = Get-SpgFullPath $Source
  New-Item -ItemType Directory -Path $Destination -Force | Out-Null
  foreach ($item in @(Get-ChildItem -LiteralPath $sourceRoot -Force -Recurse)) {
    $relative = $item.FullName.Substring($sourceRoot.Length + 1)
    $target = Assert-SpgChildPath (Join-Path $Destination $relative) $Destination
    if ($item.PSIsContainer) {
      New-Item -ItemType Directory -Path $target -Force | Out-Null
      continue
    }
    New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
    # Sharing only for reading makes a live SQLite/writer handle fail closed.
    $inputStream = [IO.File]::Open($item.FullName, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    try {
      $outputStream = [IO.File]::Open($target, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
      try { $inputStream.CopyTo($outputStream) } finally { $outputStream.Dispose() }
    } finally { $inputStream.Dispose() }
  }
}

function Assert-SpgStandaloneConfiguration([string]$InstallDir) {
  foreach ($required in @('ServiceProcesgids.Api.exe', 'appsettings.json', 'App_Data/service-procesgids.db')) {
    if (-not (Test-Path -LiteralPath (Join-Path $InstallDir $required) -PathType Leaf)) { throw "Standalone-installatie mist $required" }
  }
  $settings = @(Get-ChildItem -LiteralPath $InstallDir -File -Filter 'appsettings*.json' |
    ForEach-Object { Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json })
  foreach ($config in $settings) {
    if ($config.ServiceProcesgids.Storage -and $config.ServiceProcesgids.Storage -ne 'local') {
      throw 'Deze herstelroute ondersteunt alleen SQLite (Storage=local). SQL Server vraagt een eigen databaseback-up.'
    }
    $sqlite = $config.ConnectionStrings.Sqlite
    if ($sqlite -and $sqlite -notmatch '^\s*Data Source\s*=\s*App_Data[\\/]service-procesgids\.db\s*;?\s*$') {
      throw 'Deze herstelroute vereist het standaard SQLite-pad App_Data/service-procesgids.db.'
    }
  }
  if (($env:ServiceProcesgids__Storage -and $env:ServiceProcesgids__Storage -ne 'local') -or $env:ConnectionStrings__Sqlite) {
    throw 'Externe databaseconfiguratie in deze shell: gebruik de standaard zelfstandige configuratie voor deze herstelroute.'
  }
}

function Get-SpgFileManifest([string]$Path) {
  $root = Get-SpgFullPath $Path
  return @(Get-ChildItem -LiteralPath $root -File -Force -Recurse | Sort-Object FullName | ForEach-Object {
    [pscustomobject]@{ path = $_.FullName.Substring($root.Length + 1).Replace('\', '/'); bytes = $_.Length; sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }
  })
}

function Test-SpgSnapshot([string]$BackupDir) {
  Assert-SpgNoLinks $BackupDir
  $manifest = Get-Content -LiteralPath (Join-Path $BackupDir 'manifest.json') -Raw | ConvertFrom-Json
  if ($manifest.format -ne 'ServiceProcesgids.StandaloneBackup/v1' -or -not $manifest.files) { throw 'Ongeldig back-upmanifest.' }
  $payload = Join-Path $BackupDir 'installation'
  Assert-SpgNoLinks $payload
  $paths = @{}
  foreach ($entry in $manifest.files) {
    if (-not $entry.path -or $entry.path.Contains(':') -or [IO.Path]::IsPathRooted($entry.path) -or $entry.path -match '(^|[\\/])\.\.?([\\/]|$)') {
      throw 'Onveilig bestandspad in back-upmanifest.'
    }
    $file = Assert-SpgChildPath (Join-Path $payload $entry.path) $payload
    if ($paths.ContainsKey($file)) { throw 'Dubbel bestand in back-upmanifest.' }
    $paths[$file] = $true
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Back-upbestand ontbreekt: $($entry.path)" }
    if ((Get-Item -LiteralPath $file).Length -ne $entry.bytes -or (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $entry.sha256) {
      throw "Back-upcontrole mislukt: $($entry.path)"
    }
  }
  if (@(Get-ChildItem -LiteralPath $payload -File -Force -Recurse).Count -ne $paths.Count) { throw 'Back-up bevat bestanden die niet in het manifest staan.' }
  Assert-SpgStandaloneConfiguration $payload
  return $manifest
}
