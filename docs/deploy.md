# Service Procesgids — Deploy-handleiding

**Webproduct voor meerdere bedrijven:** de primaire hostingroute staat in
[`hosting/README.md`](../hosting/README.md). Deze levert geïsoleerde organisatiecontainers
met eigen data en sleutels achter Caddy/HTTPS. De onderstaande stappen zijn uitsluitend de
losse Windows-/standalone-editie.

De app is één pakket: een self-contained .NET-backend die ook de frontend serveert.
**Eindgebruikers hebben alleen een browser nodig; op de server hoeft niets vooraf geïnstalleerd te worden.**

## 1. Pakket bouwen

```powershell
# Vereist: .NET 10 SDK, Node/npm. Het script doet zelf npm ci en een schone frontendbuild.
.\backend\publish-windows.ps1            # → artifacts\service-procesgids-win-x64.zip
# Andere besturingssystemen: .\publish-windows.ps1 -Runtime linux-x64
# Eén enkel exe-bestand:      .\publish-windows.ps1 -SingleFile
```

> Zit de .NET SDK in `%LOCALAPPDATA%\Microsoft\dotnet`, zet die map dan vooraan in `PATH`
> (het publish-script vindt hem ook automatisch als `dotnet` niet in PATH staat).

## 2. Zelfstandig draaien (pilot / demo / kleine omgeving)

1. Pak de nieuwste `service-procesgids-win-x64*.zip` uit op de doelmachine.
2. Voer bij een nieuwe lokale installatie eenmalig `bootstrap-local-admin.ps1` uit. Het script
   vraagt tweemaal veilig om het initiële wachtwoord; er bestaat geen standaardwachtwoord.
3. Start `ServiceProcesgids.Api.exe` (optioneel: `set ASPNETCORE_URLS=http://localhost:5088`).
4. Open `http://localhost:5088` en log in als `Admin` met het zelfgekozen wachtwoord.

De bootstrap gebruikt uitsluitend tijdelijke procesvariabelen, migreert de SQLite-database en
stopt voordat de webserver start. Een normale start maakt nooit stil een beheerder aan. Zet het
wachtwoord niet in `appsettings.json`, een batchbestand, de serviceconfiguratie of de commandoregel.
Een bestaande database of gebruiker wordt bij een upgrade niet opnieuw gebootstrapt of gereset.

De standaardruntime is `standard/database` en seedt geen voorbeeldprocessen. De meegeleverde
fixtures zijn alleen actief wanneer alle drie expliciet zijn ingesteld:
`ASPNETCORE_ENVIRONMENT=Development`, `Runtime:Mode=demo` en
`Runtime:DataSource=demo-fixtures`. Demo is niet toegestaan in Production; een inconsistente
configuratie stopt de backend zonder fallback.

## 3. Als Windows-service (intranet)

Gebruik het meegeleverde script (als Administrator):

```powershell
cd backend
.\install-windows.ps1 -PackageDir ..\artifacts\service-procesgids-win-x64 -Port 5088
# Verwijderen: .\install-windows.ps1 -Uninstall
```

Het script kopieert het pakket naar `C:\Program Files\ServiceProcesgids`, registreert de
Windows-service **ServiceProcesgids** (automatisch starten, herstart bij falen) en opent de
firewall-poort. Een MSI/Inno-installer kan hier later omheen gebouwd worden; dit script is de
functionele kern daarvan.

## 4. Als IIS-site

1. Installeer de **.NET 10 Hosting Bundle** op de server (IIS heeft de ASP.NET Core-module nodig).
2. Maak een IIS-site/app-pool (No Managed Code) die wijst naar de uitgepakte pakketmap.
3. Het pakket bevat de frontend in `wwwroot`; verder geen configuratie nodig.

## 5. Configuratie (twee modi)

Alles staat in `appsettings.json` onder `ServiceProcesgids`, of als omgevingsvariabelen:

