# Service Procesgids — Handleiding

*Voor wie de gids installeert en gebruikt. Kort en praktisch; details staan in `docs/`.*

---

## 1. Aan de praat krijgen

### Even snel proberen (geen installatie)
1. Pak `service-procesgids-win-x64.zip` uit (bijv. in Documenten).
2. Dubbelklik **`proberen-zonder-installatie.bat`**. Alleen bij de eerste start kies en bevestig
   je veilig een eigen beheerderswachtwoord; er bestaat geen standaardwachtwoord. Daarna opent de
   browser vanzelf op `http://localhost:5088`.
3. Log in als **Admin** met het zojuist gekozen wachtwoord.
4. Stoppen = het zwarte venster sluiten.

> Krijg je een blauwe SmartScreen-melding? Klik *Meer informatie* → *Toch uitvoeren*
> (het pakket is niet digitaal ondertekend).

### Vast installeren (voor een afdeling of bedrijf)
1. Pak de zip uit op de computer/server die altijd aanstaat, bijv. in `C:\ServiceProcesgids`.
2. Dubbelklik **`installeer.bat`** en sta beheerdersrechten toe. Dit registreert een
   Windows-service (start automatisch mee met Windows) en opent de firewall-poort. Bij een nieuwe
   database kies en bevestig je tijdens de installatie een eigen beheerderswachtwoord.
3. Collega's openen in hun browser: **`http://<computernaam>:5088`**
   (de computernaam vind je via ⊞ Win → "pc-naam"). Zij hoeven **niets** te installeren.
4. **Direct doen na installatie:**
   - Accounts aanmaken voor collega's (of AD/Entra koppelen, zie §4).
   - Eventueel de huisstijl instellen: *Beheer → 🎨 Huisstijl*.

### Bijwerken naar een nieuwe versie
Nieuwe zip uitpakken over de oude map heen — de map `App_Data` (database, back-ups en
alle instellingen) blijft staan. Draait de service? Eerst stoppen
(`services.msc` → Service Procesgids → Stoppen), bestanden vervangen, weer starten.

---

## 2. Dagelijks gebruik (alle medewerkers)

| Ik wil… | Zo doe je dat |
| --- | --- |
| Weten wat ik moet doen met een retour | **▶️ Begeleide modus** → beantwoord de vragen → volg het pad stap voor stap. Aan het einde krijg je een overdrachtstekst voor ticket/mail. |
| Een proces bekijken | **Overzicht** → klik een proces. Schakel tussen 🗺️ *Plaat* en 📋 *Tabel*; klik een stap voor de details. |
| Iets zoeken (RMA, WKOA, courantheid, …) | **🔍 Zoeken** — of stel de vraag aan de **🤖 AI-assistent** in gewone taal. |
| Melden dat iets niet klopt | Open de stap → **💬 Suggestie bij deze stap**. De beheerder ziet je melding en jij verdient er punten mee. |
| De hele keten zien | **🧭 Atlas** — alle processen met hun onderlinge koppelingen. |
| Een proces printen | Open het proces → **🖨️ Print**. |
| Mijn punten en badges zien | **🏅 Mijn voortgang** (punten zijn persoonlijk; er is geen ranglijst). |

## 3. Voor redacteuren en beheerders

- **Proces maken/wijzigen**: **🏗️ Procesbouwer** (met 💡 Hulp-knop bovenin). Wijzigingen worden
  een *concept*; via **📤 Indienen** → **✅ Goedkeuren** gaat een versie live. Niets gaat live
  zonder akkoord.
- **PDF importeren**: **📄 PDF-import** → uploaden → herkende stappen controleren (zekerheid per
  stap, originele pagina's ernaast) → vastleggen als concept.
- **AI laten helpen**: vraag de 🤖 AI-assistent om een conceptproces — bij een bruikbaar voorstel
  verschijnt **🏗️ Controleer in procesbouwer**; daarna gewoon indienen + goedkeuren.
- **Dashboard**: 📊 — werkvoorraad, statussen en borging-signalen in één blik.
- **ISO & audit**: 🛡️ — processen koppelen aan ISO 27001/9001/14001 en de auditmatrix exporteren.
- **Beheer-tabs**: 💬 Suggesties · 👥 Gebruikers · 📜 Audit-log · 🤖 AI · 💾 Back-ups ·
  🔐 AD/Entra · 🔗 Business Central · 🔔 Meldingen · 🎨 Huisstijl.

## 4. Koppelingen (allemaal optioneel, via Beheer)

| Koppeling | Wat het oplevert | Wat je nodig hebt |
| --- | --- | --- |
| 🤖 AI | Vragen, verbetervoorstellen, conceptprocessen | Server-side providercredential voor OpenAI, Azure OpenAI of Anthropic; de lokale ChatGPT-koppeling is alleen een expliciete Development-proef |
| 🔐 AD/Entra | Inloggen met Microsoft-account; rollen uit AD-groepen (meerdere groepen per rol: komma's) | Tenant-ID + app-registratie van IT; herstart na opslaan |
| 🔗 Business Central | Order/credit opzoeken bij RMA-nummer | App-registratie + BC-machtiging (zie docs/koppelingen.md) |
| 🔔 Meldingen | Teams/Slack-bericht én e-mail naar beheerders bij suggesties/indienen/goedkeuren | Webhook-URL en/of SMTP-gegevens (bv. smtp.office365.com:587) |
| 💾 Back-ups | Automatisch volgens schema + kopie naar netwerkpad of OneDrive-map | Pad invullen; OneDrive = map binnen je lokale OneDrive-synchronisatiemap |

## 5. Problemen oplossen

- **Pagina laadt niet** → draait de service? `services.msc` → *Service Procesgids* → Starten.
- **Collega's kunnen er niet bij** → gebruik `http://<computernaam>:5088` (niet "localhost") en
  controleer of `installeer.bat` is gebruikt (die zet de firewall-regel).
- **Wachtwoord kwijt** → een andere beheerder reset het via Beheer → Gebruikers. Is er geen
  bereikbare beheerder meer, herstel dan een gecontroleerde back-up of volg de
  beheerdersherstelprocedure; verwijder de productiedatabase niet. De first-runbootstrap reset
  bewust geen bestaand account.
- **Iets anders kapot?** → Beheer → 📜 Audit-log laat zien wat er recent is gebeurd;
  `App_Data/backups/` bevat dagelijkse herstelpunten (restore: zie docs/deploy.md §7).
