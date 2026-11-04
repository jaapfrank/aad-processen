param(
  [string]$Dotnet = "dotnet",
  [string]$VisioFixtureDirectory = "",
  [string]$ApiDll = (Join-Path $PSScriptRoot "..\src\ServiceProcesgids.Api\bin\Release\net10.0\ServiceProcesgids.Api.dll")
)
$ErrorActionPreference = "Stop"
$resolvedDll = (Resolve-Path -LiteralPath $ApiDll).Path
$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("spg-auth-http-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $testRoot | Out-Null
$server = $null
$originalEnvironment = @{}
$testEnvironment = @{
  ASPNETCORE_ENVIRONMENT = "Production"
  Logging__EventLog__LogLevel__Default = "None"
  ServiceProcesgids__AuthMode = "local"
  ServiceProcesgids__Storage = "local"
  ConnectionStrings__Sqlite = ("Data Source=" + (Join-Path $testRoot "App_Data\http-selftest.db") + ";Pooling=False")
  ServiceProcesgids__Online = "false"
  ServiceProcesgids__Runtime__Mode = "standard"
  ServiceProcesgids__Runtime__DataSource = "database"
  ServiceProcesgids__Backup__Enabled = "false"
  ServiceProcesgids__LocalUser__BootstrapEnabled = "true"
  ServiceProcesgids__LocalUser__Password = "isolated-http-selftest-password"
}
foreach ($entry in $testEnvironment.GetEnumerator()) {
  $originalEnvironment[$entry.Key] = [Environment]::GetEnvironmentVariable($entry.Key, "Process")
  [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, "Process")
}
function Invoke-TestApi([string]$Method, [string]$Path, $Body, $Session, $Headers = @{}) {
  $parameters = @{ Uri = $script:testBase + $Path; Method = $Method; UseBasicParsing = $true; ErrorAction = "Stop" }
  if ($null -ne $Session) { $Session.Headers.Clear(); $parameters.WebSession = $Session }
  if ($Headers.Count -gt 0) { $parameters.Headers = $Headers }
  if ($null -ne $Body) { $parameters.Body = ($Body | ConvertTo-Json -Depth 20 -Compress); $parameters.ContentType = "application/json" }
  try {
    $response = Invoke-WebRequest @parameters
    $document = if ($response.Content) { $response.Content | ConvertFrom-Json } else { $null }
    return @{ Status = [int]$response.StatusCode; Body = $document }
  }
  catch {
    if ($null -eq $_.Exception.Response) { throw }
    return @{ Status = [int]$_.Exception.Response.StatusCode; Body = $null }
  }
}
function Invoke-TestVisio([string]$Path, [string]$Query, $Session) {
  $handler = [System.Net.Http.HttpClientHandler]::new()
  $handler.CookieContainer = $Session.Cookies
  $client = [System.Net.Http.HttpClient]::new($handler)
  $multipart = [System.Net.Http.MultipartFormDataContent]::new()
  try {
    $bytes = [System.Net.Http.ByteArrayContent]::new([System.IO.File]::ReadAllBytes($Path))
    $bytes.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse("application/vnd.ms-visio.drawing")
    $multipart.Add($bytes, "bestand", [System.IO.Path]::GetFileName($Path))
    $response = $client.PostAsync(($script:testBase + "/api/diagrams/visio/import" + $Query), $multipart).GetAwaiter().GetResult()
    try {
      $json = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
      return @{ Status = [int]$response.StatusCode; Body = ($json | ConvertFrom-Json) }
    }
    finally { $response.Dispose() }
  }
  finally { $multipart.Dispose(); $client.Dispose(); $handler.Dispose() }
}
function Assert-Status($Response, [int]$Expected, [string]$Message) {
  if ($Response.Status -ne $Expected) { throw "$Message (verwacht $Expected, ontvangen $($Response.Status))." }
}
try {
  & $Dotnet $resolvedDll --bootstrap-local-admin --contentRoot $testRoot *> (Join-Path $testRoot "bootstrap.log")
  if ($LASTEXITCODE -ne 0) { throw "Bootstrap van uitsluitend tijdelijke testdatabase faalde. Zie $testRoot\bootstrap.log" }
  [Environment]::SetEnvironmentVariable("ServiceProcesgids__LocalUser__BootstrapEnabled", "false", "Process")
  [Environment]::SetEnvironmentVariable("ServiceProcesgids__LocalUser__Password", $null, "Process")
  $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, 0)
  $listener.Start()
  $port = $listener.LocalEndpoint.Port
  $listener.Stop()
  $script:testBase = "http://127.0.0.1:$port"
  $arguments = '"' + $resolvedDll + '" --contentRoot "' + $testRoot + '" --urls ' + $script:testBase
  $server = Start-Process -FilePath $Dotnet -ArgumentList $arguments -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $testRoot "server.log") -RedirectStandardError (Join-Path $testRoot "server-error.log")
  $ready = $false
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    try { $response = Invoke-TestApi GET /api/health/ready $null $null; $ready = $response.Status -eq 200 } catch {}
    if ($ready) { break }
    if ($server.HasExited) { throw "Tijdelijke testserver is gestopt." }
    Start-Sleep -Milliseconds 200
  }
  if (-not $ready) { throw "Tijdelijke testserver werd niet gereed." }
  Write-Output "readiness na migraties/bootstrap: OK"
  Assert-Status (Invoke-TestApi GET /api/me $null $null) 401 "Anonieme gebruiker mocht binnen"
  $admin = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  Assert-Status (Invoke-TestApi POST /api/auth/login @{ gebruikersnaam = "Admin"; wachtwoord = "isolated-http-selftest-password" } $admin) 200 "Adminlogin faalde"
  foreach ($headers in @(
    @{ Origin = "https://sibling.example.invalid"; "Sec-Fetch-Site" = "same-site" },
    @{ Origin = "null" },
    @{ "Sec-Fetch-Site" = "cross-site" },
    @{ "Sec-Fetch-Site" = "same-site" },
    @{ Origin = "https://sibling.example.invalid"; Authorization = "Bearer not-a-valid-token" }
  )) {
    Assert-Status (Invoke-TestApi POST /api/admin/ai-instellingen/credential/revoke $null $admin $headers) 403 "Browser origin kon credentialmutatie uitvoeren"
    Assert-Status (Invoke-TestApi POST /api/auth/logout $null $admin $headers) 403 "Browser origin kon sessie afmelden"
  }
  Assert-Status (Invoke-TestApi GET /api/me $null $admin) 200 "Geweigerde CSRF-request heeft sessie gewijzigd"
  Write-Output "sibling-origin, opaque Origin null en cross-site fetchmetadata kunnen cookie-mutaties niet uitvoeren: OK"
  $administrators = Invoke-TestApi GET /api/admin/users/ $null $admin
  $adminId = ($administrators.Body | Where-Object { $_.gebruikersnaam -eq "Admin" }).id
  Assert-Status (Invoke-TestApi PUT ("/api/admin/users/" + $adminId) @{ naam = "Admin"; rollen = @("beheren"); actief = $false } $admin) 409 "Laatste beheerder kon zichzelf deactiveren"
  Assert-Status (Invoke-TestApi PUT ("/api/admin/users/" + $adminId) @{ naam = "Admin"; rollen = @("kijken"); actief = $true } $admin) 409 "Laatste beheerder kon beheerrechten verwijderen"
  Assert-Status (Invoke-TestApi GET /api/me $null $admin) 200 "Geweigerde wijziging heeft beheerder buitengesloten"
  Write-Output "laatste beheerder blijft actief; ongeldige wijzigingen geven HTTP 409: OK"
  $created = Invoke-TestApi POST /api/admin/users/ @{ gebruikersnaam = "reader"; naam = "Testlezer"; wachtwoord = "isolated-reader-password"; rollen = @("kijken"); actief = $true } $admin
  Assert-Status $created 201 "Testgebruiker aanmaken faalde"
  $reader = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  Assert-Status (Invoke-TestApi POST /api/auth/login @{ gebruikersnaam = "reader"; wachtwoord = "isolated-reader-password" } $reader) 200 "Lezerlogin faalde"
  Assert-Status (Invoke-TestApi GET /api/me $null $reader) 200 "Lezersessie was niet geldig"
  Assert-Status (Invoke-TestApi PUT ("/api/admin/users/" + $created.Body.id) @{ naam = "Testlezer"; rollen = @("kijken"); actief = $false } $admin) 200 "Deactiveren faalde"
  Assert-Status (Invoke-TestApi GET /api/me $null $reader) 401 "Cookie van gedeactiveerde gebruiker bleef geldig"
  Write-Output "echte cookie wordt na deactiveren ingetrokken: OK"
  $document = @{
    id = "http-test-process"; hoofdproces = "Procesbeheer"; detailproces = "HTTP-selftest"; versie = "V1"; status = "concept"; laatsteWijziging = "2026-09-08"
    lanes = @(@{ id = "owner"; naam = "Eigenaar"; kleur = "#333333" }); secties = @()
    stappen = @(@{ id = "end"; nummer = "1"; laneId = "owner"; type = "eind"; activiteit = "Afgerond" })
  }
  $process = Invoke-TestApi POST /api/processes/ $document $admin
  Assert-Status $process 201 "Testproces aanmaken faalde"
  Assert-Status (Invoke-TestApi POST /api/processes/http-test-process/submit @{} $admin) 400 "Ontbrekende bekeken revisie werd geaccepteerd"
  Assert-Status (Invoke-TestApi POST /api/processes/http-test-process/submit @{ expectedRevision = $process.Body.revision } $admin) 200 "Indienen faalde"
  Assert-Status (Invoke-TestApi POST /api/processes/http-test-process/approve @{ expectedRevision = $process.Body.revision } $admin) 409 "Oude revisie werd goedgekeurd"
  $review = Invoke-TestApi GET /api/workspace/processes/http-test-process $null $admin
  Assert-Status $review 200 "Reviewdocument ophalen faalde"
  Assert-Status (Invoke-TestApi POST /api/processes/http-test-process/approve @{ expectedRevision = $review.Body.revision } $admin) 200 "Bekeken reviewversie publiceren faalde"
  Assert-Status (Invoke-TestApi GET /api/processes/http-test-process $null $admin) 200 "Publicatie ontbreekt"
  Write-Output "echte workflowroutes blokkeren ontbrekende/oude revisie en publiceren bekeken document: OK"
  if (-not [string]::IsNullOrWhiteSpace($VisioFixtureDirectory)) {
    $multiple = Join-Path $VisioFixtureDirectory "ordinary-multiple-pages.vsdx"
    $review = Invoke-TestVisio $multiple "" $admin
    Assert-Status $review 200 "Visio-paginareview faalde"
    if ($review.Body.ok -or $review.Body.pages.Count -ne 2) { throw "Meerdere Visio-pagina's vereisten geen keuze." }
    $selected = Invoke-TestVisio $multiple ("?pageId=" + [Uri]::EscapeDataString("visio/pages/page2.xml")) $admin
    Assert-Status $selected 200 "Visio-paginakeuze faalde"
    if (-not $selected.Body.ok -or $selected.Body.process.detailproces -ne "Onderhoud" -or $selected.Body.process.bron.paginas -notcontains 2) { throw "Gekozen Visio-pagina is niet correct doorgestuurd naar de codec." }
    $without = Join-Path $VisioFixtureDirectory "ordinary-without-lanes.vsdx"
    $roleReview = Invoke-TestVisio $without "" $admin
    Assert-Status $roleReview 200 "Visio-rollenreview faalde"
    if ($roleReview.Body.ok -or $roleReview.Body.errors.code -notcontains "roles-missing") { throw "Ontbrekende Visio-rollen vereisten geen bevestiging." }
    $role = "Inkoper & kwaliteit"
    $assigned = Invoke-TestVisio $without ("?defaultRole=" + [Uri]::EscapeDataString($role)) $admin
    Assert-Status $assigned 200 "Visio-rolkeuze faalde"
    if (-not $assigned.Body.ok -or $assigned.Body.process.lanes[0].naam -ne $role -or $assigned.Body.process.bron.type -ne "visio-import") { throw "Expliciete Visio-rol is niet correct doorgestuurd." }
    Write-Output "echte multipart-Visio-import ondersteunt paginakeuze, bronpagina en expliciete rol met queryencoding: OK"
  }
  Assert-Status (Invoke-TestApi POST /api/auth/logout $null $admin @{ Origin = $script:testBase; "Sec-Fetch-Site" = "same-origin" }) 204 "Legitieme same-origin mutatie werd geblokkeerd"
  Assert-Status (Invoke-TestApi GET /api/me $null $admin) 401 "Legitiem afmelden heeft sessie niet beëindigd"
  Write-Output "legitieme same-origin cookie-mutatie blijft toegestaan: OK"
  $limited = $false
  for ($attempt = 0; $attempt -lt 25; $attempt++) {
    $response = Invoke-TestApi POST /api/auth/login @{ gebruikersnaam = "reader"; wachtwoord = "incorrect-selftest" } $null
    if ($response.Status -eq 429) { $limited = $true; break }
    Assert-Status $response 401 "Ongeldige login gaf onverwachte status"
  }
  if (-not $limited) { throw "Herhaalde loginpogingen werden niet begrensd." }
  Write-Output "loginpogingen krijgen HTTP 429 na de toegestane limiet: OK"
}catch {
  foreach ($log in @("server.log", "server-error.log", "bootstrap.log")) {
    $logPath = Join-Path $testRoot $log
    if (Test-Path -LiteralPath $logPath) { Get-Content -LiteralPath $logPath -Tail 50 }
  }
  throw
}
finally {
  if ($null -ne $server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force; $server.WaitForExit() }
  foreach ($entry in $originalEnvironment.GetEnumerator()) { [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, "Process") }
  $resolvedTestRoot = [System.IO.Path]::GetFullPath($testRoot)
  $allowedParent = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
  if ($resolvedTestRoot.StartsWith($allowedParent, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $resolvedTestRoot) -like 'spg-auth-http-*') {
    Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force
  }
}