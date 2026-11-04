# Service Procesgids — installatie als Windows-service.
# Gebruik (als Administrator):
#   .\install-windows.ps1 -PackageDir ..\artifacts\service-procesgids-win-x64 -Port 5088
#   .\install-windows.ps1 -Uninstall
param(
  [string]$PackageDir = "",
  [string]$InstallDir = "C:\Program Files\ServiceProcesgids",
  [int]$Port = 5088,
  [switch]$Uninstall
)

$ErrorActionPreference = "Stop"
$ServiceName = "ServiceProcesgids"

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "Voer dit script uit als Administrator."
}

if ($Uninstall) {
  if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    sc.exe delete $ServiceName | Out-Null
    Write-Host "Service '$ServiceName' verwijderd."
  }
  Remove-NetFirewallRule -DisplayName "Service Procesgids" -ErrorAction SilentlyContinue
  Write-Host "Installatiebestanden en alle App_Data blijven bewaard in $InstallDir."
  return
}

$packageCandidate = $PackageDir
if ([string]::IsNullOrWhiteSpace($packageCandidate)) {
  $packagedExecutable = Join-Path $PSScriptRoot "ServiceProcesgids.Api.exe"
  $packageCandidate = if (Test-Path -LiteralPath $packagedExecutable -PathType Leaf) {
    $PSScriptRoot
  }
  else {
    Join-Path $PSScriptRoot "..\artifacts\service-procesgids-win-x64"
  }
}

$resolvedPackage = (Resolve-Path -LiteralPath $packageCandidate).Path
$exe = Join-Path $resolvedPackage "ServiceProcesgids.Api.exe"
if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) {
  throw "Pakket niet gevonden: $exe. Bouw eerst met publish-windows.ps1."
}

$databasePath = Join-Path $InstallDir "App_Data\service-procesgids.db"
$hadExistingDatabase = Test-Path -LiteralPath $databasePath -PathType Leaf
$existingService = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
$isUpgrade = $hadExistingDatabase -or $null -ne $existingService

# Bestaande service stoppen voor een upgrade.
if ($null -ne $existingService) {
  Stop-Service -Name $ServiceName -Force
  $existingService.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
}

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$resolvedInstallDir = [System.IO.Path]::GetFullPath($InstallDir)
if (-not [string]::Equals($resolvedPackage, $resolvedInstallDir, [System.StringComparison]::OrdinalIgnoreCase)) {
  # App_Data is installatiegebonden. Neem nooit database of secrets uit een
  # bouw-/bronpakket over en overschrijf die map bij een upgrade evenmin.
  Get-ChildItem -LiteralPath $resolvedPackage -Force |
    Where-Object { $_.Name -ne "App_Data" } |
    ForEach-Object {
      Copy-Item -LiteralPath $_.FullName -Destination $InstallDir -Recurse -Force
    }
  Write-Host "Pakket gekopieerd naar $InstallDir (bestaande App_Data is behouden)."
}
else {
  Write-Host "Pakket draait al vanuit de installatiemap; bestanden hoeven niet te worden gekopieerd."
}

$installedExe = Join-Path $InstallDir "ServiceProcesgids.Api.exe"
if (-not $isUpgrade) {
  $bootstrapScript = Join-Path $InstallDir "bootstrap-local-admin.ps1"
  if (-not (Test-Path -LiteralPath $bootstrapScript -PathType Leaf)) {
    $bootstrapScript = Join-Path $PSScriptRoot "bootstrap-local-admin.ps1"
  }
  if (-not (Test-Path -LiteralPath $bootstrapScript -PathType Leaf)) {
    throw "Bootstrap-hulpmiddel ontbreekt: bootstrap-local-admin.ps1"
  }

  Write-Host "Nieuwe installatie: de eerste lokale beheerder wordt eenmalig aangemaakt."
  & $bootstrapScript -Executable $installedExe
}
else {
  Write-Host "Bestaande installatie gevonden; accounts en wachtwoorden blijven ongewijzigd."
}

$binPath = "`"$installedExe`" --contentRoot `"$InstallDir`" --urls http://0.0.0.0:$Port"
if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
  sc.exe config $ServiceName binPath= $binPath | Out-Null
}
else {
  sc.exe create $ServiceName binPath= $binPath start= auto DisplayName= "Service Procesgids" | Out-Null
  sc.exe description $ServiceName "Interactieve procesgids (frontend + API in één pakket)." | Out-Null
}
sc.exe failure $ServiceName reset= 86400 actions= restart/5000/restart/15000/restart/60000 | Out-Null

if (-not (Get-NetFirewallRule -DisplayName "Service Procesgids" -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName "Service Procesgids" -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port | Out-Null
  Write-Host "Firewall-regel toegevoegd voor poort $Port."
}

Start-Service -Name $ServiceName
Write-Host "Service '$ServiceName' draait — open http://localhost:$Port"
Write-Host "Log in als Admin met het wachtwoord dat tijdens de eerste installatie is gekozen."
