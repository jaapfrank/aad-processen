# /backend — Service Procesgids (.NET)

**Stack:** ASP.NET Core (.NET 10 LTS) · EF Core · Entra ID/MSAL-validatie + eigen inlog · PdfPig.

Voor de actuele levering en meerdere gehoste bedrijven: [hoofdhandleiding](../README.md),
[hosting](../hosting/README.md).
De milestone-opsomming hieronder beschrijft de ontwikkeling van de API.

Deze map bevat de **backend/API** van de Service Procesgids. Hij implementeert de REST-API uit [`/contract`](../contract/), dwingt rechten **server-side** af en serveert uiteindelijk ook de frontend-build (één pakket).

- Deploy-handleiding: [DEPLOY.md](DEPLOY.md)
- Gedeeld contract (leidend): [../contract/](../contract/)

## M0-status

De eerste ASP.NET Core API staat in:

```text
backend/src/ServiceProcesgids.Api
```

Aanwezige M0-endpoints:

- `GET /api/config`
- `GET /api/me`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/health`
- `GET /api/openapi.yaml`
- `GET /swagger`

Aanwezige M1-endpoints:

- `GET /api/processes`
- `GET /api/processes/{id}`
- `POST /api/processes`
- `PUT /api/processes/{id}`
- `DELETE /api/processes/{id}`
- `GET /api/processes/{id}/health`
- `GET /api/processes/{id}/export`
- `POST /api/processes/import-json`

Aanwezige M2-endpoints/functies:

- Cookie-login voor zelfstandige modus via `POST /api/auth/login` met sessiecookie `spg_session`.
- `GET /api/me` leest de effectieve gebruiker uit cookie of Entra bearer token.
- Lokale gebruikers en rollenbeheer voor beheerders:
  - `GET /api/admin/users`
  - `GET /api/admin/users/{id}`
  - `POST /api/admin/users`
  - `PUT /api/admin/users/{id}`
  - `POST /api/admin/users/{id}/password`
- Entra bearer-tokenvalidatie is configureerbaar via `ServiceProcesgids:Entra`.
- Backend-policies dwingen rollen server-side af:
  - `kijken`: lezen
  - `suggesties`: suggesties indienen
  - `bewerken`: processen/import wijzigen
  - `goedkeuren`: workflow-goedkeuring
  - `beheren`: lokaal gebruikersbeheer en archiveren

Aanwezige M3-endpoints/functies:

- Workflow en versies:
  - `POST /api/processes/{id}/submit`
  - `POST /api/processes/{id}/approve`
  - `POST /api/processes/{id}/reject`
  - `GET /api/processes/{id}/versions`
  - `GET /api/processes/{id}/versions/{v}`
  - `GET /api/processes/{id}/diff?from=1&to=2`
- Suggesties:
  - `POST /api/processes/{id}/steps/{stepId}/suggestions`
  - `GET /api/suggestions`
  - `POST /api/suggestions/{id}/resolve`
- ISO/borging:
  - `GET /api/iso/overview`
  - `GET /api/processes/{id}/iso`
  - `PUT /api/processes/{id}/iso`
  - `GET /api/iso/export?format=csv`
- Audit-log wordt intern gevuld bij proces-, workflow-, suggestie- en ISO-wijzigingen.

Aanwezige M4/M5-importbasis:

- PDF-import:
  - `POST /api/import/pdf`
  - `GET /api/import/{jobId}`
  - `POST /api/import/{jobId}/commit`
- Bronbestand ophalen:
  - `GET /api/files/{id}`
- De import gebruikt PdfPig voor tekstextractie en herkent tabelregels met `Verantwoordelijke / Stap / Activiteit / Opmerking`, inclusief compacte tabeltekst zoals die uit `5. Service v3.3.pdf` komt.
- `paginaAfbeeldingen` zijn PNG-bestandsreferenties (`/api/files/{pngId}`) voor het review-scherm; bij renderfouten valt de import terug op PDF-referenties.

De backend serveert ook static files uit `wwwroot` met SPA-fallback. Later wordt hier de productie-build uit `/frontend` geplaatst.

## Configuratie

De twee afgesproken modi staan in `appsettings.json` onder `ServiceProcesgids`:

- `AuthMode`: `local` of `entra`
- `Storage`: `local` of `db`
- `Runtime:Mode`: standaard `standard`; alleen voor een expliciete ontwikkel-demo `demo`
- `Runtime:DataSource`: standaard `database`; alleen samen met de ontwikkel-demo `demo-fixtures`

Deze waarden kunnen later ook via environment variables worden gezet, bijvoorbeeld:

```text
ServiceProcesgids__AuthMode=entra
ServiceProcesgids__Storage=db
```

### Lokaal ontwikkelen zonder inlogscherm

Voor korte lokale ontwikkel- en UI-tests bestaat een afzonderlijk launchprofiel:

```bash
dotnet run \
  --project backend/src/ServiceProcesgids.Api/ServiceProcesgids.Api.csproj \
  --launch-profile "ServiceProcesgids.Api (zonder login)"
