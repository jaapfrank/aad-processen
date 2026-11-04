# /contract — Gedeeld integratiecontract

Dit is de **enige bron van waarheid** voor de grens tussen frontend en backend. Beide kanten bouwen hiertegen. Contractwijzigingen worden geversioneerd en in dezelfde wijziging aan `/frontend`, `/backend` en `/contract` doorgevoerd.

> **Status: v1.15** — de oorspronkelijke Fase 0-freeze is opgeheven voor de
> SaaS-productisering. Contractwijzigingen blijven onderdeel van dezelfde wijziging
> aan frontend en backend.

## Inhoud

| Bestand | Wat |
| --- | --- |
| [`model.ts`](model.ts) | Datamodel (TypeScript) — **leidend**. De C#-DTO's spiegelen dit 1-op-1. |
| [`iso.ts`](iso.ts) | ISO-/borgingmodel voor ISO 27001, 9001 en 14001. |
| [`diagram.ts`](diagram.ts) | Canoniek diagrammodel voor draw.io-, Visio- en Lucidchart-uitwisseling. |
| [`ai-process-steward.ts`](ai-process-steward.ts) | Revisiegebonden contract voor AI-vragen, stapbevindingen, bronnen en veilige tekstwijzigingen. |
| [`ai-run-history.ts`](ai-run-history.ts) | Privacybewuste runhistorie en éénmalige feedback op AI-wijzigingsvoorstellen. |
| [`assurance.ts`](assurance.ts) | Organisatiebrede normscope, Normcoach en continue interne assurance. |
| [`assurance-framework-drafts.ts`](assurance-framework-drafts.ts) | Brongebonden high-level AI-concepten met apart publicatie-, afwijzings- en activeringsbesluit. |
| [`openapi.yaml`](openapi.yaml) | REST-API-contract (OpenAPI 3.1) met alle endpoints en schema's. |
| [`fixtures/service-aanvraagproces.json`](fixtures/service-aanvraagproces.json) | Volledige voorbeeld-fixture (beide secties) — gedeelde testdata. |
| [`examples/`](examples/) | Voorbeeldresponses: `config.json`, `me.json`, `processes.json`. |

## Vastgelegde basisbesluiten (oorspronkelijke Fase 0)

1. **Mapstructuur:** `/frontend` (Claude), `/backend` (Codex), `/contract` (gedeeld, Claude beheert), `/docs`.
2. **Datamodel vastgezet** voor: `Process`, `Lane`, `Section`, `Step`, `ImportJob`, `Suggestion`, `Version`, `User`, `Role` — zie `model.ts`.
3. **API-contract** vastgelegd in `openapi.yaml` (incl. voorbeeldresponses in `examples/`).
4. **Fixture** Service – Aanvraagproces beschikbaar als gedeelde testdata.
5. **Frontend-mock:** de frontend draait tegen **lokale JSON-fixtures** (de bestanden in `/contract`), optioneel via een mock-API-laag (bv. MSW). Geen backend nodig om de UI te ontwikkelen.
6. **Backend-opslag:** **SQLite** voor standalone/pilot (`storage=local`/bestand); later **SQL Server of PostgreSQL** voor productie (`storage=db`). Inwisselbaar via EF Core.
7. **Rechten worden ALTIJD backend-side afgedwongen.** De frontend verbergt/toont hooguit knoppen; de server is autoritatief (autorisatie per endpoint, validatie en procesgezondheid).
8. **Verpakking:** de **backend serveert uiteindelijk de frontend-build** als static files (SPA-fallback) → één pakket, eindgebruikers hebben alleen een browser nodig. Self-contained publish; later optioneel een Windows-installer.

## Twee modi (zie concept H7)

- `authMode`: `entra` (Entra ID/AD-SSO, rollen uit groepen) of `local` (eigen inlog, rollen in de app).
- `storage`: `db` (centrale database) of `local` (lokaal/bestand, zelfstandige modus).
- De frontend leest de actieve modi via `GET /api/config`; de backend stelt ze in via config.

## Hoe te gebruiken

- **Frontend (Claude):** genereer/typeer tegen `model.ts`; mock de endpoints met de bestanden in `examples/` en `fixtures/`. Toon nooit acties die de rol niet mag, maar vertrouw op de server voor handhaving.
- **Backend (Codex):** implementeer de paden uit `openapi.yaml`; laat de C#-DTO's exact `model.ts` spiegelen; seed met de Aanvraagproces-fixture; dwing rollen en validatie server-side af.

## Contract wijzigen

1. Stel de wijziging voor in `/contract` (model en/of openapi) met een korte motivatie.
2. **Beide** kanten (Claude én Codex) bevestigen vóórdat er verder gebouwd wordt.
3. Verhoog de versie in `openapi.yaml` (`info.version`) en noteer de wijziging hieronder.

### Wijzigingslog

