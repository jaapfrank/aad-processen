import type {
  ProcessMaintenanceAnalysis,
  ProcessMaintenanceCategory,
  ProcessMaintenanceChange,
  ProcessMaintenanceField,
  ProcessMaintenanceIssue,
  ProcessMaintenanceQuestion,
  ProcessMaintenanceSeverity,
  ProcessMaintenanceSource,
  ProcessMaintenanceStatus,
} from '@contract/ai-process-steward'
import type { Process, Step } from '../contract'

type UnknownObject = Record<string, unknown>

const STATUSES = new Set<ProcessMaintenanceStatus>([
  'vragen',
  'voorstel',
  'geen-wijziging',
])
const SEVERITIES = new Set<ProcessMaintenanceSeverity>([
  'info',
  'waarschuwing',
  'fout',
])
const CATEGORIES = new Set<ProcessMaintenanceCategory>([
  'onduidelijkheid',
  'verantwoordelijkheid',
  'proceslogica',
  'beheersing',
  'bewijs',
  'systeem',
  'termijn',
  'consistentie',
])
export const PROCESS_MAINTENANCE_FIELDS = new Set<ProcessMaintenanceField>([
  'activiteit',
  'toelichting',
  'opmerking',
  'zijnotitie',
  'voorwaarde',
  'erpStatus',
  'termijn',
  'waarschuwing',
])

function asObject(value: unknown, path: string): UnknownObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${path} moet een object zijn.`)
  }
  return value as UnknownObject
}

function exactKeys(object: UnknownObject, keys: readonly string[], path: string): void {
  const unknown = Object.keys(object).filter((key) => !keys.includes(key))
  if (unknown.length > 0) {
    throw new Error(`${path} bevat onbekende velden: ${unknown.join(', ')}.`)
  }
  for (const key of keys) {
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

function nullableText(object: UnknownObject, key: string, path: string): string | null {
  const value = object[key]
  if (value === null) return null
  if (typeof value !== 'string') throw new Error(`${path}.${key} moet tekst of null zijn.`)
  return value
}

function numberValue(object: UnknownObject, key: string, path: string): number {
  const value = object[key]
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${path}.${key} moet een positief geheel getal zijn.`)
  }
  return value
}

function texts(object: UnknownObject, key: string, path: string): string[] {
  const value = object[key]
  if (!Array.isArray(value)) throw new Error(`${path}.${key} moet een lijst zijn.`)
  return value.map((entry, index) => {
    if (typeof entry !== 'string' || !entry.trim()) {
      throw new Error(`${path}.${key}[${index}] moet niet-lege tekst zijn.`)
    }
    return entry
  })
}

function objects(object: UnknownObject, key: string, path: string): unknown[] {
  const value = object[key]
  if (!Array.isArray(value)) throw new Error(`${path}.${key} moet een lijst zijn.`)
  return value
}

function parseQuestion(value: unknown, index: number): ProcessMaintenanceQuestion {
  const path = `vragen[${index}]`
  const object = asObject(value, path)
  exactKeys(object, ['id', 'vraag', 'waarom', 'stapId', 'bronIds'], path)
  return {
    id: text(object, 'id', path),
    vraag: text(object, 'vraag', path),
    waarom: text(object, 'waarom', path),
    stapId: nullableText(object, 'stapId', path),
    bronIds: texts(object, 'bronIds', path),
  }
}

function parseIssue(value: unknown, index: number): ProcessMaintenanceIssue {
  const path = `issues[${index}]`
  const object = asObject(value, path)
  exactKeys(
    object,
    ['id', 'stapId', 'categorie', 'ernst', 'titel', 'bevinding', 'uitleg', 'bronIds'],
    path,
  )
  const categorie = text(object, 'categorie', path) as ProcessMaintenanceCategory
  const ernst = text(object, 'ernst', path) as ProcessMaintenanceSeverity
  if (!CATEGORIES.has(categorie)) throw new Error(`${path}.categorie is niet ondersteund.`)
  if (!SEVERITIES.has(ernst)) throw new Error(`${path}.ernst is niet ondersteund.`)
  return {
    id: text(object, 'id', path),
    stapId: nullableText(object, 'stapId', path),
    categorie,
    ernst,
    titel: text(object, 'titel', path),
    bevinding: text(object, 'bevinding', path),
    uitleg: text(object, 'uitleg', path),
    bronIds: texts(object, 'bronIds', path),
  }
}

