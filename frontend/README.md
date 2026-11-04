# /frontend — Service Procesgids (React)

**Stack:** Vite · React · TypeScript · React Flow · Zustand · Node.js 24.

Actuele product- en hostinginformatie staat in de [hoofdhandleiding](../README.md). Fixtures zijn uitsluitend testdata.

De frontend gebruikt het gedeelde contract in [`/contract`](../contract/) als bron van waarheid
(types via de `@contract`-alias; fixtures als voorbeelddata). De normale ontwikkel- en
productieomgeving gebruikt altijd de echte backend.

## Starten

Start eerst de backend vanuit de projectroot:

```bash
dotnet run --project backend/src/ServiceProcesgids.Api/ServiceProcesgids.Api.csproj
```

Start daarna de frontend:

```bash
cd frontend
npm ci
npm run dev
```

De Vite-dev-server proxyt `/api` naar `http://localhost:5088`.

### Expliciete demosandbox

Alleen voor demonstraties en visuele tests kan de frontend los van de backend
met synthetische voorbeelddata worden gestart:

```bash
npm run dev:demo
```

Deze demosandbox is geen beheerinstelling en deelt geen data met een echte organisatie.
De voorbeeldgebruiker heeft geen rol `beheren`; externe koppelingen zoals OpenAI/ChatGPT
zijn er daarom uitgeschakeld. Configureer zulke koppelingen in de normale app als beheerder
via `/beheer?tab=ai`.

## Bouwen

```bash
npm run build    # tsc -b && vite build  → dist/
```

De productie-build (`dist/`) wordt door de backend als static files geserveerd
(zie [/backend](../backend/)), zodat eindgebruikers alleen een browser nodig hebben.

## Belangrijke schermen

| Pagina | Wat |
| --- | --- |
| **Overzicht** (`/`) | Alle processen uit de organisatieomgeving als kaarten; in de expliciete demosandbox worden synthetische voorbeelden getoond. |
| **Procesdetail** (`/proces/:id`) | Schakel **🗺️ Plaat** (swimlane, React Flow) ↔ **📋 Tabel** (werkinstructie); klikbare stappen → detailpaneel met suggestieknop; **rolfilter** dimt andermans stappen; subproces-links navigeren door. |
| **Atlas** (`/atlas`) | De hele keten als klikbare graaf (koppelingen = pijlen). |
| **Zoeken** (`/zoeken`) | Vrij zoeken door procesnamen en stapvelden. |
| **Begeleide modus** (`/begeleid`) | Gepubliceerde processen met echte beslisroutes, verplichte controles en persoonlijke sessievoortgang. |
| **Procesmanager** (`/dashboard`) | Reviews, concepten, feedback en borgingssignalen met zichtbare laadfouten. |
| **Import/export** (`/uitwisseling`) | Visio eerst: paginakeuze en rolcontrole, review en overdracht naar de editor. Andere formaten blijven beschikbaar. |
| **AI-procesontwerp** (`/ai-diagram`) | Procesinformatie uit tekst herkennen, aanvullen, controleren en als concept bewerken. |
| **Procesbouwer** (`/bouwer[/:id]`) | Nieuwe kaarten maken of bestaande bewerken: lanes/secties/stappen-editor, 🔗 auto-schakelen, **live previews** (plaat + tabel), **gezondheidscore**, kopie-van-bestaand en opslag via de gekozen databron. |
| **ISO & audit** (`/iso`) | Norm-keuze (27001/9001/14001), auditmatrix en borging-signalen. |

Architectuur: contract-types via de `@contract`-alias ([`src/contract.ts`](src/contract.ts)); databron-abstractie
in [`src/data.ts`](src/data.ts) (mock ↔ API); app-state in [`src/appState.ts`](src/appState.ts);
lokale opslag (concepten/suggesties) via zustand-persist in [`src/store/`](src/store/).

Login, versie/diff, importreview en de proceseditor zijn geïmplementeerd. Eerdere milestone-
documenten zijn geen actuele opleverstatus. `npm run selftest:product` voert de gerichte
productlogica-tests uit; `npm run e2e:product` controleert de gebruikersflows met Edge en
synthetische API-antwoorden. Gebruik `npm run build` en `npm run lint` voor compile-/lintcontrole.
