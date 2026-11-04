/**
 * Service Procesgids — ISO-module (audit & borging)
 * --------------------------------------------------------------
 * Maakt de processen bruikbaar voor ISO 27001 (informatiebeveiliging),
 * ISO 9001 (kwaliteit) en ISO 14001 (milieu): koppeling van processen aan
 * normen/clausules, eigenaarschap en reviewritme, plus een gegenereerd
 * ISO-schema + auditmatrix en borging-signalen.
 *
 * BEWUST ONTKOPPELD van model.ts: alles verwijst naar processen via
 * `procesId`, zodat de `Process`-interface niet hoeft te wijzigen.
 *
 * Bijbehorende endpoints (zie openapi.yaml):
 *   GET  /api/iso/overview?norm=iso27001        -> IsoOverview
 *   PUT  /api/processes/{id}/iso                 -> IsoProcessConfig (rol 'bewerken')
 *   POST /api/processes/{id}/audit/start          -> AuditBeoordelingStart
 *   POST /api/processes/{id}/audit/confirmations  -> AuditBevestiging
 *   GET  /api/iso/export?norm=iso9001&format=csv -> auditbestand (bewijslast)
 *
 * Status: v1.2 — servergestempelde menselijke beoordeling toegevoegd.
 */

import type { ProcessStatus } from './model';

/** Normen die de organisatie borgt. */
export type IsoNorm = 'iso27001' | 'iso9001' | 'iso14001';

/** Rol van een proces binnen een norm. */
export type IsoProcesRol = 'kern' | 'ondersteunend';

/** Koppeling van één proces aan één ISO-norm. */
export interface IsoMapping {
  norm: IsoNorm;
  /** Relevante clausules/controls, bv. ["A.8.13", "7.5.3"]. */
  clausules?: string[];
  /** Is dit proces kern of ondersteunend voor de norm. */
  rol: IsoProcesRol;
  toelichting?: string;
}

/**
 * Borging-/governancegegevens per proces (eigenaar + reviewritme).
 * Algemeen bruikbaar, maar essentieel voor het bewijs van borging.
 */
export interface ProcessGovernance {
  /** Proceseigenaar, verantwoordelijk voor actualiteit. */
  eigenaar?: string;
  /** Herzieningsinterval, bv. "12m" of "P1Y". */
  herzieningsinterval?: string;
  /** ISO-datum laatste review. */
  laatsteReview?: string;
  /** ISO-datum volgende geplande review. */
  volgendeReview?: string;
}

/** Uitkomst van een menselijke triage; dit is geen certificeringsbesluit. */
export type AuditBevestigingUitkomst =
  | 'voldoet'
  | 'actie-nodig'
  | 'niet-van-toepassing';

/** Server-gestempelde beoordeling van één handmatige kadercontrole. */
export interface AuditBevestiging {
  assessmentId: string;
  catalogVersion: string;
  kaderId: string;
  controleId: string;
  uitkomst: AuditBevestigingUitkomst;
  toelichting: string;
  bewijsreferentie?: string;
  bevestigdDoorId: string;
  bevestigdDoor: string;
  bevestigdOp: string;
  /** Bevestiging geldt uitsluitend voor deze procesrevisie. */
  processRevision: number;
}

export interface AuditBeoordelingStart {
  assessmentId: string;
  procesId: string;
  kaderId: string;
  gestartDoorId: string;
  gestartDoor: string;
  gestartOp: string;
  verlooptOp: string;
  processRevision: number;
  catalogVersion: string;
}

export interface AuditBevestigingRequest {
  assessmentId: string;
  expectedRevision: number;
  kaderId: string;
  controleId: string;
  uitkomst: AuditBevestigingUitkomst;
  toelichting: string;
  bewijsreferentie?: string;
}

/** ISO/borging-configuratie van één proces (PUT /api/processes/{id}/iso). */
export interface IsoProcessConfig {
  procesId: string;
  mappings: IsoMapping[];
  governance?: ProcessGovernance;
  /** Alleen via de gerichte auditbevestigingsroute te wijzigen. */
  auditBevestigingen?: AuditBevestiging[];
}

/** Soorten borging-signalen die een certificering in gevaar brengen. */
export type BorgingSignaal =
  | 'geen-eigenaar'
  | 'review-verlopen'
  | 'geen-live-versie'
  | 'clausule-niet-gedekt';

export interface BorgingIssue {
  procesId: string;
  /** Norm waarop het signaal betrekking heeft (leeg = procesbreed). */
  norm?: IsoNorm;
  signaal: BorgingSignaal;
  ernst: 'info' | 'waarschuwing' | 'fout';
  bericht: string;
}

/** Eén rij in de ISO-auditmatrix (proces × norm). */
export interface IsoMatrixRow {
  procesId: string;
  hoofdproces: string;
  detailproces: string;
  norm: IsoNorm;
  rol: IsoProcesRol;
  clausules: string[];
  eigenaar?: string;
  status: ProcessStatus;
  laatsteReview?: string;
  volgendeReview?: string;
  /** Borging-signalen specifiek voor deze proces/norm-combinatie. */
  borging: BorgingIssue[];
}

/**
 * Antwoord van GET /api/iso/overview.
 * Levert zowel het ISO-SCHEMA (welke hoofdprocessen horen bij de norm) als
 * de ISO-TABEL (rijen) en de borging-signalen voor behoud/onderhoud.
 */
export interface IsoOverview {
  /** Gefilterd op één norm, of leeg voor alle normen samen. */
  norm?: IsoNorm;
  /** Hoofdprocessen die nodig zijn voor de norm — basis voor het schema. */
  hoofdprocessen: string[];
  /** De auditmatrix (tabel). */
  rijen: IsoMatrixRow[];
  /** Alle borging-signalen binnen de scope. */
  signalen: BorgingIssue[];
  /** ISO-datumtijd van generatie. */
  gegenereerdOp: string;
}

/** Mensvriendelijke labels voor de normen (UI). */
export const ISO_LABELS: Record<IsoNorm, string> = {
  iso27001: 'ISO 27001 — Informatiebeveiliging',
  iso9001: 'ISO 9001 — Kwaliteit',
  iso14001: 'ISO 14001 — Milieu',
};
