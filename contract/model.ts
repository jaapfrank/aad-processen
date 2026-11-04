/**
 * Service Procesgids — Gedeeld datamodel (BRON VAN WAARHEID)
 * --------------------------------------------------------------
 * Deze TypeScript-types zijn leidend. De C#-DTO's in /backend spiegelen
 * deze types 1-op-1. Wijzigingen lopen via dit bestand én worden tussen
 * Claude (frontend) en Codex (backend) afgestemd vóórdat er verder gebouwd
 * wordt (zie /contract/README.md — contract-freeze).
 *
 * Status: v1.13 — AI Process Steward met privacybewuste runhistorie.
 */

/* ----------------------------------------------------------------------------
 * Rollen & gebruikers
 * ------------------------------------------------------------------------- */

/** De vijf rechtenniveaus (zie concept H7). Oplopend in bevoegdheid. */
export type Role =
  | 'kijken'      // bekijken, zoeken, routes volgen, checklists
  | 'suggesties'  // suggesties indienen per stap
  | 'bewerken'    // stappen/processen aanmaken en wijzigen (concept)
  | 'goedkeuren'  // conceptversie controleren en live zetten
  | 'beheren';    // gebruikers, rechten, templates, archief

export interface User {
  id: string;
  naam: string;
  email?: string;
  /** Herkomst van het account. */
  bron: 'entra' | 'local' | 'development-bypass';
  /** Effectieve rollen, afgeleid uit AD/Entra-groepen of lokaal beheer. */
  rollen: Role[];
  /** AD/Entra-groepen (informatief, alleen in gekoppelde modus). */
  groepen?: string[];
}

/** Lokale beheerweergave voor authMode=local. */
export interface LocalUser {
  id: string;
  gebruikersnaam: string;
  naam: string;
  email?: string;
  rollen: Role[];
  actief: boolean;
  aangemaaktOp: string;
  gewijzigdOp?: string;
}

export interface LocalUserCreateRequest {
  gebruikersnaam: string;
  naam: string;
  email?: string;
  wachtwoord: string;
  rollen: Role[];
  actief?: boolean;
}

export interface LocalUserUpdateRequest {
  naam: string;
  email?: string;
  rollen: Role[];
  actief: boolean;
}

export interface LocalPasswordChangeRequest {
  wachtwoord: string;
}

/* ----------------------------------------------------------------------------
 * Proces, lanes, secties, stappen
 * ------------------------------------------------------------------------- */

/** Een kolom in de swimlane-plaat (een rol/afdeling). */
export interface Lane {
  id: string;
  naam: string;
  /** Hex-kleur voor de rol, bv. "#F59E0B". */
  kleur: string;
}

/** Een sub-flow binnen één proces (bv. "Website" vs "Intern medewerker"). */
export interface Section {
  id: string;
  naam: string;
}

/**
 * Stap-typen — bepalen hoe een stap op de plaat én in de tabel verschijnt.
 * - actie      : gewone activiteit in een lane
 * - bericht    : pijl van laneId naar doelLaneId
 * - beslissing : splitsing met "Indien ..." (voorwaarde)
 * - subproces  : SC-blok, klikbaar via naarProces
 * - start      : ingang van (een sectie van) het proces
 * - eind       : E-blok, meestal met naarProces naar het vervolgproces
 * - marker     : in-/uitgang (A/O/L/V/D)
 */
export type StepType =
  | 'actie'
  | 'bericht'
  | 'beslissing'
  | 'subproces'
  | 'start'
  | 'eind'
  | 'marker';

/** Uitgaande route vanuit een stap. Nodig voor beslisbomen en begeleide modus. */
export interface StepRoute {
  id: string;
  /** Label op de verbinding, bv. "Ja", "Nee", "Indien SK". */
  label: string;
  /** Voorwaarde die deze route activeert. */
  voorwaarde?: string;
  /** Volgende stap binnen hetzelfde proces. */
  naarStap?: string;
  /** Directe sprong naar een gekoppeld proces. */
  naarProces?: string;
  /** Fallback-route als geen andere route matcht. */
  standaard?: boolean;
}

