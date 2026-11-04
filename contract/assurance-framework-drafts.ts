/**
 * Contract voor brongebonden AI-kaderconcepten.
 *
 * Publicatie maakt een kader alleen zichtbaar in de catalogus. Activering
 * gebeurt apart via AssuranceSettings en is nooit een complianceclaim.
 */

export type AssuranceFrameworkDraftStatus = 'concept' | 'published' | 'rejected'

export interface AssuranceFrameworkDraftQuestion {
  id: string
  titel: string
  vraag: string
  bewijsHint: string
}

export interface AssuranceFrameworkDraftCreateRequest {
  bronUrl: string
  bronOrganisatie: string
  naam: string
  editie: string
  domein: string
  publiekeSamenvatting: string
  gebruiksrechtenBevestigd: boolean
}

export interface AssuranceFrameworkDraftPublishRequest {
  expectedRevision: number
  bronGecontroleerd: boolean
  rechtenGecontroleerd: boolean
  highLevelBeperkingGeaccepteerd: boolean
}

export interface AssuranceFrameworkDraftRejectRequest {
  expectedRevision: number
  reden: string
}

export interface AssuranceFrameworkDraft {
  draftId: string
  status: AssuranceFrameworkDraftStatus
  kaderId: string
  naam: string
  editie: string
  domein: string
  bronUrl: string
  bronOrganisatie: string
  publiekeSamenvatting: string
  gebruiksrechtenBevestigd: boolean
  schemaVersion: string
  provider: string
  model: string
  inputHash: string
  outputHash: string
  vragen: AssuranceFrameworkDraftQuestion[]
  aangemaaktDoor: string
  aangemaaktOp: string
  gepubliceerdDoor?: string | null
  gepubliceerdOp?: string | null
  bronGecontroleerdOp?: string | null
  rechtenGecontroleerdOp?: string | null
  afgewezenDoor?: string | null
  afgewezenOp?: string | null
  afwijsreden?: string | null
  revision: number
  disclaimer: string
}
