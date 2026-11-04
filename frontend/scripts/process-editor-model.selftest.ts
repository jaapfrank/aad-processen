import assert from 'node:assert/strict'
import type { Process } from '../src/contract.ts'
import {
  buildEditorGraph,
  changeStepTypeSafely,
  clearDirectTransition,
  connectSteps,
  createAutoDiagramLayout,
  deleteEditorEdge,
  deleteRoute,
  deleteStepSafely,
  editorNodeId,
  findViewportInsertionPlacement,
  pruneDiagramLayout,
  reconnectEditorEdge,
  routeEdgeId,
  setNodePlacement,
  transitionEdgeId,
  validateEditorProcessStructure,
} from '../src/editor/processEditorModel.ts'

const original: Process = {
  id: 'editor-selftest',
  hoofdproces: 'Test',
  detailproces: 'Editor-model',
  versie: 'V1.0',
  status: 'concept',
  laatsteWijziging: '2026-07-24',
  lanes: [
    { id: 'lane-a', naam: 'A', kleur: '#112233' },
    { id: 'lane-b', naam: 'B', kleur: '#445566' },
  ],
  secties: [{ id: 'section-a', naam: 'Hoofdflow' }],
  stappen: [
    {
      id: 'start',
      nummer: 'S',
      laneId: 'lane-a',
      sectieId: 'section-a',
      type: 'start',
      activiteit: 'Start',
      naarStap: 'decision',
    },
    {
      id: 'decision',
      nummer: '1',
      laneId: 'lane-b',
      sectieId: 'section-a',
      type: 'beslissing',
      activiteit: 'Akkoord?',
      routes: [
        { id: 'yes', label: 'Ja', naarStap: 'end' },
        { id: 'external', label: 'Extern', naarStap: 'end', naarProces: 'other-process' },
      ],
    },
    {
      id: 'end',
      nummer: 'E',
      laneId: 'lane-b',
      type: 'eind',
      activiteit: 'Einde',
    },
    {
      id: 'unknown-lane',
      nummer: '2',
      laneId: 'missing',
      sectieId: 'missing-section',
      type: 'actie',
      activiteit: 'Controle',
    },
  ],
  diagramLayout: {
    version: 1,
    coordinateSystem: 'px96-y-down',
    nodes: {
      'step:start': { x: 99, y: 101 },
      'step:stale': { x: 1, y: 1 },
      'step:end': { x: Number.NaN, y: 1 },
    },
    edges: {
      'transition:start': { sourcePort: 'out' },
      'route:decision:yes': { labelPosition: { x: 20, y: 20 } },
      'route:decision:stale': { sourcePort: 'out' },
    },
  },
}

assert.equal(editorNodeId('start'), 'step:start')
assert.equal(transitionEdgeId('start'), 'transition:start')
assert.equal(routeEdgeId('decision', 'yes'), 'route:decision:yes')

const automatic = createAutoDiagramLayout(original)
assert.deepEqual(
  { version: automatic.version, coordinateSystem: automatic.coordinateSystem },
  { version: 1, coordinateSystem: 'px96-y-down' },
)
assert.equal(automatic.nodes['step:start'].x, 20)
assert.equal(automatic.nodes['step:decision'].x, 260)
assert.equal(automatic.nodes['step:unknown-lane'].x, 500)
assert.ok(automatic.nodes['step:unknown-lane'].y > automatic.nodes['step:end'].y)