- **v1.15 (2026-07-29):** veilige AI-intake voor uitbreidbare normenkaders
  toegevoegd. De backend haalt de officiële HTTPS-bron nooit op en stuurt
  uitsluitend een zelfgeschreven publieke samenvatting naar capability
  `assurance-framework-draft-v1`. Strikt gevalideerde concepten worden met
  input-/outputhash, provider en model opgeslagen; bron, rechten en de
  high-level dekkingsbeperking vereisen een expliciet publicatiebesluit.
  Publicatie activeert niets. Foute concepten kunnen revisiegebonden en
  auditbaar worden afgewezen.

- **v1.14 (2026-07-28):** selecteerbare normscope, evidencegedreven
  Normcoach en niet-uitzetbare continue interne assurance toegevoegd.
  Een organisatie kan de controlefrequentie aanscherpen maar niet verzwakken;
  readiness en bevindingen vormen geen certificeringsclaim.

- **v1.13 (2026-07-28):** privacybewuste, persistente AI-runhistorie toegevoegd
  via `GET /processes/{id}/ai/runs` en éénmalige, idempotente feedback via
  `POST /processes/{id}/ai/runs/{runId}/feedback`. De ledger bevat alleen
  runmetadata, provider/model indien bekend, hashes, timing, aantallen,
  foutcodes en beperkte feedback. Prompts, procesinhoud, antwoorden en ruwe
  modeluitvoer worden niet vastgelegd.

- **v1.12 (2026-07-28):** AI Process Steward toegevoegd via
  `POST /processes/{id}/ai/maintenance-analysis`. De analyse is aan één
  opgeslagen revisie gekoppeld, retourneert brongebonden vragen en bevindingen
  en mag uitsluitend acht tekstvelden als conceptwijziging voorstellen.
  Antwoorden op verduidelijkingsvragen gaan gestructureerd terug naar dezelfde
  analysegrens. Daarnaast meldt `RuntimeConfig.developmentLoginAvailable`
  uitsluitend de expliciete Debug/Development-testsessie zonder login.

- **v1.8 (2026-07-25):** optionele `Step.systeemGebeurtenissen` en
  `Step.interactieDoelLaneId` toegevoegd. Een hoofdactiviteit kan daarmee een
  horizontale activiteitsoverdracht én afzonderlijke systeemacties,
  synchronisaties en status-callouts bevatten. Dit voorkomt dat inhoud uit
  bronplaten als één vrije annotatie wordt samengevoegd en blijft
  backwards-compatible voor bestaande processen.

- **v1.7 (2026-07-24):** macro-vrije Visio VSDX-export toegevoegd via
  `POST /diagrams/visio/export`. De zelfstandige éénpagina-OPC-subset bevat
  lanes, secties, bewerkbare procesvormen, gelijmde connectors en SPG Shape
  Data; runtime-acceptatie in Visio desktop/web blijft expliciet vereist.

- **v1.6 (2026-07-24):** optionele, persistente `Process.diagramLayout` v1
  toegevoegd voor vrije nodeposities en visuele edge-routering in het
  `px96-y-down`-coördinatenstelsel. De processemantiek blijft uitsluitend in
  `Step.naarStap`, `Step.routes` en `Step.doelLaneId`.

- **v1.5 (2026-07-24):** canoniek diagrammodel, draw.io-uitwisseling,
  Lucid Standard Import-package, begrensde Visio-import en
  `diagram-import`-provenance toegevoegd. De toenmalige Visio-exportblokkade is
  in v1.7 vervangen door een zelfstandige macro-vrije OPC-export.

- **v1.4 (2026-07-23):** veilige scheiding tussen gepubliceerde processen
  (`/processes`) en actuele werkversies (`/workspace/processes`) toegevoegd;
  procesupdates vereisen de actuele `revision` en kunnen de publicatiestatus niet
  rechtstreeks wijzigen.

- **v1.3-aanvulling (2026-06-11):** `GET /api/audit` (rol beheren) + `AuditEntry`; ISO-signaal `review-nadert` (30 dagen vooruit, ernst info).

- **v1.3 (2026-06-11):** `AppConfig.entra` (publieke tenantId/clientId) toegevoegd zodat de frontend MSAL kan initialiseren in entra-modus; backend vult dit alleen bij `authMode=entra`.

- **v1.2 (2026-06-11):** Lokale beheer-API toegevoegd voor `authMode=local`: `/admin/users`, `/admin/users/{id}` en `/admin/users/{id}/password`, inclusief `LocalUser`-schema's en rol-eis `beheren`.
- **v1.1 (2026-06-10):** Codex contractreview verwerkt: consistente `local`-waarde, security-defaults, vertakkingen via `StepRoute`, import-voortgang/bronvelden, workflow-reject, gedeelde validatie-/diff-types en ISO-endpoints/schema's.
- **v1 (2026-06-09):** Eerste bevroren contract (Fase 0): datamodel, API, fixture, voorbeeldresponses.