| Instelling | Waarden | Betekenis |
| --- | --- | --- |
| `ServiceProcesgids__AuthMode` | `local` / `entra` | Eigen inlog óf Microsoft Entra ID |
| `ServiceProcesgids__Storage` | `local` / `db` | SQLite-bestand óf centrale database |
| `ServiceProcesgids__Runtime__Mode` | `standard` / `demo` | Normale runtime óf expliciete Development-demo |
| `ServiceProcesgids__Runtime__DataSource` | `database` / `demo-fixtures` | Database óf fixtures in de expliciete demo |
| `ConnectionStrings__Sqlite` | connection string | SQLite (`Data Source=…`) |

### Gekoppelde modus (Entra ID / Active Directory)

1. Registreer een app in **Microsoft Entra ID** (SPA-redirect: `https://<host>/`).
2. Vul in: `ServiceProcesgids__Entra__TenantId`, `…__ClientId`/`…__Audience` en
   `…__GroupRoleMappings` (AD-groep → rol, bv. `SVC-Procesgids-Redacteuren` → `bewerken`).
3. Zet `AuthMode=entra`. On-prem AD-gebruikers loggen mee in via **Azure AD Connect**-sync.
4. De frontend toont dan automatisch de Microsoft-login (MSAL) op basis van `/api/config`.

### Online beschikbaar maken (optioneel)

- **Microsoft Entra Application Proxy**: publiceer de interne site met pre-authenticatie via Entra — geen poorten open op de firewall.
- **Azure App Service**: deploy het linux-x64/win-x64-pakket en zet dezelfde omgevingsvariabelen; verplicht SSO + MFA via Entra.

## 6. Productie-checklist

- [ ] Lokale first-runbootstrap uitgevoerd met een uniek wachtwoord en zonder blijvende bootstrapvariabelen (of Entra-modus actief).
- [ ] Runtime staat op `standard/database`; een eventuele demo draait uitsluitend geïsoleerd in Development.
- [ ] `Storage=db` met SQL Server + back-upbeleid voor productie.
- [ ] HTTPS via reverse proxy/IIS-binding (de app zelf serveert HTTP).
- [ ] AD-/Entra-groepen aangemaakt en gemapt op de vijf rollen.
- [ ] Bron-PDF's en exports vallen onder het reguliere back-upbeleid (zitten in de database).

## 7. Back-up & restore

**Automatisch (zelfstandige modus):** de app maakt bij het opstarten en daarna elke 24 uur een
consistente back-up van de SQLite-database (incl. processen, versies, audit-log en opgeslagen
PDF's/PNG's) in `App_Data/backups/`, met retentie van 14 bestanden. Instelbaar via
`ServiceProcesgids:Backup:{Enabled, IntervalHours, Retention}`.

**Volledig herstel:** gebruik de gestopte installatie-snapshot en restore naar een nieuwe map
zoals beschreven in [`backend/DEPLOY.md`](../backend/DEPLOY.md). Alleen een databasebestand
terugzetten herstelt niet alle instellingen/credentials. Voor Linux-hosting geldt de aparte
route in [`hosting/README.md`](../hosting/README.md).

**Belangrijk:** neem de hele `App_Data/`-map ook op in de reguliere server-/off-site-back-up;
een back-up naast de database beschermt niet tegen schijfuitval. In `db`-modus (SQL Server)
geldt het databaseback-upbeleid van de organisatie.

Zie [`iso-borging.md`](iso-borging.md) voor hoe dit en de overige functies bijdragen aan
ISO 27001/9001/14001-bewijslast.

## 8. AI-assistent en OpenAI-koppeling (optioneel)

De ingebouwde AI-assistent (🤖) beantwoordt vragen over de processen, doet verbetervoorstellen en
kan conceptprocessen voorstellen (als importeerbare JSON). Een beheerder configureert dit bij
**Instellingen & beheer → AI-koppeling**. Er zijn drie productieroutes:

- **Eigen providercredential (BYO):** de organisatie kiest provider, model en eventueel het
  officiële Azure-endpoint in de beheerpagina en registreert daar een write-only credential. De
  backend bewaart deze versleuteld met de persistente Data Protection-keyring.
- **Managed AI:** platformbeheer configureert centraal
  `ServiceProcesgids__Ai__Managed__Enabled=true`, `Provider`, `Model`, eventueel `Endpoint` en
  `ApiKey`. Deze modus oogt in de tenant pas beschikbaar wanneer het hele centrale profiel geldig
  is. De tenant kan het platformcredential niet bekijken, vervangen of intrekken.