const graphLayoutProcess: Process = {
  ...original,
  id: 'graph-layout',
  lanes: [
    { id: 'lane-a', naam: 'A', kleur: '#112233' },
    { id: 'lane-b', naam: 'B', kleur: '#445566' },
    { id: 'lane-c', naam: 'C', kleur: '#778899' },
  ],
  secties: [
    { id: 'later', naam: 'Later in document' },
    { id: 'main', naam: 'Main' },
  ],
  // Bewust niet in flowvolgorde: de relaties, niet de arrayvolgorde,
  // bepalen de verticale lagen.
  stappen: [
    {
      id: 'loose',
      nummer: 'L',
      laneId: 'lane-a',
      sectieId: 'later',
      type: 'actie',
      activiteit: 'Losse notitie',
    },
    {
      id: 'end',
      nummer: 'E',
      laneId: 'lane-b',
      sectieId: 'main',
      type: 'eind',
      activiteit: 'Einde',
    },
    {
      id: 'route-no',
      nummer: '3B',
      laneId: 'lane-c',
      sectieId: 'main',
      type: 'actie',
      activiteit: 'Nee-pad',
      naarStap: 'end',
    },
    {
      id: 'decision',
      nummer: '2',
      laneId: 'lane-b',
      sectieId: 'main',
      type: 'beslissing',
      activiteit: 'Akkoord?',
      routes: [
        { id: 'yes', label: 'Ja', naarStap: 'route-yes' },
        { id: 'no', label: 'Nee', naarStap: 'route-no' },
      ],
    },
    {
      id: 'start',
      nummer: 'S',
      laneId: 'lane-b',
      sectieId: 'main',
      type: 'start',
      activiteit: 'Start',
      naarStap: 'decision',
    },
    {
      id: 'route-yes',
      nummer: '3A',
      laneId: 'lane-a',
      sectieId: 'main',
      type: 'actie',
      activiteit: 'Ja-pad',
      naarStap: 'end',
    },
  ],
  diagramLayout: undefined,
}
const graphLayout = createAutoDiagramLayout(graphLayoutProcess)
assert.equal(graphLayout.nodes['step:start'].y, 76, 'start belongs at the top')
assert.equal(
  graphLayout.nodes['step:decision'].y - graphLayout.nodes['step:start'].y,
  136,
  'connected steps occupy consecutive flow layers',
)
assert.equal(
  graphLayout.nodes['step:route-yes'].y,
  graphLayout.nodes['step:route-no'].y,
  'decision branches in different lanes run in parallel',
)
assert.ok(
  graphLayout.nodes['step:end'].y > graphLayout.nodes['step:route-yes'].y,
  'a merge follows both branches',
)
assert.ok(
  graphLayout.nodes['step:loose'].y > graphLayout.nodes['step:end'].y,
  'a disconnected node is placed after the connected start flow',
)
for (const [stepId, laneIndex] of [
  ['route-yes', 0],
  ['start', 1],
  ['decision', 1],
  ['end', 1],
  ['route-no', 2],
] as const) {
  const placement = graphLayout.nodes[`step:${stepId}`]
  assert.equal(
    placement.x + 100,
    laneIndex * 240 + 120,
    `${stepId} is exactly centred in its lane`,
  )
}
assert.deepEqual(
  createAutoDiagramLayout(graphLayoutProcess),
  graphLayout,
  'auto-layout must be deterministic',
)

const viewportInsertion = findViewportInsertionPlacement(
  graphLayoutProcess,
  { centerX: 2 * 240 + 40, topY: 900 },
)
assert(viewportInsertion, 'a process with lanes must have a viewport insertion position')
assert.equal(viewportInsertion.laneId, 'lane-c')
assert.deepEqual(
  viewportInsertion.placement,
  { x: 500, y: 920, width: 200, height: 96 },
  'new nodes are centred in the nearest lane at the visible viewport top',
)
const viewportWithCollision: Process = {
  ...graphLayoutProcess,
  diagramLayout: {
    version: 1,
    coordinateSystem: 'px96-y-down',
    nodes: {
      ...graphLayout.nodes,
      'step:route-no': { x: 500, y: 430, width: 200, height: 120 },
    },
  },
}
const collisionSafeInsertion = findViewportInsertionPlacement(
  viewportWithCollision,
  { centerX: 560, topY: 420 },
)
assert(collisionSafeInsertion)
assert.equal(collisionSafeInsertion.placement.y, 566)
assert.equal(collisionSafeInsertion.placement.width, 200)
assert.deepEqual(
  viewportWithCollision.diagramLayout?.nodes['step:start'],
  graphLayout.nodes['step:start'],
  'calculating an insertion position never mutates stored manual layout',
)
const preferredLaneInsertion = findViewportInsertionPlacement(
  graphLayoutProcess,
  { centerX: -10_000, topY: -10_000 },
  'lane-b',
  { width: 999, height: 20 },
)
assert(preferredLaneInsertion)
assert.equal(preferredLaneInsertion.laneId, 'lane-b')
assert.equal(preferredLaneInsertion.placement.x, 252)
assert.equal(preferredLaneInsertion.placement.y, 324)
assert.equal(preferredLaneInsertion.placement.width, 216)
assert.equal(preferredLaneInsertion.placement.height, 72)
assert.equal(
  findViewportInsertionPlacement({ ...graphLayoutProcess, lanes: [] }, { centerX: 0, topY: 0 }),
  undefined,
)

