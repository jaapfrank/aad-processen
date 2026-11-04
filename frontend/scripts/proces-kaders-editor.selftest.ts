import assert from 'node:assert/strict'
import type { Process } from '../src/contract.ts'
import { controleerProcesTegenKader } from '../src/lib/procesKaders.ts'

const proces: Process = {
  id: 'kader-editor-test',
  hoofdproces: 'Test',
  detailproces: 'Kaderbevindingen',
  versie: 'V1.0',
  status: 'concept',
  laatsteWijziging: '2026-07-27',
  bron: { type: 'handmatig' },
  lanes: [{ id: 'lane', naam: 'Behandelaar', kleur: '#315f8e' }],
  secties: [{ id: 'main', naam: 'Hoofdflow' }],
  stappen: [
    {
      id: 'invalid-owner',
      nummer: '1',
      laneId: 'missing-lane',
      sectieId: 'main',
      type: 'actie',
      activiteit: 'Voer taak uit',
      naarStap: 'missing-step',
    },
    {
      id: 'invalid-gateway',
      nummer: '2',
      laneId: 'lane',
      sectieId: 'main',
      type: 'beslissing',
      activiteit: 'Akkoord?',
      routes: [{ id: 'only', label: 'Ja', naarProces: 'extern' }],
    },
  ],
}
const snapshot = JSON.stringify(proces)

const bpmn = controleerProcesTegenKader(proces, 'bpmn20')
const controle = (id: string) => {
  const resultaat = bpmn.controles.find((item) => item.id === id)
  assert(resultaat, `Controle ${id} ontbreekt.`)
  return resultaat
}

assert.deepEqual(controle('basis-rollen').stapIds, ['invalid-owner'])
assert.deepEqual(
  controle('basis-flow').stapIds,
  ['invalid-owner', 'invalid-gateway'],
  'structurele flowbevinding markeert uitsluitend bestaande probleemelementen',
)
assert.deepEqual(controle('bpmn-gateways').stapIds, ['invalid-gateway'])
assert.deepEqual(
  controle('bpmn-lanes').stapIds,
  ['invalid-owner'],
  'ongeldige verantwoordelijkheid is stap-koppelbaar',
)
assert.equal(
  controle('bpmn-events').stapIds,
  undefined,
  'een ontbrekend start/einde wordt niet kunstmatig aan een bestaande stap gekoppeld',
)
assert.equal(
  controle('basis-governance').stapIds,
  undefined,
  'handmatige procesniveau-beoordeling blijft zonder stap-id zichtbaar',
)

const qms = controleerProcesTegenKader(proces, 'iso9001')
assert.deepEqual(
  qms.controles.find((item) => item.id === 'qms-criteria')?.stapIds,
  ['invalid-owner', 'invalid-gateway'],
)
assert.deepEqual(
  qms.controles.find((item) => item.id === 'qms-meten')?.stapIds,
  ['invalid-owner', 'invalid-gateway'],
)

const procesMetExplicieteStart: Process = {
  ...proces,
  id: 'expliciete-start',
  lanes: [{ id: 'lane', naam: 'Behandelaar', kleur: '#315f8e' }],
  stappen: [
    {
      id: 'start',
      nummer: 'S',
      laneId: 'lane',
      sectieId: 'main',
      type: 'start',
      activiteit: 'Start',
      naarStap: 'main-end',
    },
    {
      id: 'main-end',
      nummer: 'E',
      laneId: 'lane',
      sectieId: 'main',
      type: 'eind',
      activiteit: 'Hoofdflow klaar',
    },
    {
      id: 'loose-source',
      nummer: 'L1',
      laneId: 'lane',
      sectieId: 'main',
      type: 'actie',
      activiteit: 'Losse subgraph',
      naarStap: 'loose-end',
    },
    {
      id: 'loose-end',
      nummer: 'L2',
      laneId: 'lane',
      sectieId: 'main',
      type: 'eind',
      activiteit: 'Los einde',
    },
  ],
}
const explicietRapport = controleerProcesTegenKader(procesMetExplicieteStart, 'bpmn20')
const explicieteFlow = explicietRapport.controles.find((item) => item.id === 'basis-flow')
assert.equal(explicieteFlow?.status, 'aandacht')
assert.deepEqual(
  explicieteFlow?.stapIds,
  ['loose-source', 'loose-end'],
  'met een expliciete start zijn bronloze losse subgraphs geen extra impliciete ingangen',
)

const procesZonderExplicieteStart: Process = {
  ...procesMetExplicieteStart,
  id: 'impliciete-start-fallback',
  stappen: procesMetExplicieteStart.stappen.filter((stap) => stap.id !== 'start').map((stap) =>
    stap.id === 'main-end'
      ? {
          ...stap,
          id: 'main-source',
          nummer: '1',
          type: 'actie' as const,
          activiteit: 'Eerste bron zonder expliciet startevent',
          naarStap: undefined,
        }
      : stap
  ),
}
const fallbackRapport = controleerProcesTegenKader(procesZonderExplicieteStart, 'bpmn20')
assert.equal(
  fallbackRapport.controles.find((item) => item.id === 'basis-flow')?.status,
  'gevonden',
  'zonder expliciete start blijven alle bronstappen backward-compatible impliciete ingangen',
)
assert.equal(JSON.stringify(proces), snapshot, 'de kadercontrole muteert het proces niet')

console.log(JSON.stringify({
  ok: true,
  checks: {
    stepLinkedFindings: true,
    processLevelFindings: true,
    missingObjectsNotFalselyLinked: true,
    deterministicOrder: true,
    immutableProcess: true,
    backwardCompatibleOptionalField: true,
    explicitStartReachability: true,
    implicitSourceFallback: true,
  },
}))