/**
 * Een aanvullende systeemgebeurtenis die inhoudelijk bij een processtap hoort,
 * maar geen zelfstandig beslis- of overdrachtspunt in de hoofdflow is.
 *
 * Voorbeeld: na "Dient retouraanvraag in" maakt Website een RMA-nummer aan,
 * synchroniseert Website de gegevens naar ERP en krijgt ERP status "controle".
 * Door dit gestructureerd te bewaren kunnen diagrammen, exports én agents deze
 * gebeurtenissen afzonderlijk verwerken in plaats van ze samen te voegen tot
 * één vrije tekstannotatie.
 */
export type StepSystemEventType = 'actie' | 'synchronisatie' | 'status';

export interface StepSystemEvent {
  id: string;
  type: StepSystemEventType;
  /** Lane/systeem waarop de gebeurtenis begint of plaatsvindt. */
  laneId: string;
  /** Alleen bij een interactie tussen twee lanes/systemen. */
  doelLaneId?: string;
  /** Zichtbare, betekenisvolle activiteit of status-callout. */
  activiteit: string;
  /** Positie ten opzichte van de hoofdactiviteit; standaard "na". */
  positie?: 'voor' | 'na';
}

export interface Step {
  id: string;
  /** Weergavenummer: "1", "2", "SC", "E", "A", ... */
  nummer: string;
  /** Optionele sectie waartoe de stap hoort. */
  sectieId?: string;
  /** Lane/rol = Verantwoordelijke in de tabel. */
  laneId: string;
  type: StepType;
  /** Hoofdtekst = "Activiteit" in de tabel. */
  activiteit: string;
  /** Blauwe toelichting op de plaat. */
  toelichting?: string;
  /** "Opmerking" in de werkinstructie-tabel. */
  opmerking?: string;
  /** Zij-notitie rechts op de plaat, bv. "ERP RMA status 'controle'". */
  zijnotitie?: string;
  /** Ontvanger voor type 'bericht' (de pijl wijst hierheen). */
  doelLaneId?: string;
  /**
   * Tweede lane die een gewone activiteit raakt of ontvangt, zonder dat de
   * activiteit semantisch een bericht is. In bronplaten wordt dit als een
   * horizontale activiteitslijn zonder berichtpijl weergegeven.
   */
  interactieDoelLaneId?: string;
  /** "Indien ..."-voorwaarde; stuurt de begeleide modus. */
  voorwaarde?: string;
  /** Gestructureerde ERP-status (optioneel, naast zijnotitie). */
  erpStatus?: string;
  /** Termijn, bv. "< 6 dagen na levering". */
  termijn?: string;
  /** Waarschuwing die zichtbaar moet zijn. */
  waarschuwing?: string;
  /** Afvinkbare checklistpunten. */
  checklist?: string[];
  /** Foto-eisen, bv. bij monitoren of fysieke schade. */
  fotoEisen?: string[];
  /** Volgende stap binnen hetzelfde proces. */
  naarStap?: string;
  /** Meerdere mogelijke vervolgroutes, vooral voor type 'beslissing'. */
  routes?: StepRoute[];
  /** Gekoppeld proces (bij subproces/eind). */
  naarProces?: string;
  /** Zekerheid 0..1 als dit veld uit PDF-import komt. */
  bronZekerheid?: number;
  /**
   * Aanvullende, geordende systeemactiviteiten/statussen bij deze stap.
   * De arrayvolgorde is de uitvoer-/weergavevolgorde binnen dezelfde stap.
   */
  systeemGebeurtenissen?: StepSystemEvent[];
}

export type ProcessStatus = 'concept' | 'in-review' | 'live' | 'gearchiveerd';

/** Herkomst van een proces. */
export interface ProcessSource {
  type: 'handmatig' | 'pdf-import' | 'diagram-import' | 'visio-import' | 'tabel-import' | 'kopie';
  bestand?: string;
  paginas?: number[];
  /** ISO-datum. */
  importDatum?: string;
  /** Gemiddelde importzekerheid 0..1. */
  importZekerheid?: number;
}