const sameLaneBranches: Process = {
  ...graphLayoutProcess,
  id: 'same-lane-branches',
  stappen: graphLayoutProcess.stappen.map((step) => {
    if (step.id === 'route-no') return { ...step, laneId: 'lane-a' }
    return step
  }),
}
const sameLaneLayout = createAutoDiagramLayout(sameLaneBranches)
assert.notEqual(
  sameLaneLayout.nodes['step:route-yes'].y,
  sameLaneLayout.nodes['step:route-no'].y,
  'parallel branches in one lane must not overlap',
)
assert.ok(
  sameLaneLayout.nodes['step:end'].y >
    Math.max(
      sameLaneLayout.nodes['step:route-yes'].y,
      sameLaneLayout.nodes['step:route-no'].y,
    ),
  'the next layer starts below the complete branch band',
)
const occupiedPositions = new Set<string>()
for (const placement of Object.values(sameLaneLayout.nodes)) {
  const key = `${placement.x}:${placement.y}`
  assert.equal(occupiedPositions.has(key), false, `overlapping placement ${key}`)
  occupiedPositions.add(key)
}

const cyclicProcess: Process = {
  ...graphLayoutProcess,
  id: 'cyclic-layout',
  stappen: [
    {
      id: 'cycle-b',
      nummer: '2',
      laneId: 'lane-c',
      type: 'actie',
      activiteit: 'Terug',
      naarStap: 'cycle-a',
    },
    {
      id: 'cycle-a',
      nummer: '1',
      laneId: 'lane-a',
      type: 'actie',
      activiteit: 'Heen',
      naarStap: 'cycle-b',
    },
    {
      id: 'cycle-start',
      nummer: 'S',
      laneId: 'lane-b',
      type: 'start',
      activiteit: 'Start',
      naarStap: 'cycle-a',
    },
  ],
}
const cyclicLayout = createAutoDiagramLayout(cyclicProcess)
assert.equal(cyclicLayout.nodes['step:cycle-start'].y, 76)
assert.equal(
  cyclicLayout.nodes['step:cycle-a'].y,
  cyclicLayout.nodes['step:cycle-b'].y,
  'members of a cross-lane cycle share a safe condensed layer',
)
assert.ok(cyclicLayout.nodes['step:cycle-a'].y > cyclicLayout.nodes['step:cycle-start'].y)
assert.deepEqual(createAutoDiagramLayout(cyclicProcess), cyclicLayout)

const graph = buildEditorGraph(original)
assert.equal(graph.nodes.length, 4)
assert.deepEqual(graph.nodes.find((node) => node.stepId === 'start')?.position, { x: 99, y: 101 })
assert.deepEqual(
  graph.nodes.find((node) => node.stepId === 'end')?.position,
  automatic.nodes['step:end'],
)
assert.deepEqual(
  graph.edges.map((edge) => edge.id),
  ['transition:start', 'route:decision:yes', 'route:decision:external'],
)

const pruned = pruneDiagramLayout(original)
assert.deepEqual(Object.keys(pruned.diagramLayout?.nodes ?? {}), ['step:start'])
assert.deepEqual(
  Object.keys(pruned.diagramLayout?.edges ?? {}),
  ['route:decision:yes', 'transition:start'],
)
assert.ok('step:stale' in original.diagramLayout!.nodes, 'pruning must be immutable')

const placed = setNodePlacement(original, 'end', { x: 700, y: 800, width: 200, height: 72 })
assert.equal(placed.ok, true)
assert.deepEqual(placed.process.diagramLayout?.nodes['step:end'], {
  x: 700,
  y: 800,
  width: 200,
  height: 72,
})
assert.equal(setNodePlacement(original, 'end', { x: Number.POSITIVE_INFINITY, y: 1 }).ok, false)