function parseChange(value: unknown, index: number): ProcessMaintenanceChange {
  const path = `wijzigingen[${index}]`
  const object = asObject(value, path)
  exactKeys(
    object,
    [
      'id',
      'stapId',
      'veld',
      'oudeWaarde',
      'nieuweWaarde',
      'reden',
      'bevestigingVereist',
      'bronIds',
    ],
    path,
  )
  const veld = text(object, 'veld', path) as ProcessMaintenanceField
  if (!PROCESS_MAINTENANCE_FIELDS.has(veld)) {
    throw new Error(`${path}.veld mag niet door AI worden aangepast.`)
  }
  if (object.bevestigingVereist !== true) {
    throw new Error(`${path}.bevestigingVereist moet true zijn.`)
  }
  return {
    id: text(object, 'id', path),
    stapId: text(object, 'stapId', path),
    veld,
    oudeWaarde: nullableText(object, 'oudeWaarde', path),
    nieuweWaarde: nullableText(object, 'nieuweWaarde', path),
    reden: text(object, 'reden', path),
    bevestigingVereist: true,
    bronIds: texts(object, 'bronIds', path),
  }
}

function parseSource(value: unknown, index: number): ProcessMaintenanceSource {
  const path = `bronnen[${index}]`
  const object = asObject(value, path)
  exactKeys(
    object,
    [
      'id',
      'type',
      'procesId',
      'processRevision',
      'stapId',
      'veld',
      'label',
      'contentHash',
    ],
    path,
  )
  return {
    id: text(object, 'id', path),
    type: text(object, 'type', path),
    procesId: text(object, 'procesId', path),
    processRevision: numberValue(object, 'processRevision', path),
    stapId: nullableText(object, 'stapId', path),
    veld: nullableText(object, 'veld', path),
    label: text(object, 'label', path),
    contentHash: text(object, 'contentHash', path),
  }
}

export function parseProcessMaintenanceAnalysis(value: unknown): ProcessMaintenanceAnalysis {
  const object = asObject(value, 'analyse')
  exactKeys(
    object,
    [
      'schemaVersion',
      'runId',
      'procesId',
      'processRevision',
      'status',
      'samenvatting',
      'bronIds',
      'vragen',
      'issues',
      'wijzigingen',
      'bronnen',
    ],
    'analyse',
  )
  if (object.schemaVersion !== 'process-maintenance.v1') {
    throw new Error('analyse.schemaVersion wordt niet ondersteund.')
  }
  const status = text(object, 'status', 'analyse') as ProcessMaintenanceStatus
  if (!STATUSES.has(status)) throw new Error('analyse.status wordt niet ondersteund.')
  const result: ProcessMaintenanceAnalysis = {
    schemaVersion: 'process-maintenance.v1',
    runId: text(object, 'runId', 'analyse'),
    procesId: text(object, 'procesId', 'analyse'),
    processRevision: numberValue(object, 'processRevision', 'analyse'),
    status,
    samenvatting: text(object, 'samenvatting', 'analyse'),
    bronIds: texts(object, 'bronIds', 'analyse'),
    vragen: objects(object, 'vragen', 'analyse').map(parseQuestion),
    issues: objects(object, 'issues', 'analyse').map(parseIssue),
    wijzigingen: objects(object, 'wijzigingen', 'analyse').map(parseChange),
    bronnen: objects(object, 'bronnen', 'analyse').map(parseSource),
  }
  const expected =
    status === 'vragen'
      ? result.vragen.length > 0 && result.wijzigingen.length === 0
      : status === 'voorstel'
        ? result.vragen.length === 0 &&
          (result.issues.length > 0 || result.wijzigingen.length > 0)
        : result.vragen.length === 0 &&
          result.issues.length === 0 &&
          result.wijzigingen.length === 0
  if (!expected) throw new Error('De analyse-inhoud past niet bij de opgegeven status.')
  return result
}

