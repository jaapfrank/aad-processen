# R0 runtime-, bootstrap- en AI-contract

Dit document beschrijft de fail-closed backendgrens van R0. R0 is
`single-tenant`; de publieke contracten bevatten al een expliciet
`tenantType`, zodat een latere tenant-vault of control plane toegevoegd kan
worden zonder secrets in bestaande responses op te nemen.

## Runtime en demodata

De normale configuratie is:

```text
ServiceProcesgids__Runtime__Mode=standard
ServiceProcesgids__Runtime__DataSource=database
```

Alleen in `ASPNETCORE_ENVIRONMENT=Development` mag een beheerder expliciet
kiezen voor:

```text
ServiceProcesgids__Runtime__Mode=demo
ServiceProcesgids__Runtime__DataSource=demo-fixtures
```

Andere waarden en gemengde combinaties stoppen de applicatie. Er bestaat geen
automatische fallback naar demo, mock of fixtures. `GET /api/config` rapporteert
de effectieve `environment`, `profile`, `tenantType`, `mode`, `dataSource`,
`isDemo`, `syntheticData` en altijd `fallbackUsed: false`.

## Eenmalige lokale admin-bootstrap

Een lege lokale database start niet met een bekend standaardwachtwoord. Voer
voor precies de eerste start de aparte opdracht `--bootstrap-local-admin` uit
en lever het secret uitsluitend via tijdelijke procesvariabelen:

```text
ServiceProcesgids__LocalUser__BootstrapEnabled=true
ServiceProcesgids__LocalUser__Password=<tijdelijk-sterk-secret>
```

De opdracht voert migraties en `DatabaseInitializer` uit en stopt vóór de
webserver start. Gebruik op Windows bij voorkeur `bootstrap-local-admin.ps1`;
dat script vraagt tweemaal om een `SecureString` en ruimt beide variabelen in
een `finally`-blok op. Daarna:

1. controleer dat de beheerder kan inloggen;
2. start de backend normaal, zonder bootstrapargument of -variabelen.

Een normale webstart weigert achtergebleven bootstrapvariabelen. Zonder
bestaande lokale gebruiker én zonder de aparte bootstrapopdracht stopt de
backend met een configuratiefout. Een herhaalde bootstrap reset geen bestaand
account. Procesfixtures worden alleen in de hierboven beschreven
development-demo geseed.

## AI-activering

AI heeft vier expliciete productmodi:

- `disabled`: geen providercall, ook niet als ergens een sleutel aanwezig is;
- `managed`: centraal platformprofiel en platformcredential uitsluitend uit
  `ServiceProcesgids__Ai__Managed__*`; standaard niet beschikbaar totdat
  platformbeheer `Enabled=true`, provider, model en credential heeft ingericht;
- `byo`: write-only organisatiecredential via de beheer-API, versleuteld met de
  persistente ASP.NET Core Data Protection-keyring;
- lokale ChatGPT OAuth (`Inloggen met ChatGPT`): uitsluitend voor een lokale/offline zelfstandige
  single-tenant installatie. De beheerder koppelt in de browser een
  ChatGPT/Codex-abonnement; deze productmodus gebruikt geen Platform
  API-sleutel.

Provider én model/deployment moeten expliciet worden gekozen. Er is geen
hardcoded modelfallback. OpenAI en Anthropic gebruiken vaste officiële
API-routes. Azure accepteert alleen een HTTPS-basisendpoint op
`*.openai.azure.com` of `*.services.ai.azure.com`, zonder aangepast pad, query,
userinfo of poort.

De keyring staat onder `App_Data/data-protection-keys`. Productie-installaties
moeten die directory meenemen in back-up/herstel, beperken met OS-ACL's en de
keyring met een platformmechanisme beschermen. Verlies van de keyring vereist
credentialrotatie.

### Beheer-API

- `GET /api/admin/ai-instellingen`: status en niet-reversibele fingerprint;
  nooit een secret.
- `PUT /api/admin/ai-instellingen`: provider/model/mode wijzigen. `apiKey` is
  alleen tijdelijke backwards-compatibiliteit en wordt direct naar
  tenantgebonden BYO-opslag geroteerd. Bij `managed` bepaalt het centrale
  platformprofiel provider/model/endpoint.
- `POST /api/admin/ai-instellingen/credential/rotate` met `{ "secret": "…" }`.
- `POST /api/admin/ai-instellingen/credential/revoke` trekt uitsluitend een
  tenantgebonden BYO-credential in en schakelt fail-closed uit. Een centraal
  platformcredential kan niet vanuit de tenant worden ingetrokken.
- `POST /api/admin/ai-instellingen/credential/clear` is een compatibele alias
  van revoke.
- `POST /api/admin/ai-instellingen/test` test alleen providerbereikbaarheid en
  stuurt geen procescontext.

Rotate, revoke/clear en connectietest schrijven een audit-event zonder secret
of provider-responsebody. Providerfouten worden als generieke, veilige
API-fouten teruggegeven.

## Lokale ChatGPT OAuth in de zelfstandige editie

De ChatGPT/Codex-OAuth-flow is een eersteklas productmodus voor de lokale,
zelfstandige single-tenant editie. Beschikbaarheid volgt uit de runtimegrens
`AuthMode=local` en `Online=false`, niet uit
`ASPNETCORE_ENVIRONMENT=Development`. Browser en backend moeten op dezelfde
computer draaien, omdat de browserlogin terugkeert naar de lokale callback
`http://localhost:1455`.

Per installatie bestaat één koppeling. De tokens worden als door ASP.NET Core
Data Protection beschermde inhoud opgeslagen in
`App_Data/chatgpt-oauth.json`; de bijbehorende keyring staat in
`App_Data/data-protection-keys`. Beide horen bij dezelfde beveiligde
back-up-/herstelgrens. Een eventueel bestaand plaintext tokenbestand wordt
uitsluitend binnen deze toegestane lokale runtime eenmalig naar de beschermde
vorm gemigreerd.

Deze OAuth-flow authenticeert Codex via een ChatGPT/Codex-abonnement. Het is
geen algemene OAuth-methode voor de publieke OpenAI API.

Een centrale, online of multi-tenant runtime stelt deze lokale capability
fail-closed niet beschikbaar. Zo'n omgeving gebruikt `managed` of `byo` en mag
nooit één globale lokale ChatGPT-sessie tussen tenants delen. Een toekomstige
ChatGPT-koppeling voor SaaS vereist een ondersteunde server-callback,
tenantgebonden tokenopslag en tenantgebonden autorisatie/audit.

## Regressiegates

```bash
./.tools/dotnet/dotnet build \
  backend/src/ServiceProcesgids.Api/ServiceProcesgids.Api.csproj \
  --no-restore -p:NuGetAudit=false

./.tools/dotnet/dotnet run \
  --project backend/tests/Configuration.SelfTest/Configuration.SelfTest.csproj \
  --no-restore -p:NuGetAudit=false
```

De selftest controleert runtimecombinaties, demo- en bootstrapgates, de
local/offline-toelating en online/multi-tenantblokkade van ChatGPT/Codex-OAuth,
versleutelde OAuth- en BYO-opslag, schema-v1-migratie, Managed AI-capability,
veilige revoke, auditbevestigingen en Azure-endpointvalidatie.
