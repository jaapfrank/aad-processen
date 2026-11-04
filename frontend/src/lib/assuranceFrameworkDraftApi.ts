import type {
  AssuranceFrameworkDraft,
  AssuranceFrameworkDraftCreateRequest,
  AssuranceFrameworkDraftPublishRequest,
  AssuranceFrameworkDraftQuestion,
  AssuranceFrameworkDraftRejectRequest,
  AssuranceFrameworkDraftStatus,
} from '@contract/assurance-framework-drafts'
import { getEntraToken } from '../entraAuth'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringField(
  object: Record<string, unknown>,
  field: string,
  nullable = false,
): string | null {
  const value = object[field]
  if (nullable && (value === null || value === undefined)) return null
  if (typeof value !== 'string') {
    throw new Error(`Ongeldig kaderconceptcontract: ${field}.`)
  }
  return value
}

function parseQuestion(value: unknown): AssuranceFrameworkDraftQuestion {
  if (!isRecord(value)) throw new Error('Ongeldig kaderconceptcontract: vraag.')
  return {
    id: stringField(value, 'id') as string,
    titel: stringField(value, 'titel') as string,
    vraag: stringField(value, 'vraag') as string,
    bewijsHint: stringField(value, 'bewijsHint') as string,
  }
}

function httpsField(object: Record<string, unknown>, field: string): string {
  const value = stringField(object, field) as string
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'https:' || !parsed.hostname) throw new Error()
  } catch {
    throw new Error(`Ongeldig kaderconceptcontract: ${field} is geen HTTPS-bron.`)
  }
  return value
}

function sha256Field(object: Record<string, unknown>, field: string): string {
  const value = stringField(object, field) as string
  if (!/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error(`Ongeldig kaderconceptcontract: ${field} is geen SHA-256-hash.`)
  }
  return value
}

function dateField(
  object: Record<string, unknown>,
  field: string,
  nullable = false,
): string | null {
  const value = stringField(object, field, nullable)
  if (value === null) return null
  if (Number.isNaN(Date.parse(value))) {
    throw new Error(`Ongeldig kaderconceptcontract: ${field} is geen datum.`)
  }
  return value
}

export function parseAssuranceFrameworkDraft(value: unknown): AssuranceFrameworkDraft {
  if (!isRecord(value)) throw new Error('Ongeldig kaderconceptcontract.')
  const status = stringField(value, 'status') as AssuranceFrameworkDraftStatus
  if (status !== 'concept' && status !== 'published' && status !== 'rejected') {
    throw new Error('Ongeldig kaderconceptcontract: status.')
  }
  if (!Array.isArray(value.vragen) || value.vragen.length < 3 || value.vragen.length > 15) {
    throw new Error('Ongeldig kaderconceptcontract: vragen.')
  }
  if (
    typeof value.gebruiksrechtenBevestigd !== 'boolean' ||
    typeof value.revision !== 'number' ||
    !Number.isInteger(value.revision) ||
    value.revision < 1
  ) {
    throw new Error('Ongeldig kaderconceptcontract: revisie of rechtenstatus.')
  }

  const draftId = stringField(value, 'draftId') as string
  if (!/^[a-f0-9]{32}$/i.test(draftId)) {
    throw new Error('Ongeldig kaderconceptcontract: draftId.')
  }

  return {
    draftId,
    status,
    kaderId: stringField(value, 'kaderId') as string,
    naam: stringField(value, 'naam') as string,
    editie: stringField(value, 'editie') as string,
    domein: stringField(value, 'domein') as string,
    bronUrl: httpsField(value, 'bronUrl'),
    bronOrganisatie: stringField(value, 'bronOrganisatie') as string,
    publiekeSamenvatting: stringField(value, 'publiekeSamenvatting') as string,
    gebruiksrechtenBevestigd: value.gebruiksrechtenBevestigd,
    schemaVersion: stringField(value, 'schemaVersion') as string,
    provider: stringField(value, 'provider') as string,
    model: stringField(value, 'model') as string,
    inputHash: sha256Field(value, 'inputHash'),
    outputHash: sha256Field(value, 'outputHash'),
    vragen: value.vragen.map(parseQuestion),
    aangemaaktDoor: stringField(value, 'aangemaaktDoor') as string,
    aangemaaktOp: dateField(value, 'aangemaaktOp') as string,
    gepubliceerdDoor: stringField(value, 'gepubliceerdDoor', true),
    gepubliceerdOp: dateField(value, 'gepubliceerdOp', true),
    bronGecontroleerdOp: dateField(value, 'bronGecontroleerdOp', true),
    rechtenGecontroleerdOp: dateField(value, 'rechtenGecontroleerdOp', true),
    afgewezenDoor: stringField(value, 'afgewezenDoor', true),
    afgewezenOp: dateField(value, 'afgewezenOp', true),
    afwijsreden: stringField(value, 'afwijsreden', true),
    revision: value.revision,
    disclaimer: stringField(value, 'disclaimer') as string,
  }
}

async function request(url: string, init?: RequestInit): Promise<unknown> {
  const token = getEntraToken()
  const headers = new Headers(init?.headers)
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  const response = await fetch(url, {
    credentials: 'include',
    ...init,
    headers,
  })
  if (!response.ok) {
    let message = `${init?.method ?? 'GET'} ${url} → ${response.status}`
    try {
      const body = (await response.json()) as {
        bericht?: string
        message?: string
      }
      message = body.bericht ?? body.message ?? message
    } catch {
      // Houd de veilige statusmelding wanneer de server geen JSON retourneert.
    }
    throw new Error(message)
  }
  return response.status === 204 ? null : response.json()
}

function json(method: 'POST', body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

export async function listAssuranceFrameworkDrafts(): Promise<AssuranceFrameworkDraft[]> {
  const value = await request('/api/admin/assurance-framework-drafts')
  if (!Array.isArray(value)) throw new Error('Ongeldige lijst met kaderconcepten.')
  return value.map(parseAssuranceFrameworkDraft)
}

export async function createAssuranceFrameworkDraftWithAi(
  body: AssuranceFrameworkDraftCreateRequest,
): Promise<AssuranceFrameworkDraft> {
  return parseAssuranceFrameworkDraft(
    await request('/api/admin/assurance-framework-drafts/ai', json('POST', body)),
  )
}

export async function publishAssuranceFrameworkDraft(
  draftId: string,
  body: AssuranceFrameworkDraftPublishRequest,
): Promise<AssuranceFrameworkDraft> {
  return parseAssuranceFrameworkDraft(
    await request(
      `/api/admin/assurance-framework-drafts/${encodeURIComponent(draftId)}/publish`,
      json('POST', body),
    ),
  )
}

export async function rejectAssuranceFrameworkDraft(
  draftId: string,
  body: AssuranceFrameworkDraftRejectRequest,
): Promise<AssuranceFrameworkDraft> {
  return parseAssuranceFrameworkDraft(
    await request(
      `/api/admin/assurance-framework-drafts/${encodeURIComponent(draftId)}/reject`,
      json('POST', body),
    ),
  )
}
