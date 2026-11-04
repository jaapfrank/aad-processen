import assert from 'node:assert/strict'
import type { Process } from '../src/contract.ts'
import { maakDiagramImportWerkconcept } from '../src/lib/uitwisseling.ts'

const basis = {
  hoofdproces: 'Service',
  detailproces: 'Revisiontest',
  versie: 'V1.0',
  status: 'concept',
  laatsteWijziging: '2026-07-27',
  bron: { type: 'handmatig' },
  lanes: [{ id: 'service', naam: 'Service' }],
  secties: [{ id: 'hoofd', naam: 'Hoofdflow' }],
  stappen: [],
} satisfies Omit<Process, 'id'>

const serverProces: Process = {
  ...basis,
  id: 'bestaand-proces',
  revision: 7,
}
const leveranciersImport: Process = {
  ...basis,
  id: 'extern-proces',
  revision: 99,
  detailproces: 'Geïmporteerde inhoud',
}

const werkconcept = maakDiagramImportWerkconcept(leveranciersImport, serverProces)
assert.equal(werkconcept.id, 'bestaand-proces')
assert.equal(
  werkconcept.revision,
  7,
  'De revision uit het doelproces moet gezaghebbend blijven.',
)

let opgeslagen = structuredClone(serverProces)
const modelSave = (concept: Process): Process => {
  assert.equal(
    concept.revision,
    opgeslagen.revision,
    'Een import met een verouderde of externe revision moet als conflict worden geweigerd.',
  )
  opgeslagen = { ...structuredClone(concept), revision: (opgeslagen.revision ?? 0) + 1 }
  return opgeslagen
}

const naOpslaan = modelSave(werkconcept)
assert.equal(naOpslaan.revision, 8, 'Expliciet opslaan moet de revision verhogen.')

const nieuwConcept = maakDiagramImportWerkconcept(leveranciersImport)
assert.equal(nieuwConcept.id, 'extern-proces')
assert.equal(
  nieuwConcept.revision,
  undefined,
  'Een nieuw concept mag geen leveranciersrevision overnemen.',
)

console.log('✔ Diagramimport behoudt de doelrevision en expliciet opslaan verhoogt 7 → 8.')