/** Punt in het canonieke diagramcoördinatenstelsel (CSS-pixels bij 96 DPI). */
export interface ProcessDiagramPoint {
  x: number;
  y: number;
}

/** Vrije positie en optionele afmetingen van een semantisch diagramelement. */
export interface ProcessNodePlacement extends ProcessDiagramPoint {
  width?: number;
  height?: number;
}

/** Alleen visuele routering; de semantische verbinding blijft in Step staan. */
export interface ProcessEdgePlacement {
  waypoints?: ProcessDiagramPoint[];
  sourcePort?: string;
  targetPort?: string;
  labelPosition?: ProcessDiagramPoint;
}

/** Persistente, leverancier-onafhankelijke vrije layout van één proces. */
export interface ProcessDiagramLayout {
  version: 1;
  coordinateSystem: 'px96-y-down';
  /** Namespaced ids, bv. step:s1, lane:service en section:hoofd. */
  nodes: Record<string, ProcessNodePlacement>;
  /** Stabiele ids, bv. transition:s1, route:s1:ja en message:s2. */
  edges?: Record<string, ProcessEdgePlacement>;
}

export interface Process {
  id: string;
  hoofdproces: string;
  detailproces: string;
  /** Bv. "V1.1". */
  versie: string;
  status: ProcessStatus;
  /** ISO-datum van laatste wijziging. */
  laatsteWijziging: string;
  /** Optimistic concurrency/revisie voor updates. */
  revision?: number;
  bron?: ProcessSource;
  lanes: Lane[];
  secties: Section[];
  stappen: Step[];
  /** Ontbrekend betekent: gebruik de deterministische automatische layout. */
  diagramLayout?: ProcessDiagramLayout;
}

/** Compacte weergave voor lijsten en de atlas. */
export interface ProcessSummary {
  id: string;
  hoofdproces: string;
  detailproces: string;
  versie: string;
  status: ProcessStatus;
  laatsteWijziging: string;
  revision?: number;
  aantalStappen: number;
  /** Proces-ids waarnaar dit proces koppelt (uit stap.naarProces). */
  koppelingen: string[];
}

/* ----------------------------------------------------------------------------
 * Versiebeheer
 * ------------------------------------------------------------------------- */

export interface Version {
  /** Oplopend versienummer binnen een proces. */
  versieNr: number;
  procesId: string;
  status: ProcessStatus;
  /** Gebruiker (id of naam) die de wijziging deed. */
  gewijzigdDoor: string;
  /** ISO-datumtijd. */
  gewijzigdOp: string;
  opmerking?: string;
  /** Suggestie-ids die in deze versie zijn verwerkt. */
  verwerkteSuggesties?: string[];
}

/* ----------------------------------------------------------------------------
 * Suggesties (de "Suggesties doen"-laag)
 * ------------------------------------------------------------------------- */

export type SuggestionType = 'klopt-niet' | 'mist' | 'onduidelijk' | 'werkt-anders';
export type SuggestionStatus = 'open' | 'in-behandeling' | 'verwerkt' | 'afgewezen';

export interface Suggestion {
  id: string;
  procesId: string;
  /** Optioneel: de specifieke stap waarover de suggestie gaat. */
  stapId?: string;
  type: SuggestionType;
  tekst: string;
  /** Gebruiker (id of naam) die de suggestie deed. */
  doorGebruiker: string;
  /** ISO-datumtijd. */
  aangemaaktOp: string;
  status: SuggestionStatus;
}

/* ----------------------------------------------------------------------------
 * PDF-import
 * ------------------------------------------------------------------------- */

export type ImportJobStatus = 'wachtrij' | 'verwerken' | 'gereed' | 'mislukt';

/** Zekerheid per herkend veld (pad → 0..1). */
export interface ImportFieldConfidence {
  /** Veldpad, bv. "stappen[2].activiteit". */
  veld: string;
  zekerheid: number;
  /** PDF-pagina waar de herkenning vandaan kwam. */
  pagina?: number;
  /** Herkende brontekst, handig in de review. */
  bronTekst?: string;
  /** Waarom de score laag/hoog is. */
  opmerking?: string;
}

