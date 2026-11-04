import type {
  ProcessMaintenanceResultStatus,
  ProcessMaintenanceRunFeedback,
  ProcessMaintenanceRunLedgerItem,
  ProcessMaintenanceRunStatus,
} from '@contract/ai-run-history'

type UnknownObject = Record<string, unknown>

const RUN_STATUSES = new Set<ProcessMaintenanceRunStatus>([
  'running',
  'completed',
  'failed',
  'stale',
  'cancelled',
])
const RESULT_STATUSES = new Set<ProcessMaintenanceResultStatus>([
  'vragen',
  'voorstel',
  'geen-wijziging',
])
const REQUIRED_RUN_KEYS = [
  'runId',
  'capability',
  'procesId',
  'processRevision',
  'status',
  'gestartDoor',
  'gestartOp',
  'vraagAantal',
  'issueAantal',
  'wijzigingAantal',
] as const
const OPTIONAL_RUN_KEYS = [
  'resultaatStatus',
  'provider',
  'model',
  'afgerondOp',
  'duurMs',
  'inputHash',
  'outputHash',
  'foutcode',
  'feedback',
] as const
const REQUIRED_FEEDBACK_KEYS = [
  'beslissing',
  'geaccepteerdeWijzigingIds',
  'doorGebruiker',
  'op',
] as const
const OPTIONAL_FEEDBACK_KEYS = ['reden'] as const
const ISO_INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/
const RESULT_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/

function asObject(value: unknown, path: string): UnknownObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${path} moet een object zijn.`)
  }
  return value as UnknownObject
}

function exactKeys(
  object: UnknownObject,
  required: readonly string[],
  optional: readonly string[],
  path: string,
): void {
  const allowed = new Set([...required, ...optional])
  const unknown = Object.keys(object).filter((key) => !allowed.has(key))
  if (unknown.length > 0) {
    throw new Error(`${path} bevat onbekende velden: ${unknown.join(', ')}.`)
  }
  for (const key of required) {
    if (!(key in object)) throw new Error(`${path}.${key} ontbreekt.`)
  }
}

function text(object: UnknownObject, key: string, path: string): string {
  const value = object[key]
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${path}.${key} moet niet-lege tekst zijn.`)
  }
  return value
}

function optionalText(
  object: UnknownObject,
  key: string,
  path: string,
): string | undefined {
  if (!(key in object)) return undefined
  return text(object, key, path)
}

function optionalNullableText(
  object: UnknownObject,
  key: string,
  path: string,
): string | null | undefined {
  if (!(key in object)) return undefined
  if (object[key] === null) return null
  return text(object, key, path)
}

function nonNegativeInteger(object: UnknownObject, key: string, path: string): number {
  const value = object[key]
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${path}.${key} moet een niet-negatief geheel getal zijn.`)
  }
  return value
}

function positiveInteger(object: UnknownObject, key: string, path: string): number {
  const value = object[key]
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${path}.${key} moet een positief geheel getal zijn.`)
  }
  return value
}

function instant(object: UnknownObject, key: string, path: string): string {
  const value = text(object, key, path)
  if (!ISO_INSTANT.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error(`${path}.${key} moet een ISO-8601-tijdstip met tijdzone zijn.`)
  }
  return value
}

function optionalInstant(
  object: UnknownObject,
  key: string,
  path: string,
): string | undefined {
  if (!(key in object)) return undefined
  return instant(object, key, path)
}

function optionalNonNegativeInteger(
  object: UnknownObject,
  key: string,
  path: string,
): number | undefined {
  if (!(key in object)) return undefined
  return nonNegativeInteger(object, key, path)
}

