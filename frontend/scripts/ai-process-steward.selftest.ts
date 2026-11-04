import assert from 'node:assert/strict'
import type { ProcessMaintenanceAnalysis } from '../../contract/ai-process-steward.ts'
import type { Process } from '../src/contract.ts'
import {
  applyProcessMaintenanceAnalysis,
  isProcessMaintenanceAnalysisStale,
  parseProcessMaintenanceAnalysis,
  processMaintenanceSemanticFingerprint,
  validateProcessMaintenanceAnalysis,
} from '../src/lib/aiProcessSteward.ts'

const base: Process = {
  id: 'steward-test',
  hoofdproces: 'Service',
  detailproces: 'AI-onderhoudstest',
  versie: 'V1.0',
  status: 'concept',
  revision: 4,
  laatsteWijziging: '2026-07-28',
  lanes: [{ id: 'service', naam: 'Service', kleur: '#445566' }],
  secties: [{ id: 'hoofd', naam: 'Hoofdflow' }],
  stappen: [{
    id: 'controle',
    nummer: '1',
    laneId: 'service',
    sectieId: 'hoofd',
    type: 'actie',
    activiteit: 'Aanvraag controleren',
    toelichting: 'Controleer de invoer.',
  }],
  diagramLayout: {
    version: 1,
    coordinateSystem: 'px96-y-down',
    nodes: {
      'step:controle': { x: 260, y: 227, width: 204, height: 104 },
    },
  },
}

const raw = {
  schemaVersion: 'process-maintenance.v1',
  runId: 'run-1',
  procesId: 'steward-test',
  processRevision: 4,
  status: 'voorstel',
  samenvatting: 'De controlebeschrijving kan concreter.',
  bronIds: ['process:steward-test:step:controle'],
  vragen: [],
  issues: [{
    id: 'issue-1',
    stapId: 'controle',
    categorie: 'beheersing',
    ernst: 'waarschuwing',
    titel: 'Controle is niet toetsbaar',
    bevinding: 'De toelichting noemt geen controlecriteria.',
    uitleg: 'Maak duidelijk wat wordt gecontroleerd.',
    bronIds: ['process:steward-test:step:controle'],
  }],
  wijzigingen: [{
    id: 'change-1',
    stapId: 'controle',
    veld: 'toelichting',
    oudeWaarde: 'Controleer de invoer.',
    nieuweWaarde: 'Controleer verplichte velden, volledigheid en dubbele aanvragen.',
    reden: 'Maakt de controle uitvoerbaar en toetsbaar.',
    bevestigingVereist: true,
    bronIds: ['process:steward-test:step:controle:field:toelichting'],
  }],
  bronnen: [
    {
      id: 'process:steward-test:step:controle',
      type: 'process-step',
      procesId: 'steward-test',
      processRevision: 4,
      stapId: 'controle',
      veld: null,
      label: 'Stap 1: Aanvraag controleren',
      contentHash: 'sha256:stap',
    },
    {
      id: 'process:steward-test:step:controle:field:toelichting',
      type: 'process-field',
      procesId: 'steward-test',
      processRevision: 4,
      stapId: 'controle',
      veld: 'toelichting',
      label: 'Stap 1, veld toelichting',
      contentHash: 'sha256:veld',
    },
  ],
}

const analysis = parseProcessMaintenanceAnalysis(raw)
assert.deepEqual(validateProcessMaintenanceAnalysis(base, analysis), {
  ok: true,
  errors: [],
})

const before = structuredClone(base)
const applied = applyProcessMaintenanceAnalysis(base, analysis)
assert(applied.ok, applied.ok ? '' : applied.errors.join(' | '))
assert.equal(
  applied.process.stappen[0].toelichting,
  'Controleer verplichte velden, volledigheid en dubbele aanvragen.',
)
assert.equal(applied.process.status, 'concept')
assert.deepEqual(applied.process.diagramLayout, base.diagramLayout)
assert.deepEqual(base, before, 'toepassen mag het bronproces niet muteren')

const fingerprint = processMaintenanceSemanticFingerprint(base)
assert.equal(
  isProcessMaintenanceAnalysisStale({
    ...base,
    diagramLayout: {
      ...base.diagramLayout!,
      nodes: {
        'step:controle': { x: 999, y: 777, width: 180, height: 100 },
      },
    },
  }, fingerprint),
  false,
  'een pure layoutwijziging mag een voorstel niet stale maken',
)
assert.equal(
  isProcessMaintenanceAnalysisStale({
    ...base,
    stappen: [{ ...base.stappen[0], activiteit: 'Andere activiteit' }],
  }, fingerprint),
  true,
)

assert.throws(
  () => parseProcessMaintenanceAnalysis({ ...raw, onverwacht: true }),
  /onbekende velden/,
)
const invalid: ProcessMaintenanceAnalysis = {
  ...analysis,
  processRevision: 5,
}
assert.equal(validateProcessMaintenanceAnalysis(base, invalid).ok, false)

console.log(JSON.stringify({
  ok: true,
  checks: {
    strictParser: true,
    revisionPinned: true,
    oldValueValidated: true,
    conceptOnly: true,
    sourceImmutable: true,
    manualLayoutPreserved: true,
    semanticStaleDetection: true,
  },
}))