export interface ImportJob {
  id: string;
  bestandsnaam: string;
  status: ImportJobStatus;
  /** ISO-datumtijd. */
  aangemaaktOp: string;
  /** Voortgang 0..100. */
  voortgang?: number;
  /** Id van het opgeslagen bronbestand. */
  bronBestandId?: string;
  /** Herkende kaart als conceptproces (status 'concept'). */
  conceptProces?: Process;
  /** Per-veld zekerheidsscores voor het review-scherm. */
  zekerheid?: ImportFieldConfidence[];
  /** URL's naar gerenderde pagina-afbeeldingen (PDF links in de review). */
  paginaAfbeeldingen?: string[];
  /** Foutmelding indien status 'mislukt'. */
  fout?: string;
}

/* ----------------------------------------------------------------------------
 * Config & sessie
 * ------------------------------------------------------------------------- */

/** Publieke Entra-gegevens voor de frontend-MSAL-login (contract v1.3). */
export interface EntraPublicConfig {
  tenantId: string;
  clientId: string;
}

/** Niet-gevoelige runtime-identiteit uit de backend. */
export interface RuntimePublicConfig {
  environment: string;
  profile: 'r0';
  tenantType: 'single-tenant';
  mode: 'standard' | 'demo';
  dataSource: 'database' | 'demo-fixtures';
  isDemo: boolean;
  syntheticData: boolean;
  fallbackUsed: false;
  /** Alleen true voor de expliciete, loopback-only ontwikkelsessie. */
  developmentLoginAvailable: boolean;
}

/** Antwoord van GET /api/config — bepaalt het gedrag van de frontend. */
export interface AppConfig {
  /** Identiteitsmodus. */
  authMode: 'entra' | 'local';
  /** Opslagmodus. */
  storage: 'db' | 'local';
  /** Of de app extern/online bereikbaar is. */
  online: boolean;
  /** App-versie. */
  versie: string;
  /** Alleen gevuld in entra-modus: publieke MSAL-configuratie. */
  entra?: EntraPublicConfig;
  /** Eerlijke runtime-identiteit; bevat nooit secrets. */
  runtime?: RuntimePublicConfig;
}

/** Antwoord van GET /api/me. */
export interface MeResponse {
  user: User;
}

/** Audit-logregel (GET /api/audit, rol beheren) — contract v1.3. */
export interface AuditEntry {
  id: number;
  actie: string;
  entiteitType: string;
  entiteitId: string;
  doorGebruiker: string;
  /** ISO-datumtijd. */
  op: string;
  details?: string | null;
}

/* ----------------------------------------------------------------------------
 * Validatie, diff & fouten
 * ------------------------------------------------------------------------- */

export interface ApiError {
  code: string;
  bericht: string;
}

export type HealthIssueType =
  | 'geen-verantwoordelijke'
  | 'geen-vervolg'
  | 'voorwaarde-zonder-route'
  | 'ontbrekende-erp-status'
  | 'termijn-zonder-waarschuwing'
  | 'vervolgproces-bestaat-niet';

export interface HealthIssue {
  /** Optioneel: sommige issues gelden voor het hele proces. */
  stapId?: string;
  soort: HealthIssueType;
  ernst: 'info' | 'waarschuwing' | 'fout';
  bericht: string;
}

export interface HealthReport {
  score: number;
  issues: HealthIssue[];
}

export type DiffChangeType = 'toegevoegd' | 'verwijderd' | 'gewijzigd';

export interface DiffChange {
  /** Optioneel bij proces-/lane-/sectiewijzigingen. */
  stapId?: string;
  soort: DiffChangeType;
  veld?: string;
  oud?: unknown;
  nieuw?: unknown;
}

export interface DiffReport {
  procesId: string;
  van: number;
  naar: number;
  wijzigingen: DiffChange[];
}