function parseFeedback(
  value: unknown,
  wijzigingAantal: number,
  path: string,
): ProcessMaintenanceRunFeedback {
  const object = asObject(value, path)
  exactKeys(object, REQUIRED_FEEDBACK_KEYS, OPTIONAL_FEEDBACK_KEYS, path)

  const beslissing = text(object, 'beslissing', path)
  if (beslissing !== 'accepted' && beslissing !== 'rejected') {
    throw new Error(`${path}.beslissing wordt niet ondersteund.`)
  }
  const ids = object.geaccepteerdeWijzigingIds
  if (!Array.isArray(ids)) {
    throw new Error(`${path}.geaccepteerdeWijzigingIds moet een lijst zijn.`)
  }
  if (ids.length > 20) {
    throw new Error(`${path}.geaccepteerdeWijzigingIds bevat meer dan 20 waarden.`)
  }
  const geaccepteerdeWijzigingIds = ids.map((id, index) => {
    if (
      typeof id !== 'string' ||
      !id.trim() ||
      !RESULT_IDENTIFIER.test(id)
    ) {
      throw new Error(
        `${path}.geaccepteerdeWijzigingIds[${index}] is geen geldige wijziging-id.`,
      )
    }
    return id
  })
  if (new Set(geaccepteerdeWijzigingIds).size !== geaccepteerdeWijzigingIds.length) {
    throw new Error(`${path}.geaccepteerdeWijzigingIds bevat dubbele waarden.`)
  }
  if (beslissing === 'rejected' && geaccepteerdeWijzigingIds.length > 0) {
    throw new Error(`${path}: een afwijzing mag geen geaccepteerde wijzigingen bevatten.`)
  }
  if (beslissing === 'accepted' && geaccepteerdeWijzigingIds.length === 0) {
    throw new Error(`${path}: een acceptatie vereist minimaal één wijziging-id.`)
  }
  if (geaccepteerdeWijzigingIds.length > wijzigingAantal) {
    throw new Error(`${path} accepteert meer wijzigingen dan de run bevat.`)
  }

  const reden = optionalText(object, 'reden', path)
  if (reden && reden.length > 160) {
    throw new Error(`${path}.reden mag maximaal 160 tekens bevatten.`)
  }

  return {
    beslissing,
    reden,
    geaccepteerdeWijzigingIds,
    doorGebruiker: text(object, 'doorGebruiker', path),
    op: instant(object, 'op', path),
  }
}

function validateResultCounts(
  status: ProcessMaintenanceRunStatus,
  resultaatStatus: ProcessMaintenanceResultStatus | undefined,
  vraagAantal: number,
  issueAantal: number,
  wijzigingAantal: number,
  path: string,
): void {
  if (status !== 'completed' && resultaatStatus !== undefined) {
    throw new Error(`${path}.resultaatStatus hoort alleen bij een voltooide run.`)
  }
  if (resultaatStatus === 'vragen' && (vraagAantal === 0 || wijzigingAantal > 0)) {
    throw new Error(`${path}: resultaatStatus vragen past niet bij de tellingen.`)
  }
  if (
    resultaatStatus === 'voorstel' &&
    issueAantal === 0 &&
    wijzigingAantal === 0
  ) {
    throw new Error(
      `${path}: resultaatStatus voorstel vereist minimaal één signaal of wijziging.`,
    )
  }
  if (
    resultaatStatus === 'geen-wijziging' &&
    (vraagAantal > 0 || wijzigingAantal > 0)
  ) {
    throw new Error(`${path}: resultaatStatus geen-wijziging past niet bij de tellingen.`)
  }
}