const directBase: Process = {
  ...original,
  stappen: original.stappen.map((step) =>
    step.id === 'start' ? { ...step, naarStap: undefined } : step,
  ),
}
const connected = connectSteps(directBase, 'start', 'end')
assert.equal(connected.ok, true)
assert.equal(connected.process.stappen.find((step) => step.id === 'start')?.naarStap, 'end')
assert.equal(original.stappen.find((step) => step.id === 'start')?.naarStap, 'decision')
assert.equal(connectSteps(connected.process, 'start', 'decision').ok, false)
assert.equal(connectSteps(original, 'end', 'start').ok, false)
assert.equal(connectSteps(original, 'start', 'start').ok, false)

const routeBase: Process = {
  ...original,
  stappen: original.stappen.map((step) =>
    step.id === 'decision' ? { ...step, routes: undefined } : step,
  ),
}
const routeConnected = connectSteps(routeBase, 'decision', 'end', ' Opnieuw ')
assert.equal(routeConnected.ok, true)
const newRoute = routeConnected.process.stappen.find((step) => step.id === 'decision')?.routes?.[0]
assert.deepEqual(newRoute, { id: 'route-opnieuw', label: 'Opnieuw', naarStap: 'end' })
assert.equal(connectSteps(routeConnected.process, 'decision', 'start', 'opnieuw').ok, false)

const reconnected = reconnectEditorEdge(original, 'route:decision:yes', 'start')
assert.equal(reconnected.ok, true)
assert.equal(
  reconnected.process.stappen.find((step) => step.id === 'decision')?.routes?.[0].naarStap,
  'start',
)
assert.equal(reconnectEditorEdge(original, 'route:decision:missing', 'start').ok, false)
const transitionReconnected = reconnectEditorEdge(original, 'transition:start', 'end')
assert.equal(transitionReconnected.ok, true)
assert.equal(
  transitionReconnected.process.stappen.find((step) => step.id === 'start')?.naarStap,
  'end',
)
const duplicateRouteProcess: Process = {
  ...original,
  stappen: original.stappen.map((step) =>
    step.id === 'decision'
      ? { ...step, routes: [...(step.routes ?? []), { id: 'yes', label: 'Dubbel', naarStap: 'start' }] }
      : step,
  ),
}
assert.equal(
  buildEditorGraph(duplicateRouteProcess).edges.some((edge) => edge.id === 'route:decision:yes'),
  false,
)
assert.equal(deleteEditorEdge(duplicateRouteProcess, 'route:decision:yes').ok, false)

const edgeDeleted = deleteEditorEdge(original, 'transition:start')
assert.equal(edgeDeleted.ok, true)
assert.equal(edgeDeleted.process.stappen.find((step) => step.id === 'start')?.naarStap, undefined)
const routeDeleted = deleteEditorEdge(original, 'route:decision:yes')
assert.equal(routeDeleted.ok, true)
assert.deepEqual(
  routeDeleted.process.stappen.find((step) => step.id === 'decision')?.routes,
  [{ id: 'external', label: 'Extern', naarStap: 'end', naarProces: 'other-process' }],
)
assert.equal(deleteEditorEdge(original, 'transition:missing').ok, false)

const stepDeleted = deleteStepSafely(original, 'end')
assert.equal(stepDeleted.ok, true)
assert.equal(stepDeleted.process.stappen.some((step) => step.id === 'end'), false)
const remainingDecision = stepDeleted.process.stappen.find((step) => step.id === 'decision')
assert.deepEqual(remainingDecision?.routes, [
  { id: 'external', label: 'Extern', naarStap: undefined, naarProces: 'other-process' },
])
assert.equal(stepDeleted.process.diagramLayout?.nodes['step:end'], undefined)
assert.equal(deleteStepSafely(original, 'missing').ok, false)

