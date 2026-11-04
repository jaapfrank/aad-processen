# Beveiligingswijzigingen voor de hostingrelease

- Bestaande lokale cookies worden bij deze upgrade één keer afgemeld. Nieuwe cookies zijn aan de actuele accountstatus gebonden; deactivatie, rolwijziging en wachtwoordreset trekken bestaande sessies bij het volgende verzoek in.
- De laatste actieve beheerder kan niet worden gedeactiveerd of de beheerrol verliezen. Dit wordt binnen een database-transactie gecontroleerd.
- De lokale login is begrensd op 20 pogingen per client-IP per minuut, na verwerking van de vertrouwde proxyheaders. Overschrijden geeft HTTP 429.
- Submit, approve en reject vereisen `expectedRevision`. Oudere clients die die niet sturen krijgen HTTP 400; stale documenten krijgen HTTP 409. De gebruiker moet dan opnieuw laden en beoordelen.
- BC-, SMTP- en webhookinstellingen worden met de installatiekeyring versleuteld. Bestaande plaintextbestanden migreren atomair vóór de webserver verzoeken aanneemt. Maak vóór upgrade een beveiligde back-up van App_Data. Onleesbare ciphertext wordt niet met lege defaults overschreven.
- Bij `ServiceProcesgids__Online=true` zijn HTTPS en Secure-cookies verplicht. Alleen `/api/health` en `/api/health/ready` zijn intern over HTTP beschikbaar.
- Forwarding wordt uitsluitend ingeschakeld bij expliciete `ServiceProcesgids__ReverseProxy__KnownProxies__0` (en volgende indices). Alleen client-IP en HTTPS-protocol, maximaal één hop; hostheaders worden niet uit forwarding overgenomen.
- Online vereist `ServiceProcesgids__DataProtection__CertificatePath` en `ServiceProcesgids__DataProtection__PrivateKeyPath` (PEM). Iedere bedrijfsinstallatie gebruikt eigen certificaat, privésleutel en App_Data-volume. Bootstrap gebruikt dezelfde configuratie en secrets als de normale service.
- Herstel omvat de volledige App_Data-map plus de bijbehorende certificaat/privésleutel. Zonder de originele privésleutel zijn bestaande opgeslagen credentials niet herstelbaar. Certificaatrotatie vraagt een afzonderlijk migratieplan; vervang het certificaat niet rechtstreeks op een bestaande installatie.
- `/api/health/ready` controleert de databaseverbinding. Initialisatie/migraties moeten voltooid zijn voordat de server verzoeken aanneemt.

Controleer deze upgrade op een kopie van een bestaande installatie en op een lege installatie. De bijbehorende selftests staan onder `backend/tests/AuthWorkflow.SelfTest` en `backend/tests/HostingSecurity.SelfTest`.

## Uitgevoerde controles (8 september 2026)

De API bouwt op .NET 10 LTS met Microsoft-pakketten 10.0.11; de gecontroleerde Release-build had nul waarschuwingen en nul fouten.

| Controle | Uitkomst |
| --- | --- |
| AuthWorkflow.SelfTest | 10 scenario's groen: sessie-intrekking, laatste beheerder, revisies, race, snapshots en audit |
| HostingSecurity.SelfTest | 4 scenario's groen: werkelijke proxyheader-middleware, certificaatplicht, keyringherstel, connectorencryptie en veilige migratie |
| Configuration.SelfTest | 18 scenario's groen |
| AiRunMigration.SelfTest | 5 scenario's groen, waaronder behoud van bestaande synthetische SQLite-data tijdens upgrade |
| AiRunLedger.SelfTest | 6 scenario's groen |
| AssuranceProgram.SelfTest | 5 scenario's groen |
| AssuranceFrameworkDrafts.SelfTest | Groen |
| ProcessMaintenance.Eval | 10/10 offline evaluaties groen |
| DiagramExchange.SelfTest | 43 codeccontroles groen, inclusief gewone Visio-bestanden |
| auth-workflow-http.selftest.ps1 | Verse tijdelijke Production-runtime: readiness, browser-originbescherming, laatste-admin409, ingetrokken cookie401, workflow400/409/200, same-originlogout204, login429 en echte multipart-Visio-import met paginakeuze/bronpagina/expliciete rol groen |

De HTTP-smoke gebruikt uitsluitend een expliciet tijdelijke SQLite-connectionstring en tijdelijke accounts. Geërfde productieconnectionstrings worden overschreven. De Windows EventLog-provider staat in die test uit omdat de sandbox geen toegang tot het systeemevenementenlog heeft; consolelogs blijven beschikbaar.

## Browser-originbescherming

Onveilige cookieverzoeken (POST/PUT/PATCH/DELETE) zijn gebonden aan dezelfde scheme, host en poort. Een expliciete vreemde Origin, `Origin: null`, `Sec-Fetch-Site: same-site` of `cross-site` wordt met 403 geweigerd. Dit voorkomt dat een ander bedrijfs-subdomein de browsercookie gebruikt om een credential in te trekken of een sessie af te melden. Een losse Bearer-header omzeilt de controle niet in de lokale authenticatiemodus.

Entra-installaties gebruiken Bearer-authenticatie en vallen niet onder de cookiecheck. Niet-browser-API-clients zonder Origin/Fetch Metadata blijven werken wanneer zij zelf over een geldige cookie beschikken.

## Werkelijke grenzen van deze release

- Bewerken en goedkeuren zijn afzonderlijke bevoegdheden, maar er is geen verplichte vierogenregel die verschillende personen afdwingt. Een bevoegde beheerder kan zelf indienen en goedkeuren. Iedere goedkeuring is wel aan de bekeken revisie gebonden.
- Live Entra-login met een echte klanttenant en echte betaalde AI-providers is niet door deze selftests bewezen. De genoemde AI-evaluaties zijn expliciet offline.
- Automatische certificaatrotatie met een overgang tussen oude en nieuwe ontsleutelsleutels ontbreekt. De bestaande certificaat/privésleutel moet met iedere herstelset behouden blijven.
- Deze applicatietests vervangen de afzonderlijke Docker/Caddy-proef op HTTPS, de scheiding van bedrijfsvolumes en herstel op een tweede host niet. Die hostingproef heeft eigen release-evidence.

## Zelf herhalen

Gebruik de .NET 10 SDK vanuit de projectroot:

```powershell
dotnet run --project backend/tests/AuthWorkflow.SelfTest/AuthWorkflow.SelfTest.csproj -c Release
dotnet run --project backend/tests/HostingSecurity.SelfTest/HostingSecurity.SelfTest.csproj -c Release
./backend/tests/auth-workflow-http.selftest.ps1 -Dotnet (Get-Command dotnet).Source
```

Optionele Visio-test met uitsluitend gegenereerde synthetische bestanden:

```powershell
dotnet run --project backend/tests/DiagramExchange.SelfTest/DiagramExchange.SelfTest.csproj -c Release -- --write-fixtures .shots/visio-fixtures
./backend/tests/auth-workflow-http.selftest.ps1 -Dotnet (Get-Command dotnet).Source -VisioFixtureDirectory .shots/visio-fixtures
```