```

Dit profiel vraagt expliciet `ServiceProcesgids__Development__SkipLogin=true`. De backend
accepteert die instelling uitsluitend in een **Debug-build** met
`ASPNETCORE_ENVIRONMENT=Development`, `AuthMode=local`, `Online=false` en `Storage=local`.
Een Release-build, Entra-modus, online runtime of gedeelde database stopt bij het opstarten
fail-closed. Het profiel bindt alleen aan `localhost`; plaats er geen reverse proxy voor en
publiceer deze ontwikkelmodus nooit.

De instelling maakt geen standaardaccount of wachtwoord aan en wijzigt de autorisatiepolicies
niet. De development-sessionendpoint gebruikt later dezelfde cookie- en rolcontroles, een
duidelijk gemarkeerde `development-bypass`-identiteit en een niet-persistente sessie van maximaal
één uur. Een lege lokale database vereist nog steeds de normale eenmalige adminbootstrap.
Het gewone `ServiceProcesgids.Api`-launchprofiel blijft de echte login gebruiken en moet voor
authenticatie- en rollentests worden gebruikt.

Lokale modus:

- Er bestaat geen standaardwachtwoord en een normale webstart maakt nooit stil een beheerder aan.
- Initialiseer een lege installatie eenmalig met `--bootstrap-local-admin`. Het meegeleverde
  `bootstrap-local-admin.ps1` vraagt interactief om een `SecureString`, geeft het wachtwoord
  alleen via tijdelijke procesvariabelen door en ruimt die na afloop op:

```powershell
.\bootstrap-local-admin.ps1 -Executable .\ServiceProcesgids.Api.exe
```

De lage-niveauopdracht vereist beide tijdelijke variabelen
`ServiceProcesgids__LocalUser__BootstrapEnabled=true` en
`ServiceProcesgids__LocalUser__Password`; leg het wachtwoord niet vast in `appsettings.json`,
een script, serviceconfiguratie of commandoregel. De opdracht voert migraties en bootstrap uit en
stopt vóór de webserver start. Als al een lokale gebruiker bestaat, wordt die nooit gereset.

Entra-modus:

- Configureer minimaal `ServiceProcesgids:Entra:TenantId` en `ServiceProcesgids:Entra:ClientId` of geef `Authority` en `Audience` expliciet op.
- Rollen worden afgeleid uit token-groepen via `ServiceProcesgids:Entra:GroupRoleMappings`.
- Voorbeeld environment variables:

```text
ServiceProcesgids__Entra__TenantId=<tenant-id>
ServiceProcesgids__Entra__ClientId=<api-client-id>
ServiceProcesgids__Entra__GroupRoleMappings__<groep-id>__0=kijken
ServiceProcesgids__Entra__GroupRoleMappings__<groep-id>__1=bewerken
```

Opslag:

- `storage=local`: SQLite-bestand in `App_Data/service-procesgids.db`.
- `storage=db`: SQL Server met verplichte `ConnectionStrings:SqlServer`; zonder verbinding stopt de app fail-closed.
- EF Core migrations staan in `Data/Migrations`.
- `standard/database` seedt geen voorbeeldprocessen.
- Alleen de expliciete combinatie `ASPNETCORE_ENVIRONMENT=Development`,
  `Runtime:Mode=demo` en `Runtime:DataSource=demo-fixtures` seedt de meegeleverde fixtures.
  Een ongeldige combinatie stopt de backend; er is geen automatische fallback.

## Starten

Gebruik een .NET SDK en run:

```bash
dotnet run --project backend/src/ServiceProcesgids.Api/ServiceProcesgids.Api.csproj
```

Daarna:

- API health: `http://localhost:5088/api/health`
- Config: `http://localhost:5088/api/config`
- OpenAPI-contract: `http://localhost:5088/api/openapi.yaml`
- OpenAPI-pagina: `http://localhost:5088/swagger`
- Processen: `http://localhost:5088/api/processes`
- Procesgezondheid: `http://localhost:5088/api/processes/service-aanvraagproces/health`