const danglingTransition: Process = {
  ...original,
  stappen: original.stappen.map((step) =>
    step.id === 'start' ? { ...step, naarStap: 'missing-target' } : step,
  ),
}
const clearedDanglingTransition = clearDirectTransition(danglingTransition, 'start')
assert.equal(clearedDanglingTransition.ok, true)
assert.equal(
  clearedDanglingTransition.process.stappen.find((step) => step.id === 'start')?.naarStap,
  undefined,
)
assert.equal(clearDirectTransition(directBase, 'start').ok, false)

const duplicateSource: Process = {
  ...original,
  stappen: [...original.stappen, { ...original.stappen[0], activiteit: 'Dubbele bron' }],
}
assert.equal(clearDirectTransition(duplicateSource, 'start').ok, false)

const targetlessRoute: Process = {
  ...original,
  stappen: original.stappen.map((step) =>
    step.id === 'decision'
      ? { ...step, routes: [{ id: 'orphan', label: 'Losse route' }] }
      : step,
  ),
}
const targetlessRouteDeleted = deleteRoute(targetlessRoute, 'decision', 'orphan')
assert.equal(targetlessRouteDeleted.ok, true)
assert.equal(
  targetlessRouteDeleted.process.stappen.find((step) => step.id === 'decision')?.routes,
  undefined,
)
assert.equal(deleteRoute(targetlessRoute, 'decision', 'missing').ok, false)
assert.equal(deleteRoute(duplicateRouteProcess, 'decision', 'yes').ok, false)
assert.equal(deleteRoute(duplicateSource, 'start', 'anything').ok, false)

const decisionCleanupRejected = changeStepTypeSafely(original, 'decision', 'actie')
assert.equal(decisionCleanupRejected.ok, false)
assert.equal(decisionCleanupRejected.issues[0]?.code, 'step-type-cleanup-required')
assert.equal(
  decisionCleanupRejected.process.stappen.find((step) => step.id === 'decision')?.type,
  'beslissing',
)
const decisionCleanupAccepted = changeStepTypeSafely(original, 'decision', 'actie', true)
assert.equal(decisionCleanupAccepted.ok, true)
assert.equal(
  decisionCleanupAccepted.process.stappen.find((step) => step.id === 'decision')?.routes,
  undefined,
)

const messageProcess: Process = {
  ...original,
  stappen: original.stappen.map((step) =>
    step.id === 'unknown-lane'
      ? { ...step, laneId: 'lane-a', type: 'bericht', doelLaneId: 'lane-b' }
      : step,
  ),
}
assert.equal(changeStepTypeSafely(messageProcess, 'unknown-lane', 'actie').ok, false)
const messageCleanupAccepted = changeStepTypeSafely(messageProcess, 'unknown-lane', 'actie', true)
assert.equal(messageCleanupAccepted.ok, true)
assert.equal(
  messageCleanupAccepted.process.stappen.find((step) => step.id === 'unknown-lane')?.doelLaneId,
  undefined,
)

const towardDecisionRejected = changeStepTypeSafely(original, 'start', 'beslissing')
assert.equal(towardDecisionRejected.ok, false)
const towardDecisionAccepted = changeStepTypeSafely(original, 'start', 'beslissing', true)
assert.equal(towardDecisionAccepted.ok, true)
assert.equal(
  towardDecisionAccepted.process.stappen.find((step) => step.id === 'start')?.naarStap,
  undefined,
)

const mixedSemantics: Process = {
  ...original,
  stappen: original.stappen.map((step) =>
    step.id === 'start'
      ? {
          ...step,
          routes: [{ id: 'legacy', label: 'Oud', naarStap: 'end' }],
          doelLaneId: 'lane-b',
        }
      : step,
  ),
}
assert.equal(changeStepTypeSafely(mixedSemantics, 'start', 'eind').ok, false)
const endCleanupAccepted = changeStepTypeSafely(mixedSemantics, 'start', 'eind', true)
assert.equal(endCleanupAccepted.ok, true)
assert.deepEqual(
  endCleanupAccepted.process.stappen.find((step) => step.id === 'start'),
  {
    ...mixedSemantics.stappen.find((step) => step.id === 'start'),
    type: 'eind',
    naarStap: undefined,
    routes: undefined,
    doelLaneId: undefined,
  },
)

