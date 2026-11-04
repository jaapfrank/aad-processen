/**
 * Veilige, compacte AI-runhistorie. Dit contract bevat bewust geen prompts,
 * gebruikersantwoorden, ruwe procescontext of modeloutput.
 */

export type ProcessMaintenanceRunStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'stale'
  | 'cancelled'

export type ProcessMaintenanceFeedbackDecision = 'accepted' | 'rejected'
export type ProcessMaintenanceResultStatus = 'vragen' | 'voorstel' | 'geen-wijziging'

export interface ProcessMaintenanceRunFeedback {
  beslissing: ProcessMaintenanceFeedbackDecision
  reden?: string
  geaccepteerdeWijzigingIds: string[]
  doorGebruiker: string
  op: string
}

export interface ProcessMaintenanceRunLedgerItem {
  runId: string
  capability: 'process-maintenance'
  procesId: string
  processRevision: number
  status: ProcessMaintenanceRunStatus
  resultaatStatus?: ProcessMaintenanceResultStatus
  provider?: string | null
  model?: string | null
  gestartDoor: string
  gestartOp: string
  afgerondOp?: string
  duurMs?: number
  inputHash?: string
  outputHash?: string
  vraagAantal: number
  issueAantal: number
  wijzigingAantal: number
  foutcode?: string
  feedback?: ProcessMaintenanceRunFeedback
}

export interface ProcessMaintenanceRunFeedbackRequest {
  beslissing: ProcessMaintenanceFeedbackDecision
  reden?: string
  /**
   * Bij accepted 1..20 door de gebruiker geaccepteerde wijzigingen.
   * Bij rejected altijd een lege lijst.
   */
  geaccepteerdeWijzigingIds?: string[]
}