Vanaf M2 vereisen de procesroutes authenticatie. In lokale modus kun je na de eenmalige bootstrap
inloggen met het zelfgekozen wachtwoord:

```bash
curl -i -c cookies.txt -H "Content-Type: application/json" \
  -d '{"gebruikersnaam":"Admin","wachtwoord":"<zelfgekozen-wachtwoord>"}' \
  http://localhost:5088/api/auth/login

curl -b cookies.txt http://localhost:5088/api/processes
```

Voorbeelden na login:

```bash
curl -b cookies.txt http://localhost:5088/api/processes/service-aanvraagproces/versions
curl -b cookies.txt "http://localhost:5088/api/iso/overview?norm=iso9001"
curl -b cookies.txt "http://localhost:5088/api/iso/export?format=csv"
curl -b cookies.txt -F "bestand=@5. Service v3.3.pdf;type=application/pdf" \
  http://localhost:5088/api/import/pdf
```

AI/OpenAI configureer je als beheerder in de UI via **Instellingen → AI & OpenAI**
(`/beheer?tab=ai`). De productieroute gebruikt een server-side API-sleutel voor OpenAI,
Azure OpenAI of Anthropic. De aanwezige ChatGPT/Codex-login is uitsluitend een experimentele
lokale koppeling; zie [`../docs/deploy.md`](../docs/deploy.md#8-ai-assistent-en-openai-koppeling-optioneel)
voor de beperkingen.

Lokale smoke-status 2026-06-11: `dotnet build` is schoon, lokale login/procesroutes werken en `5. Service v3.3.pdf` importeert als `gereed` met 194 conceptstappen. Commit van de import naar een conceptproces is ook getest.

## Publiceren

Op een machine met .NET SDK kan een self-contained Windows-pakket worden gemaakt met:

```powershell
./backend/publish-windows.ps1 -Runtime win-x64
```

Het script kopieert `frontend/dist` naar de backend `wwwroot`, draait `dotnet publish --self-contained true` en maakt een zip in `artifacts/`.

Lokale package-status 2026-06-11: `artifacts/service-procesgids-win-x64-20260611.zip` is aangemaakt en gecontroleerd. Het pakket bevat `ServiceProcesgids.Api.exe`, de actuele frontend-build in `wwwroot`, `contract/openapi.yaml`, procesfixtures en PDFtoImage; lokale `.db`-bestanden worden niet meegepakt.

Doel blijft: **alles in ons pakket**; de gebruiker hoeft niets vooraf te installeren (self-contained publish, later optioneel een Windows-installer).

## Hostingrelease: authenticatie en publicatie

De actuele runtime is .NET 10 LTS. Microsoft-frameworkpakketten zijn vastgezet op 10.0.11.

Bij `POST /api/processes/{id}/submit`, `/approve` en `/reject` is een JSON-body met `expectedRevision` verplicht. Stuur de revisie uit het daadwerkelijk bekeken document, bijvoorbeeld `{"expectedRevision": 7}`. Na HTTP 409 moet de gebruiker opnieuw laden en opnieuw beoordelen. Afwijzen ondersteunt daarnaast `reden`; indienen en goedkeuren ondersteunen `opmerking`.

Deze upgrade trekt oude lokale cookies eenmalig in. Rollen wijzigen, een account deactiveren of een wachtwoord opnieuw instellen trekt bestaande sessies in. De laatste actieve beheerder kan niet worden gedeactiveerd of van beheerrechten worden ontdaan; maak eerst een andere beheerder aan. Lokale login is begrensd op 20 pogingen per client-IP per minuut en geeft daarna HTTP 429.

Lees `HOSTING-SECURITY.md` voor HTTPS, trusted proxies, versleutelde connectorinstellingen en de verplichte eigen certificaat/keyconfiguratie voor online hosting. Readiness voor deployment staat op `/api/health/ready`.
