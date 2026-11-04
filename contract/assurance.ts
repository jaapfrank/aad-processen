/**
 * Organisatiebrede assurancecontracten.
 *
 * Een readiness-uitkomst ondersteunt interne assurance. Zij is geen
 * certificering, normclaim of zelfstandig oordeel over control-effectiviteit.
 */

export type AssuranceQuestionnaireOutcome =
  | 'ja'
  | 'deels'
  | 'nee'
  | 'onbekend'
  | 'nvt';

export interface AssuranceFrameworkQuestion {
  id: string;
  titel: string;
  vraag: string;
  bewijsHint: string;
}

export interface AssuranceFramework {
  id: string;
  naam: string;
  editie: string;
  domein: string;
  type: string;
  bronUrl: string;
  bronOrganisatie: string;
  bronGecontroleerdOp: string;
  actief: boolean;
  vragen: AssuranceFrameworkQuestion[];
}

export interface AssuranceFrameworkCatalog {
  catalogVersion: string;
  kaders: AssuranceFramework[];
}

export interface AssuranceSettingsUpdate {
  expectedRevision: number;
  actieveKaderIds: string[];
  aangevraagdIntervalUren: number;
}

export interface AssuranceSettings {
  actieveKaderIds: string[];
  aangevraagdIntervalUren: number;
  effectiefIntervalUren: number;
  maximaalIntervalUren: number;
  toegestaneIntervalUren: number[];
  monitoringActief: boolean;
  volgendeRunOp: string;
  bijgewerktOp: string;
  bijgewerktDoor: string;
  revision: number;
}

export interface AssuranceQuestionnaireAnswerRequest {
  expectedRevision: number;
  vraagId: string;
  uitkomst: AssuranceQuestionnaireOutcome;
  bewijsreferentie?: string;
  motivatie?: string;
}

export interface AssuranceQuestionnaireAnswer {
  vraagId: string;
  uitkomst: AssuranceQuestionnaireOutcome;
  bewijsreferentie?: string | null;
  motivatie?: string | null;
  beantwoordDoor: string;
  beantwoordOp: string;
}

export interface AssuranceReadiness {
  beantwoord: number;
  totaal: number;
  ja: number;
  deels: number;
  nee: number;
  onbekend: number;
  nvt: number;
  bewijsGereed: number;
  open: number;
  disclaimer: string;
}

export interface AssuranceQuestionnaire {
  sessionId: string;
  kaderId: string;
  kaderNaam: string;
  catalogVersion: string;
  status: 'open' | 'gereed';
  gestartDoor: string;
  gestartOp: string;
  afgerondOp?: string | null;
  revision: number;
  vragen: AssuranceFrameworkQuestion[];
  antwoorden: AssuranceQuestionnaireAnswer[];
  readiness: AssuranceReadiness;
}

export interface AssuranceFinding {
  id: string;
  kaderId?: string | null;
  procesId?: string | null;
  vraagId?: string | null;
  type: string;
  ernst: string;
  titel: string;
  bericht: string;
}

export interface AssuranceRun {
  runId: string;
  trigger: string;
  status: string;
  catalogVersion: string;
  kaderIds: string[];
  gestartDoor: string;
  gestartOp: string;
  afgerondOp?: string | null;
  findingCount: number;
  foutcode?: string | null;
  bevindingen: AssuranceFinding[];
}

export interface AssuranceMonitoringStatus {
  monitoringActief: boolean;
  achterstallig: boolean;
  volgendeRunOp: string;
  effectiefIntervalUren: number;
  actieveKaderIds: string[];
  laatsteRun?: AssuranceRun | null;
  gegenereerdOp: string;
}