const validStructure: Process = {
  id: 'valid-process',
  hoofdproces: 'Test',
  detailproces: 'Validatie',
  versie: 'V1.0',
  status: 'concept',
  laatsteWijziging: '2026-07-24',
  lanes: [
    { id: 'lane-a', naam: 'A', kleur: '#123ABC' },
    { id: 'lane-b', naam: 'B', kleur: '#abcdef' },
  ],
  secties: [{ id: 'main', naam: 'Hoofdflow' }],
  stappen: [
    {
      id: 'start',
      nummer: 'S',
      laneId: 'lane-a',
      sectieId: 'main',
      type: 'start',
      activiteit: 'Start',
      naarStap: 'choice',
    },
    {
      id: 'choice',
      nummer: '1',
      laneId: 'lane-a',
      sectieId: 'main',
      type: 'beslissing',
      activiteit: 'Keuze',
      routes: [
        { id: 'yes', label: 'Ja', naarStap: 'end-a' },
        { id: 'no', label: 'Nee', naarStap: 'end-b', standaard: true },
      ],
    },
    {
      id: 'end-a',
      nummer: 'E1',
      laneId: 'lane-a',
      sectieId: 'main',
      type: 'eind',
      activiteit: 'Einde A',
    },
    {
      id: 'end-b',
      nummer: 'E2',
      laneId: 'lane-b',
      sectieId: 'main',
      type: 'eind',
      activiteit: 'Einde B',
    },
  ],
}
assert.deepEqual(validateEditorProcessStructure(validStructure), { ok: true, issues: [] })

const invalidStructure: Process = {
  ...validStructure,
  id: ' ',
  lanes: [
    { id: 'lane-a', naam: 'A', kleur: '#12345' },
    { id: ' LANE-A ', naam: 'Dubbel', kleur: 'red' },
  ],
  secties: [
    { id: 'main', naam: 'Hoofdflow' },
    { id: 'MAIN', naam: 'Dubbel' },
  ],
  stappen: [
    ...validStructure.stappen,
    { ...validStructure.stappen[0], activiteit: 'Dubbele stap' },
    {
      id: 'broken-end',
      nummer: 'E3',
      laneId: 'missing-lane',
      sectieId: 'missing-section',
      type: 'eind',
      activiteit: 'Invalide einde',
      naarStap: 'missing-step',
      doelLaneId: 'lane-a',
      routes: [
        { id: 'same', label: 'Dubbel', standaard: true },
        {
          id: 'same',
          label: 'dubbel',
          naarStap: 'missing-step',
          naarProces: 'other-process',
          standaard: true,
        },
      ],
    },
  ],
}
const invalidCodes = new Set(
  validateEditorProcessStructure(invalidStructure).issues.map((issue) => issue.code),
)
for (const expectedCode of [
  'process-id-required',
  'lane-id-duplicate',
  'lane-color-invalid',
  'section-id-duplicate',
  'step-id-duplicate',
  'step-lane-invalid',
  'step-section-invalid',
  'transition-target-invalid',
  'message-lane-on-wrong-type',
  'routes-on-wrong-type',
  'end-has-outgoing-semantics',
  'route-id-duplicate',
  'route-label-duplicate',
  'route-target-required',
  'route-target-ambiguous',
  'route-step-target-invalid',
  'default-route-duplicate',
]) {
  assert.ok(invalidCodes.has(expectedCode), `expected validation issue ${expectedCode}`)
}

console.log(JSON.stringify({
  ok: true,
  checks: {
    stableIds: true,
    deterministicAutoLayout: true,
    semanticGraphAutoLayout: true,
    parallelDecisionRoutes: true,
    centeredLanePlacement: true,
    viewportInsertion: true,
    overlapPrevention: true,
    cycleSafeLayout: true,
    safeStoredLayoutFallback: true,
    layoutPruning: true,
    immutablePlacement: true,
    directConnectReconnectDelete: true,
    routeConnectReconnectDelete: true,
    safeStepDeleteReferenceCleanup: true,
    targetIndependentEdgeDelete: true,
    controlledStepTypeCleanup: true,
    structuralValidation: true,
  },
}))