function semanticProcess(process: Process): unknown {
  const semantic: Partial<Process> = { ...process }
  delete semantic.diagramLayout
  return semantic
}

export function processMaintenanceSemanticFingerprint(process: Process): string {
  return JSON.stringify(semanticProcess(process))
}

export function isProcessMaintenanceAnalysisStale(
  process: Process,
  fingerprint: string,
): boolean {
  return processMaintenanceSemanticFingerprint(process) !== fingerprint
}

function currentText(step: Step, field: ProcessMaintenanceField): string | null {
  return step[field] ?? null
}

export function validateProcessMaintenanceAnalysis(
  process: Process,
  analysis: ProcessMaintenanceAnalysis,
): { ok: true; errors: [] } | { ok: false; errors: string[] } {
  const errors: string[] = []
  if (analysis.procesId !== process.id) errors.push('Het voorstel hoort bij een ander proces.')
  if (analysis.processRevision !== process.revision) {
    errors.push('De opgeslagen procesrevisie is gewijzigd.')
  }
  const sources = new Set(analysis.bronnen.map((source) => source.id))
  const stepIds = new Set(process.stappen.map((step) => step.id))
  const targets = new Set<string>()
  for (const issue of analysis.issues) {
    if (issue.stapId && !stepIds.has(issue.stapId)) {
      errors.push(`Bevinding ${issue.id} verwijst naar een onbekende stap.`)
    }
    if (issue.bronIds.some((id) => !sources.has(id))) {
      errors.push(`Bevinding ${issue.id} bevat een onbekende bron.`)
    }
  }
  for (const change of analysis.wijzigingen) {
    const step = process.stappen.find((candidate) => candidate.id === change.stapId)
    if (!step) {
      errors.push(`Wijziging ${change.id} verwijst naar een onbekende stap.`)
      continue
    }
    const target = `${change.stapId}\u001f${change.veld}`
    if (targets.has(target)) errors.push(`Veld ${change.veld} van stap ${change.stapId} is dubbel.`)
    targets.add(target)
    if (currentText(step, change.veld) !== change.oudeWaarde) {
      errors.push(`Veld ${change.veld} van stap ${change.stapId} is inmiddels gewijzigd.`)
    }
    if (change.bronIds.some((id) => !sources.has(id))) {
      errors.push(`Wijziging ${change.id} bevat een onbekende bron.`)
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, errors: [] }
}

export function applyProcessMaintenanceAnalysis(
  process: Process,
  analysis: ProcessMaintenanceAnalysis,
): { ok: true; process: Process } | { ok: false; errors: string[] } {
  const validation = validateProcessMaintenanceAnalysis(process, analysis)
  if (!validation.ok) return validation
  const changes = new Map(
    analysis.wijzigingen.map((change) => [
      `${change.stapId}\u001f${change.veld}`,
      change,
    ]),
  )
  return {
    ok: true,
    process: {
      ...process,
      status: 'concept',
      stappen: process.stappen.map((step) => {
        const patch: Partial<Step> = {}
        for (const field of PROCESS_MAINTENANCE_FIELDS) {
          const change = changes.get(`${step.id}\u001f${field}`)
          if (change) patch[field] = change.nieuweWaarde ?? undefined
        }
        return Object.keys(patch).length > 0 ? { ...step, ...patch } : step
      }),
    },
  }
}

export function sourcesFor(
  analysis: ProcessMaintenanceAnalysis,
  sourceIds: readonly string[],
): ProcessMaintenanceSource[] {
  const selected = new Set(sourceIds)
  return analysis.bronnen.filter((source) => selected.has(source.id))
}