- **Lokale ChatGPT OAuth — Inloggen met ChatGPT:** een zelfstandige lokale/single-tenant
  installatie kan een ChatGPT/Codex-abonnement koppelen via een browserlogin, zonder Platform
  API-sleutel. Deze route is alleen beschikbaar wanneer browser en backend op dezelfde computer
  draaien; zie de afbakening hieronder.

Injecteer de Managed AI-sleutel uitsluitend als platformsecret; zet hem niet in JSON, broncode of
een frontendvariabele. Gebruik voor een verkoopbare
multi-tenant SaaS een centrale secret manager met sleutels per tenant. OpenAI adviseert
API-sleutels in environment variables of een secret-managementservice te bewaren. **Azure
OpenAI** kan passend zijn in een Microsoft-omgeving; toets dataregio, retentie en
verwerkersafspraken altijd aan de eigen tenant en overeenkomst. De volledige procesinhoud gaat
momenteel als context mee met elke vraag, dus neem toestemming, dataclassificatie en logging mee
in het informatiebeveiligingsbeleid.

### Zelfstandige installatie: lokale ChatGPT OAuth

**Inloggen met ChatGPT** is de eersteklas lokale ChatGPT OAuth-modus voor de zelfstandige
lokale/single-tenant editie. De beheerder doorloopt een browserlogin en gebruikt daarna het gekoppelde
ChatGPT/Codex-abonnement zonder Platform API-sleutel. Het betreft de authenticatiestroom van
Codex; dit is nadrukkelijk géén algemene OAuth-vervanging voor authenticatie van de publieke
OpenAI API.

De implementatie heeft één globale koppeling per installatie, bewaart tokens versleuteld in
`App_Data/chatgpt-oauth.json`, gebruikt een vaste callback op `http://localhost:1455` en werkt
daarom alleen wanneer browser en backend op dezelfde computer draaien. Neem zowel het
tokenbestand als `App_Data/data-protection-keys` mee in beveiligde back-up/herstel; zonder de
bijbehorende keyring is het token niet bruikbaar.

De capability is niet gekoppeld aan de ASP.NET-omgeving, maar aan het installatietype: alleen een
expliciete lokale/offline, zelfstandige installatie mag deze globale sessie gebruiken. Een
centrale, online of multi-tenant SaaS mag nooit één lokale ChatGPT-sessie tussen tenants delen.
Daar gebruikt iedere tenant `Managed AI` of een eigen server-side providercredential. Een latere
ChatGPT-koppeling voor SaaS vereist een ondersteunde tenantgebonden server-callback,
tenantgebonden tokenopslag en volledige autorisatie- en auditgrenzen. Voor algemene OpenAI
API-aanroepen blijft de
[server-side API-authenticatie](https://developers.openai.com/api/docs/guides/production-best-practices#api-keys)
de productieroute.

## 9. Installatie voor bedrijven & eigen huisstijl

**Installeren in 3 stappen:** (1) pak `service-procesgids-win-x64.zip` uit, (2) dubbelklik
`installeer.bat` (vraagt zelf om beheerdersrechten en registreert de Windows-service incl.
firewall-regel; alleen bij een nieuwe database wordt tweemaal veilig om een beheerderswachtwoord
gevraagd), (3) open `http://localhost:5088` en log in als `Admin` met dat wachtwoord. Er is geen
standaardwachtwoord. Upgrades herkennen de bestaande database en laten accounts, wachtwoorden en
`App_Data/` (database, back-ups én alle instellingen) ongemoeid. Het publish-script weigert een
bouwdoel met App_Data en bouwt eerst in staging; gebruikte installaties worden niet als
bouwoutput overschreven. Uninstall bewaart de installatiebestanden en gegevens.

**Eigen huisstijl (white-label):** Beheer → 🎨 Huisstijl — bedrijfsnaam, app-naam, primaire en
accentkleur en een eigen logo (PNG/SVG/JPG). Direct actief voor iedereen, inclusief het
inlogscherm en de kiosk; opgeslagen in `App_Data/branding.json`.
