# Backend Deploy Handleiding

Voor het webproduct met meerdere bedrijven gebruikt u de containerhosting in
`hosting/README.md` van de broncode. Iedere organisatie heeft daarin een eigen app,
databasevolume en versleutelde keyring achter HTTPS. Deze handleiding betreft de
afzonderlijke Windows/standalone-editie.

## Volledig herstel van een Windows-installatie

De ingebouwde back-up bevat de database en een procesexport. Voor herstel van een volledige
zelfstandige installatie moeten ook instellingen, Data Protection-sleutels en de bijbehorende
binaries bewaard blijven. Stop de app/service volledig en houd deze gestopt tijdens de kopie:

```powershell
Stop-Service ServiceProcesgids
.\backup-standalone.ps1 -InstallDir 'C:\Program Files\ServiceProcesgids' -Destination 'D:\Backups\spg-20260908' -ApplicationStopped
Start-Service ServiceProcesgids
```

Dit maakt een SHA-256-gecontroleerde snapshot van de hele installatie, inclusief App_Data,
WAL/SHM, instellingen, keyring en binaries. De route ondersteunt alleen de standaard lokale
SQLite-database. Kies een nieuwe beschermde doelmap buiten de installatie; een bestaande
snapshot wordt nooit overschreven. Omgevingsvariabelen, externe certificaten en SQL Server
vereisen aanvullend het eigen beheerbeleid. Bewaar snapshots versleuteld en buiten de host.

```powershell
.\restore-standalone.ps1 -BackupDir 'D:\Backups\spg-20260908' -Destination 'C:\Apps\SpgHerstel' -VerifyOnly
.\restore-standalone.ps1 -BackupDir 'D:\Backups\spg-20260908' -Destination 'C:\Apps\SpgHerstel'
& 'C:\Apps\SpgHerstel\ServiceProcesgids.Api.exe' --contentRoot 'C:\Apps\SpgHerstel' --urls http://127.0.0.1:5089
```

Herstel schrijft uitsluitend naar een nog niet bestaande map en start geen service. Controleer
login, een procesversie, bijlagen en een eventuele providercredential vóór omschakelen. Voer
bij herstel geen bootstrap uit. Verwijderen via `install-windows.ps1 -Uninstall` bewaart alle
installatiebestanden en gegevens. Een nieuwe publish weigert een bouwdoel met App_Data; kies
een schone OutputRoot en upgrade pas nadat een volledige snapshot is gecontroleerd.

Deze handleiding hoort bij het self-contained pakket uit `artifacts/service-procesgids-win-x64-20260611.zip` (of de nieuwste zip uit `artifacts/`).

## Zelfstandig starten

1. Pak de zip uit naar een vaste map, bijvoorbeeld `C:\Apps\ServiceProcesgids`.
2. Start de API:

   ```powershell
   .\ServiceProcesgids.Api.exe --urls http://localhost:5088
   ```

3. Open de app of API:
   - App: `http://localhost:5088`
   - Health: `http://localhost:5088/api/health`
   - Swagger: `http://localhost:5088/swagger`

De frontend-build zit in `wwwroot` en wordt door dezelfde backend geserveerd.

## Lokale modus

Standaard draait de pilot in zelfstandige modus:

```json
"ServiceProcesgids": {
  "AuthMode": "local",
  "Storage": "local",
  "Runtime": {
    "Mode": "standard",
    "DataSource": "database"
  }
}
```

Er is geen standaardwachtwoord. Initialiseer een nieuwe lokale database vóór de eerste webstart:

```powershell
.\bootstrap-local-admin.ps1 -Executable .\ServiceProcesgids.Api.exe
```

Het script vraagt tweemaal om een `SecureString`, voert
`ServiceProcesgids.Api.exe --bootstrap-local-admin` uit met tijdelijke procesvariabelen en
verwijdert die altijd weer. Het wachtwoord hoort niet in `appsettings.json`, de serviceconfiguratie
of de commandoregel. De bootstrap migreert de database, maakt alleen bij een lege lokale
gebruikertabel de eerste `Admin` aan en stopt zonder webserver. Een bestaande gebruiker wordt
nooit opnieuw ingesteld.

De standaardcombinatie `standard/database` gebruikt uitsluitend de database en seedt geen
voorbeeldprocessen. Fixtures zijn alleen beschikbaar met de expliciete combinatie
`ASPNETCORE_ENVIRONMENT=Development`, `Runtime:Mode=demo` en
`Runtime:DataSource=demo-fixtures`; demo start niet in Production en er is geen fallback.

## Gekoppelde modus

Voor Entra/AD-SSO:

```powershell
$env:ServiceProcesgids__AuthMode = "entra"
$env:ServiceProcesgids__Entra__TenantId = "<tenant-id>"
$env:ServiceProcesgids__Entra__ClientId = "<api-client-id>"
$env:ServiceProcesgids__Entra__GroupRoleMappings__<groep-id>__0 = "kijken"
$env:ServiceProcesgids__Entra__GroupRoleMappings__<groep-id>__1 = "bewerken"
```

De frontend gebruikt `GET /api/config` en `GET /api/me` om de modus en rollen te bepalen.

## Database

Voor lokale opslag gebruikt de app SQLite in `App_Data/service-procesgids.db`.

Voor centrale opslag zet je `Storage=db` en configureer je SQL Server:

```powershell
$env:ServiceProcesgids__Storage = "db"
$env:ConnectionStrings__SqlServer = "Server=...;Database=ServiceProcesgids;..."
```

`Storage=db` vereist een expliciete SQL Server-connectionstring. Zonder die configuratie stopt de
backend; er is geen automatische SQLite-fallback.

## IIS of reverse proxy

Voor IIS gebruik je het pakket als ASP.NET Core app achter de ASP.NET Core Module of als reverse proxy naar Kestrel.

Minimale Kestrel-start achter een proxy:

```powershell
.\ServiceProcesgids.Api.exe --urls http://127.0.0.1:5088
```

Zet TLS, externe hostnamen en toegangsregels bij voorkeur op IIS/reverse-proxy niveau.

## Smoke-test na deploy

```powershell
Invoke-RestMethod http://localhost:5088/api/health
Invoke-RestMethod http://localhost:5088/api/config
```

In lokale modus:

```powershell
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
Invoke-RestMethod http://localhost:5088/api/auth/login `
  -Method Post `
  -WebSession $session `
  -ContentType "application/json" `
  -Body '{"gebruikersnaam":"Admin","wachtwoord":"<wachtwoord>"}'

Invoke-RestMethod http://localhost:5088/api/processes -WebSession $session
```
