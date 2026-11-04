[CmdletBinding()]
param(
  [string]$Executable = (Join-Path $PSScriptRoot "ServiceProcesgids.Api.exe")
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) {
  throw "Backend niet gevonden: $Executable"
}
$resolvedExecutable = (Resolve-Path -LiteralPath $Executable).Path
$contentRoot = Split-Path -Parent $resolvedExecutable

Write-Host "Kies het wachtwoord voor de eerste lokale beheerder (Admin)."
$password = Read-Host "Nieuw wachtwoord (minimaal 12 tekens)" -AsSecureString
if ($password.Length -lt 12) {
  $password.Dispose()
  throw "Het initiële beheerderswachtwoord moet minimaal 12 tekens lang zijn."
}

$confirmation = Read-Host "Herhaal het nieuwe wachtwoord" -AsSecureString
$passwordPointer = [System.IntPtr]::Zero
$confirmationPointer = [System.IntPtr]::Zero
$plainPassword = $null
$plainConfirmation = $null

try {
  $passwordPointer = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($password)
  $confirmationPointer = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($confirmation)
  $plainPassword = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
  $plainConfirmation = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($confirmationPointer)

  if (-not [string]::Equals($plainPassword, $plainConfirmation, [System.StringComparison]::Ordinal)) {
    throw "De twee wachtwoorden zijn niet gelijk."
  }

  [Environment]::SetEnvironmentVariable(
    "ServiceProcesgids__LocalUser__BootstrapEnabled",
    "true",
    [System.EnvironmentVariableTarget]::Process)
  [Environment]::SetEnvironmentVariable(
    "ServiceProcesgids__LocalUser__Password",
    $plainPassword,
    [System.EnvironmentVariableTarget]::Process)

  & $resolvedExecutable "--bootstrap-local-admin" "--contentRoot" $contentRoot
  $bootstrapExitCode = $LASTEXITCODE
  if ($bootstrapExitCode -ne 0) {
    throw "De lokale-adminbootstrap is mislukt met exitcode $bootstrapExitCode."
  }
}
finally {
  [Environment]::SetEnvironmentVariable(
    "ServiceProcesgids__LocalUser__BootstrapEnabled",
    $null,
    [System.EnvironmentVariableTarget]::Process)
  [Environment]::SetEnvironmentVariable(
    "ServiceProcesgids__LocalUser__Password",
    $null,
    [System.EnvironmentVariableTarget]::Process)

  $plainPassword = $null
  $plainConfirmation = $null
  if ($passwordPointer -ne [System.IntPtr]::Zero) {
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
  }
  if ($confirmationPointer -ne [System.IntPtr]::Zero) {
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($confirmationPointer)
  }
  $password.Dispose()
  $confirmation.Dispose()
}

Write-Host "De lokale beheerder is klaar. De tijdelijke bootstrapvariabelen zijn verwijderd."