export function parseProcessMaintenanceRunLedgerItem(
  value: unknown,
  path = 'run',
): ProcessMaintenanceRunLedgerItem {
  const object = asObject(value, path)
  exactKeys(object, REQUIRED_RUN_KEYS, OPTIONAL_RUN_KEYS, path)
  if (object.capability !== 'process-maintenance') {
    throw new Error(`${path}.capability wordt niet ondersteund.`)
  }

  const status = text(object, 'status', path) as ProcessMaintenanceRunStatus
  if (!RUN_STATUSES.has(status)) {
    throw new Error(`${path}.status wordt niet ondersteund.`)
  }
  const resultaatStatus = optionalText(
    object,
    'resultaatStatus',
    path,
  ) as ProcessMaintenanceResultStatus | undefined
  if (resultaatStatus !== undefined && !RESULT_STATUSES.has(resultaatStatus)) {
    throw new Error(`${path}.resultaatStatus wordt niet ondersteund.`)
  }
  const vraagAantal = nonNegativeInteger(object, 'vraagAantal', path)
  const issueAantal = nonNegativeInteger(object, 'issueAantal', path)
  const wijzigingAantal = nonNegativeInteger(object, 'wijzigingAantal', path)
  validateResultCounts(
    status,
    resultaatStatus,
    vraagAantal,
    issueAantal,
    wijzigingAantal,
    path,
  )

  const afgerondOp = optionalInstant(object, 'afgerondOp', path)
  const foutcode = optionalText(object, 'foutcode', path)
  if (status === 'running' && afgerondOp !== undefined) {
    throw new Error(`${path}: een actieve run mag nog geen eindtijd hebben.`)
  }
  if (status === 'running' && foutcode !== undefined) {
    throw new Error(`${path}: een actieve run mag geen foutcode hebben.`)
  }
  if (
    (status === 'running' || status === 'completed') &&
    foutcode !== undefined
  ) {
    throw new Error(
      `${path}.foutcode hoort alleen bij een mislukte, verouderde of geannuleerde run.`,
    )
  }

  const feedback = 'feedback' in object
    ? parseFeedback(object.feedback, wijzigingAantal, `${path}.feedback`)
    : undefined
  if (feedback && status !== 'completed') {
    throw new Error(`${path}.feedback hoort alleen bij een voltooide run.`)
  }

  return {
    runId: text(object, 'runId', path),
    capability: 'process-maintenance',
    procesId: text(object, 'procesId', path),
    processRevision: positiveInteger(object, 'processRevision', path),
    status,
    resultaatStatus,
    provider: optionalNullableText(object, 'provider', path),
    model: optionalNullableText(object, 'model', path),
    gestartDoor: text(object, 'gestartDoor', path),
    gestartOp: instant(object, 'gestartOp', path),
    afgerondOp,
    duurMs: optionalNonNegativeInteger(object, 'duurMs', path),
    inputHash: optionalText(object, 'inputHash', path),
    outputHash: optionalText(object, 'outputHash', path),
    vraagAantal,
    issueAantal,
    wijzigingAantal,
    foutcode,
    feedback,
  }
}

export function parseProcessMaintenanceRunHistory(
  value: unknown,
): ProcessMaintenanceRunLedgerItem[] {
  if (!Array.isArray(value)) {
    throw new Error('AI-runhistorie moet een lijst zijn.')
  }
  if (value.length > 100) {
    throw new Error('AI-runhistorie bevat meer dan 100 runs.')
  }
  const items = value.map((entry, index) =>
    parseProcessMaintenanceRunLedgerItem(entry, `runs[${index}]`)
  )
  const ids = items.map((item) => item.runId)
  if (new Set(ids).size !== ids.length) {
    throw new Error('AI-runhistorie bevat dubbele run-id’s.')
  }
  return items
}

export function deriveProcessMaintenanceResultStatus(
  item: ProcessMaintenanceRunLedgerItem,
): ProcessMaintenanceResultStatus | undefined {
  if (item.status !== 'completed') return undefined
  if (item.resultaatStatus) return item.resultaatStatus
  if (item.vraagAantal > 0 && item.wijzigingAantal === 0) return 'vragen'
  if (item.wijzigingAantal > 0) return 'voorstel'
  return 'geen-wijziging'
}

export type ProcessMaintenanceRunPresentation =
  | 'bezig'
  | 'voorstel'
  | 'vragen'
  | 'geen-wijziging'
  | 'geaccepteerd'
  | 'afgewezen'
  | 'mislukt'
  | 'verouderd'
  | 'geannuleerd'

export function deriveProcessMaintenanceRunPresentation(
  item: ProcessMaintenanceRunLedgerItem,
): ProcessMaintenanceRunPresentation {
  if (item.feedback?.beslissing === 'accepted') return 'geaccepteerd'
  if (item.feedback?.beslissing === 'rejected') return 'afgewezen'
  if (item.status === 'running') return 'bezig'
  if (item.status === 'failed') return 'mislukt'
  if (item.status === 'stale') return 'verouderd'
  if (item.status === 'cancelled') return 'geannuleerd'
  return deriveProcessMaintenanceResultStatus(item) ?? 'geen-wijziging'
}

export function isActionableProcessMaintenanceRun(
  item: ProcessMaintenanceRunLedgerItem,
  currentProcessRevision?: number,
): boolean {
  return item.status === 'completed' &&
    deriveProcessMaintenanceResultStatus(item) === 'voorstel' &&
    item.wijzigingAantal > 0 &&
    !item.feedback &&
    (
      currentProcessRevision === undefined ||
      item.processRevision === currentProcessRevision
    )
}
