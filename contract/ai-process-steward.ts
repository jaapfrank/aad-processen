/**
 * Gedeeld contract voor de AI Process Steward.
 *
 * De backend analyseert één opgeslagen procesrevisie. De response kan vragen,
 * bevindingen en uitsluitend tekstwijzigingen bevatten. De AI wijzigt nooit
 * zelfstandig processtructuur, diagramLayout of lifecyclestatus.
 */

export type ProcessMaintenanceStatus = 'vragen' | 'voorstel' | 'geen-wijziging'
export type ProcessMaintenanceSeverity = 'info' | 'waarschuwing' | 'fout'
export type ProcessMaintenanceCategory =
  | 'onduidelijkheid'
  | 'verantwoordelijkheid'
  | 'proceslogica'
  | 'beheersing'
  | 'bewijs'
  | 'systeem'
  | 'termijn'
  | 'consistentie'
export type ProcessMaintenanceField =
  | 'activiteit'
  | 'toelichting'
  | 'opmerking'
  | 'zijnotitie'
  | 'voorwaarde'
  | 'erpStatus'
  | 'termijn'
  | 'waarschuwing'

export interface ProcessMaintenanceTrigger {
  soort: 'handmatig' | 'health' | 'kader' | 'suggestie'
  referentieId?: string | null
  kaderId?: string | null
  titel?: string | null
  beschrijving?: string | null
}

export interface ProcessMaintenanceAnalysisRequest {
  expectedRevision: number
  doel?: string | null
  stapIds?: string[] | null
  aanleiding?: ProcessMaintenanceTrigger | null
  /** Antwoorden op vraag-id's uit een eerdere analyse van dezelfde revisie. */
  antwoorden?: Record<string, string> | null
}

export interface ProcessMaintenanceQuestion {
  id: string
  vraag: string
  waarom: string
  stapId: string | null
  bronIds: string[]
}

export interface ProcessMaintenanceIssue {
  id: string
  stapId: string | null
  categorie: ProcessMaintenanceCategory
  ernst: ProcessMaintenanceSeverity
  titel: string
  bevinding: string
  uitleg: string
  bronIds: string[]
}

export interface ProcessMaintenanceChange {
  id: string
  stapId: string
  veld: ProcessMaintenanceField
  oudeWaarde: string | null
  nieuweWaarde: string | null
  reden: string
  bevestigingVereist: true
  bronIds: string[]
}

export interface ProcessMaintenanceSource {
  id: string
  type: string
  procesId: string
  processRevision: number
  stapId: string | null
  veld: string | null
  label: string
  contentHash: string
}

export interface ProcessMaintenanceAnalysis {
  schemaVersion: 'process-maintenance.v1'
  runId: string
  procesId: string
  processRevision: number
  status: ProcessMaintenanceStatus
  samenvatting: string
  bronIds: string[]
  vragen: ProcessMaintenanceQuestion[]
  issues: ProcessMaintenanceIssue[]
  wijzigingen: ProcessMaintenanceChange[]
  bronnen: ProcessMaintenanceSource[]
}
