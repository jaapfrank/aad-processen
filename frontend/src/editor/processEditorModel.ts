import type {
  Process,
  ProcessDiagramLayout,
  ProcessEdgePlacement,
  ProcessNodePlacement,
  Step,
  StepType,
} from '../contract'

const NODE_PREFIX = 'step:'
const TRANSITION_PREFIX = 'transition:'
const ROUTE_PREFIX = 'route:'
const COLUMN_WIDTH = 240
const DEFAULT_NODE_WIDTH = 200
const NODE_X_INSET = (COLUMN_WIDTH - DEFAULT_NODE_WIDTH) / 2
const START_Y = 76
const ROW_HEIGHT = 136
const COMPONENT_GAP_ROWS = 1
const MAX_COORDINATE = 1_000_000
const MAX_ROUTES_PER_STEP = 50
const MAX_EDGE_WAYPOINTS = 1_000

export type DiagramNodePlacement = ProcessNodePlacement
export type DiagramEdgePlacement = ProcessEdgePlacement
export type EditorDiagramLayout = ProcessDiagramLayout
export type EditorProcess = Process
type EditorStepRoute = NonNullable<Step['routes']>[number]

export interface EditorNodeDescriptor {
  id: string
  stepId: string
  laneId: string
  sectionId?: string
  position: DiagramNodePlacement
}

export type EditorEdgeKind = 'transition' | 'route'

export interface EditorEdgeDescriptor {
  id: string
  kind: EditorEdgeKind
  source: string
  target: string
  sourceStepId: string
  targetStepId: string
  label?: string
  routeId?: string
}

export interface EditorGraph {
  nodes: EditorNodeDescriptor[]
  edges: EditorEdgeDescriptor[]
}

export interface EditorModelIssue {
  code: string
  message: string
  elementId?: string
}

export type EditorMutationResult =
  | { ok: true; process: EditorProcess; issues: [] }
  | { ok: false; process: EditorProcess; issues: EditorModelIssue[] }

export interface EditorStructureValidationResult {
  ok: boolean
  issues: EditorModelIssue[]
}

export interface ViewportInsertionPlacement {
  laneId: string
  placement: DiagramNodePlacement
}

export function editorNodeId(stepId: string): string {
  return `${NODE_PREFIX}${stepId}`
}

export function transitionEdgeId(sourceStepId: string): string {
  return `${TRANSITION_PREFIX}${sourceStepId}`
}

export function routeEdgeId(sourceStepId: string, routeId: string): string {
  return `${ROUTE_PREFIX}${sourceStepId}:${routeId}`
}

export function messageEdgeId(sourceStepId: string): string {
  return `message:${sourceStepId}`
}

/**
 * Bepaalt een voorspelbare, vrije invoegpositie bovenin de actuele viewport.
 *
 * De UI levert uitsluitend de flow-coördinaten van het zichtbare midden en
 * de zichtbare bovenrand. Daardoor blijft deze regel zonder browser of
 * ReactFlow testbaar. Een nieuwe kaart krijgt altijd een veilige
 * standaardbreedte en wordt exact in de dichtstbijzijnde geldige lane
 * gecentreerd. Bestaande handmatige posities worden alleen gelezen.
 */
export function findViewportInsertionPlacement(
  process: Process,
  viewport: { centerX: number; topY: number },
  preferredLaneId?: string,
  dimensions: { width?: number; height?: number } = {},
): ViewportInsertionPlacement | undefined {
  if (process.lanes.length === 0) return undefined

  const preferredIndex = preferredLaneId
    ? process.lanes.findIndex((lane) => lane.id === preferredLaneId)
    : -1
  const rawLaneIndex = Number.isFinite(viewport.centerX)
    ? Math.floor(viewport.centerX / COLUMN_WIDTH)
    : 0
  const laneIndex = preferredIndex >= 0
    ? preferredIndex
    : Math.max(0, Math.min(process.lanes.length - 1, rawLaneIndex))
  const lane = process.lanes[laneIndex]
  const width = Math.max(160, Math.min(dimensions.width ?? DEFAULT_NODE_WIDTH, COLUMN_WIDTH - 24))
  const height = Math.max(72, Math.min(dimensions.height ?? 96, 360))
  const occupied = buildEditorGraph(process).nodes
    .filter((node) => node.laneId === lane.id)
    .map((node) => ({
      top: node.position.y,
      bottom: node.position.y + (node.position.height ?? 96),
    }))

  let y = Math.max(
    START_Y,
    (Number.isFinite(viewport.topY) ? viewport.topY : START_Y) + 20,
  )
  const verticalGap = 16
  while (occupied.some((node) =>
    y < node.bottom + verticalGap && y + height + verticalGap > node.top
  )) {
    const blockers = occupied.filter((node) =>
      y < node.bottom + verticalGap && y + height + verticalGap > node.top
    )
    y = Math.max(...blockers.map((node) => node.bottom)) + verticalGap
  }

  return {
    laneId: lane.id,
    placement: {
      x: laneIndex * COLUMN_WIDTH + (COLUMN_WIDTH - width) / 2,
      y,
      width,
      height,
    },
  }
}

export function createAutoDiagramLayout(process: Process): EditorDiagramLayout {
  const laneIndexes = new Map(process.lanes.map((lane, index) => [lane.id, index]))
  const orderedSteps = orderedStepsForLayout(process)
  const stepOrder = new Map(orderedSteps.map((step, index) => [step.id, index]))
  const stepsById = new Map(orderedSteps.map((step) => [step.id, step]))
  const adjacency = layoutAdjacency(orderedSteps, stepsById)
  const stronglyConnected = stronglyConnectedComponents(orderedSteps, adjacency, stepOrder)
  const componentIndex = new Map<string, number>()
  stronglyConnected.forEach((component, index) => {
    for (const stepId of component) componentIndex.set(stepId, index)
  })
  const componentAdjacency = stronglyConnected.map(() => new Set<number>())
  const componentIncoming = stronglyConnected.map(() => new Set<number>())
  for (const [sourceId, targets] of adjacency) {
    const sourceComponent = componentIndex.get(sourceId)
    if (sourceComponent === undefined) continue
    for (const targetId of targets) {
      const targetComponent = componentIndex.get(targetId)
      if (targetComponent === undefined || sourceComponent === targetComponent) continue
      componentAdjacency[sourceComponent].add(targetComponent)
      componentIncoming[targetComponent].add(sourceComponent)
    }
  }

  const componentOrder = stronglyConnected.map((component) =>
    Math.min(...component.map((stepId) => stepOrder.get(stepId) ?? Number.MAX_SAFE_INTEGER)),
  )
  const componentHasStart = stronglyConnected.map((component) =>
    component.some((stepId) => stepsById.get(stepId)?.type === 'start'),
  )
  const flowComponents = weakComponentGroups(
    stronglyConnected.length,
    componentAdjacency,
    componentIncoming,
  ).sort((left, right) => {
    const leftHasStart = left.some((index) => componentHasStart[index])
    const rightHasStart = right.some((index) => componentHasStart[index])
    if (leftHasStart !== rightHasStart) return leftHasStart ? -1 : 1
    return minimumComponentOrder(left, componentOrder) -
      minimumComponentOrder(right, componentOrder)
  })

  const nodes: Record<string, DiagramNodePlacement> = {}
  let nextRow = 0

  for (const flowComponent of flowComponents) {
    const ranks = rankDirectedComponents(
      flowComponent,
      componentAdjacency,
      componentIncoming,
      componentHasStart,
      componentOrder,
    )
    const componentsByRank = new Map<number, number[]>()
    for (const component of flowComponent) {
      const rank = ranks.get(component) ?? 0
      const atRank = componentsByRank.get(rank) ?? []
      atRank.push(component)
      componentsByRank.set(rank, atRank)
    }

    for (const rank of [...componentsByRank.keys()].sort((left, right) => left - right)) {
      const rankedComponents = componentsByRank.get(rank)!.sort((left, right) => {
        if (componentHasStart[left] !== componentHasStart[right]) {
          return componentHasStart[left] ? -1 : 1
        }
        return componentOrder[left] - componentOrder[right]
      })
      const rankedSteps = rankedComponents
        .flatMap((component) => stronglyConnected[component])
        .sort((left, right) => {
          const leftIsStart = stepsById.get(left)?.type === 'start'
          const rightIsStart = stepsById.get(right)?.type === 'start'
          if (leftIsStart !== rightIsStart) return leftIsStart ? -1 : 1
          return (stepOrder.get(left) ?? Number.MAX_SAFE_INTEGER) -
            (stepOrder.get(right) ?? Number.MAX_SAFE_INTEGER)
        })
      const laneOffsets = new Map<number, number>()

      for (const stepId of rankedSteps) {
        const step = stepsById.get(stepId)
        if (!step) continue
        // Unknown lanes share one visible deterministic overflow column. They
        // are never silently treated as the first role.
        const laneIndex = laneIndexes.get(step.laneId) ?? process.lanes.length
        const laneOffset = laneOffsets.get(laneIndex) ?? 0
        nodes[editorNodeId(step.id)] = {
          x: laneIndex * COLUMN_WIDTH + NODE_X_INSET,
          y: START_Y + (nextRow + laneOffset) * ROW_HEIGHT,
        }
        laneOffsets.set(laneIndex, laneOffset + 1)
      }

      const bandHeight = Math.max(1, ...laneOffsets.values())
      nextRow += bandHeight
    }

    nextRow += COMPONENT_GAP_ROWS
  }

  return {
    version: 1,
    coordinateSystem: 'px96-y-down',
    nodes,
  }
}

export function buildEditorGraph(process: Process): EditorGraph {
  const editorProcess = process as EditorProcess
  const automatic = createAutoDiagramLayout(process)
  const stored = editorProcess.diagramLayout?.nodes ?? {}
  const knownStepIds = uniqueStepIds(process)
  const nodes: EditorNodeDescriptor[] = []
  const seenNodes = new Set<string>()

  for (const step of orderedStepsForLayout(process)) {
    if (!knownStepIds.has(step.id)) continue
    const id = editorNodeId(step.id)
    if (seenNodes.has(id)) continue
    seenNodes.add(id)
    const candidate = stored[id]
    nodes.push({
      id,
      stepId: step.id,
      laneId: step.laneId,
      sectionId: step.sectieId,
      position: isValidPlacement(candidate) ? { ...candidate } : { ...automatic.nodes[id] },
    })
  }

  const candidates = semanticEdgeCandidates(process)
  const edgeCounts = countBy(candidates, (edge) => edge.id)
  const edges = candidates.filter((edge) => edgeCounts.get(edge.id) === 1)

  return { nodes, edges }
}

export function setNodePlacement(
  process: Process,
  stepId: string,
  placement: DiagramNodePlacement,
): EditorMutationResult {
  const current = process as EditorProcess
  if (!hasUniqueStep(process, stepId)) {
    return failure(current, 'step-not-found', `Stap '${stepId}' bestaat niet eenduidig.`, stepId)
  }
  if (!isValidPlacement(placement)) {
    return failure(
      current,
      'placement-invalid',
      'Een diagrampositie moet eindige x/y-coördinaten binnen de veilige grens bevatten.',
      editorNodeId(stepId),
    )
  }

  const pruned = pruneDiagramLayout(current)
  const baseLayout = pruned.diagramLayout ?? createEmptyDiagramLayout()
  return success({
    ...pruned,
    diagramLayout: {
      ...baseLayout,
      nodes: {
        ...baseLayout.nodes,
        [editorNodeId(stepId)]: { ...placement },
      },
    },
  })
}

export function pruneDiagramLayout(process: Process): EditorProcess {
  const current = process as EditorProcess
  if (!current.diagramLayout) return current

  const validNodeIds = new Set(uniqueSteps(process).map((step) => editorNodeId(step.id)))
  const validEdgeIds = semanticLayoutEdgeIds(process)
  const nodes = Object.fromEntries(
    Object.entries(current.diagramLayout.nodes ?? {})
      .filter(([id, placement]) => validNodeIds.has(id) && isValidPlacement(placement))
      .sort(([left], [right]) => left.localeCompare(right)),
  )
  const retainedEdges = Object.fromEntries(
    Object.entries(current.diagramLayout.edges ?? {})
      .filter(([id, placement]) => validEdgeIds.has(id) && isValidEdgePlacement(placement))
      .sort(([left], [right]) => left.localeCompare(right)),
  )

  return {
    ...current,
    diagramLayout: {
      version: 1,
      coordinateSystem: 'px96-y-down',
      nodes,
      ...(Object.keys(retainedEdges).length > 0 ? { edges: retainedEdges } : {}),
    },
  }
}

export function connectSteps(
  process: Process,
  sourceId: string,
  targetId: string,
  routeLabel?: string,
): EditorMutationResult {
  const current = process as EditorProcess
  const endpoints = validateEndpoints(process, sourceId, targetId)
  if (endpoints) return { ok: false, process: current, issues: [endpoints] }
  const source = process.stappen.find((step) => step.id === sourceId)!

  if (routeLabel === undefined) {
    if (source.type === 'eind') {
      return failure(current, 'end-cannot-connect', 'Een eindstap kan geen directe uitgaande verbinding krijgen.', sourceId)
    }
    if (source.type === 'beslissing' || (source.routes?.length ?? 0) > 0) {
      return failure(
        current,
        'direct-edge-conflicts-with-routes',
        'Een beslissing of stap met routes vereist een benoemde routeverbinding.',
        sourceId,
      )
    }
    if (source.naarStap && source.naarStap !== targetId) {
      return failure(
        current,
        'transition-already-exists',
        'De stap heeft al een directe verbinding; gebruik reconnect om het doel expliciet te wijzigen.',
        transitionEdgeId(sourceId),
      )
    }
    return success(replaceStep(current, { ...source, naarStap: targetId }))
  }

  const label = routeLabel.trim()
  if (source.type !== 'beslissing') {
    return failure(current, 'route-source-invalid', 'Alleen een beslissing kan een benoemde route krijgen.', sourceId)
  }
  if (!label) {
    return failure(current, 'route-label-required', 'Een route vereist een niet-leeg label.', sourceId)
  }
  if (source.naarStap) {
    return failure(
      current,
      'route-conflicts-with-transition',
      'Verwijder eerst de directe verbinding voordat routes worden toegevoegd.',
      transitionEdgeId(sourceId),
    )
  }
  const routes = source.routes ?? []
  if (routes.length >= MAX_ROUTES_PER_STEP) {
    return failure(current, 'route-limit-reached', `Een stap ondersteunt maximaal ${MAX_ROUTES_PER_STEP} routes.`, sourceId)
  }
  if (routes.some((route) => route.label.trim().toLowerCase() === label.toLowerCase())) {
    return failure(current, 'route-label-duplicate', `Route-label '${label}' bestaat al voor deze beslissing.`, sourceId)
  }

  const route: EditorStepRoute = {
    id: nextRouteId(routes, label),
    label,
    naarStap: targetId,
  }
  return success(replaceStep(current, { ...source, routes: [...routes, route] }))
}

export function reconnectEditorEdge(
  process: Process,
  edgeId: string,
  targetId: string,
): EditorMutationResult {
  const current = process as EditorProcess
  if (!hasUniqueStep(process, targetId)) {
    return failure(current, 'target-not-found', `Doelstap '${targetId}' bestaat niet eenduidig.`, targetId)
  }
  const edge = findSemanticEdge(process, edgeId)
  if (!edge) {
    return failure(current, 'edge-not-found', `Verbinding '${edgeId}' bestaat niet eenduidig.`, edgeId)
  }
  if (edge.sourceStepId === targetId) {
    return failure(current, 'self-connection', 'Een stap kan niet met zichzelf worden verbonden.', edgeId)
  }
  const source = process.stappen.find((step) => step.id === edge.sourceStepId)!
  if (edge.kind === 'transition') {
    return success(replaceStep(current, { ...source, naarStap: targetId }))
  }
  return success(replaceStep(current, {
    ...source,
    routes: source.routes?.map((route) =>
      route.id === edge.routeId ? { ...route, naarStap: targetId } : route,
    ),
  }))
}

export function deleteEditorEdge(process: Process, edgeId: string): EditorMutationResult {
  const current = process as EditorProcess
  const edge = findSemanticEdge(process, edgeId)
  if (!edge) {
    return failure(current, 'edge-not-found', `Verbinding '${edgeId}' bestaat niet eenduidig.`, edgeId)
  }
  const source = process.stappen.find((step) => step.id === edge.sourceStepId)!
  const updated = edge.kind === 'transition'
    ? { ...source, naarStap: undefined }
    : {
        ...source,
        routes: withoutEmptyArray(source.routes?.filter((route) => route.id !== edge.routeId)),
      }
  return success(pruneDiagramLayout(replaceStep(current, updated)))
}

/**
 * Wist de directe transitie op basis van de semantische eigenaar. Dit werkt
 * ook als het huidige doel ontbreekt en daardoor niet renderbaar is.
 */
export function clearDirectTransition(
  process: Process,
  sourceId: string,
): EditorMutationResult {
  const current = process as EditorProcess
  if (!hasUniqueStep(process, sourceId)) {
    return failure(
      current,
      'source-not-found',
      `Bronstap '${sourceId}' bestaat niet eenduidig.`,
      sourceId,
    )
  }
  const source = process.stappen.find((step) => step.id === sourceId)!
  if (!source.naarStap) {
    return failure(
      current,
      'transition-not-found',
      `Stap '${sourceId}' heeft geen directe transitie.`,
      transitionEdgeId(sourceId),
    )
  }
  return success(pruneDiagramLayout(replaceStep(current, { ...source, naarStap: undefined })))
}

/**
 * Verwijdert één route op basis van source+route-id, onafhankelijk van een
 * geldig/renderbaar doel. Dubbele route-id's worden fail-closed geweigerd.
 */
export function deleteRoute(
  process: Process,
  sourceId: string,
  routeId: string,
): EditorMutationResult {
  const current = process as EditorProcess
  if (!hasUniqueStep(process, sourceId)) {
    return failure(
      current,
      'source-not-found',
      `Bronstap '${sourceId}' bestaat niet eenduidig.`,
      sourceId,
    )
  }
  const source = process.stappen.find((step) => step.id === sourceId)!
  const matches = (source.routes ?? []).filter((route) => route.id === routeId)
  if (matches.length !== 1) {
    return failure(
      current,
      matches.length === 0 ? 'route-not-found' : 'route-id-duplicate',
      matches.length === 0
        ? `Route '${routeId}' bestaat niet op stap '${sourceId}'.`
        : `Route-id '${routeId}' komt meerdere keren voor op stap '${sourceId}'.`,
      routeEdgeId(sourceId, routeId),
    )
  }
  const replacement = {
    ...source,
    routes: withoutEmptyArray(source.routes?.filter((route) => route.id !== routeId)),
  }
  return success(pruneDiagramLayout(replaceStep(current, replacement)))
}

/**
 * Wijzigt een staptype zonder verborgen, incompatibele semantiek te laten
 * staan. Destructieve cleanup moet door de UI expliciet zijn bevestigd.
 */
export function changeStepTypeSafely(
  process: Process,
  stepId: string,
  newType: StepType,
  allowDestructiveCleanup = false,
): EditorMutationResult {
  const current = process as EditorProcess
  if (!hasUniqueStep(process, stepId)) {
    return failure(current, 'step-not-found', `Stap '${stepId}' bestaat niet eenduidig.`, stepId)
  }
  const step = process.stappen.find((candidate) => candidate.id === stepId)!
  if (step.type === newType) return success(current)

  const fieldsToClear = new Set<'naarStap' | 'routes' | 'doelLaneId'>()
  if (newType === 'eind') {
    if (step.naarStap) fieldsToClear.add('naarStap')
    if ((step.routes?.length ?? 0) > 0) fieldsToClear.add('routes')
    if (step.doelLaneId) fieldsToClear.add('doelLaneId')
  }
  if (step.type === 'beslissing' && newType !== 'beslissing' && (step.routes?.length ?? 0) > 0) {
    fieldsToClear.add('routes')
  }
  if (step.type === 'bericht' && newType !== 'bericht' && step.doelLaneId) {
    fieldsToClear.add('doelLaneId')
  }
  if (newType === 'beslissing' && step.naarStap) {
    fieldsToClear.add('naarStap')
  }

  if (fieldsToClear.size > 0 && !allowDestructiveCleanup) {
    const fields = [...fieldsToClear]
    return {
      ok: false,
      process: current,
      issues: [{
        code: 'step-type-cleanup-required',
        message:
          `Typewijziging naar '${newType}' vereist expliciete verwijdering van: ${fields.join(', ')}.`,
        elementId: stepId,
      }],
    }
  }

  const replacement: Step = {
    ...step,
    type: newType,
    ...(fieldsToClear.has('naarStap') ? { naarStap: undefined } : {}),
    ...(fieldsToClear.has('routes') ? { routes: undefined } : {}),
    ...(fieldsToClear.has('doelLaneId') ? { doelLaneId: undefined } : {}),
  }
  return success(pruneDiagramLayout(replaceStep(current, replacement)))
}

export function deleteStepSafely(process: Process, stepId: string): EditorMutationResult {
  const current = process as EditorProcess
  if (!hasUniqueStep(process, stepId)) {
    return failure(current, 'step-not-found', `Stap '${stepId}' bestaat niet eenduidig.`, stepId)
  }

  const steps = process.stappen
    .filter((step) => step.id !== stepId)
    .map((step) => {
      const routes = step.routes?.flatMap((route) => {
        if (route.naarStap !== stepId) return [{ ...route }]
        if (route.naarProces) return [{ ...route, naarStap: undefined }]
        return []
      })
      return {
        ...step,
        ...(step.naarStap === stepId ? { naarStap: undefined } : {}),
        routes: withoutEmptyArray(routes),
      }
    })

  return success(pruneDiagramLayout({ ...current, stappen: steps }))
}

export function validateEditorProcessStructure(
  process: Process,
): EditorStructureValidationResult {
  const issues: EditorModelIssue[] = []
  const processId = process.id.trim()
  if (!processId) {
    issues.push({
      code: 'process-id-required',
      message: 'Het proces-id mag niet leeg zijn.',
    })
  }

  const laneCounts = identifierCounts(process.lanes.map((lane) => lane.id))
  const sectionCounts = identifierCounts(process.secties.map((section) => section.id))
  const stepCounts = identifierCounts(process.stappen.map((step) => step.id))
  validateIdentifiers('lane', process.lanes.map((lane) => lane.id), laneCounts, issues)
  validateIdentifiers('section', process.secties.map((section) => section.id), sectionCounts, issues)
  validateIdentifiers('step', process.stappen.map((step) => step.id), stepCounts, issues)

  for (const lane of process.lanes) {
    if (!/^#[0-9a-f]{6}$/i.test(lane.kleur)) {
      issues.push({
        code: 'lane-color-invalid',
        message: `Lane '${lane.id}' heeft geen geldige zescijferige hexkleur.`,
        elementId: lane.id,
      })
    }
  }

  for (const step of process.stappen) {
    const elementId = step.id
    if (!hasExactlyOneIdentifier(laneCounts, step.laneId)) {
      issues.push({
        code: 'step-lane-invalid',
        message: `Stap '${step.id}' verwijst niet eenduidig naar lane '${step.laneId}'.`,
        elementId,
      })
    }
    if (step.sectieId && !hasExactlyOneIdentifier(sectionCounts, step.sectieId)) {
      issues.push({
        code: 'step-section-invalid',
        message: `Stap '${step.id}' verwijst niet eenduidig naar sectie '${step.sectieId}'.`,
        elementId,
      })
    }
    if (step.naarStap && !hasExactlyOneIdentifier(stepCounts, step.naarStap)) {
      issues.push({
        code: 'transition-target-invalid',
        message: `Stap '${step.id}' verwijst niet eenduidig naar doelstap '${step.naarStap}'.`,
        elementId,
      })
    }
    if (step.naarStap === step.id) {
      issues.push({
        code: 'self-transition-invalid',
        message: `Stap '${step.id}' kan niet direct naar zichzelf verwijzen.`,
        elementId,
      })
    }
    if (step.type === 'bericht') {
      if (!step.doelLaneId || !hasExactlyOneIdentifier(laneCounts, step.doelLaneId)) {
        issues.push({
          code: 'message-lane-invalid',
          message: `Berichtstap '${step.id}' vereist één geldige doel-lane.`,
          elementId,
        })
      }
    } else if (step.doelLaneId) {
      issues.push({
        code: 'message-lane-on-wrong-type',
        message: `Alleen een berichtstap mag een doel-lane bevatten.`,
        elementId,
      })
    }

    const routes = step.routes ?? []
    if (step.type === 'beslissing') {
      if (step.naarStap) {
        issues.push({
          code: 'decision-has-direct-transition',
          message: `Beslissing '${step.id}' mag geen direct vervolg naast routes hebben.`,
          elementId,
        })
      }
      if (routes.length < 2) {
        issues.push({
          code: 'decision-routes-insufficient',
          message: `Beslissing '${step.id}' vereist minimaal twee routes.`,
          elementId,
        })
      }
    } else if (routes.length > 0) {
      issues.push({
        code: 'routes-on-wrong-type',
        message: `Alleen een beslissing mag routes bevatten.`,
        elementId,
      })
    }
    if (step.type === 'eind' && (step.naarStap || routes.length > 0 || step.doelLaneId)) {
      issues.push({
        code: 'end-has-outgoing-semantics',
        message: `Eindstap '${step.id}' mag geen uitgaande stap-, route- of berichtsemantiek bevatten.`,
        elementId,
      })
    }

    const routeCounts = identifierCounts(routes.map((route) => route.id))
    validateIdentifiers('route', routes.map((route) => route.id), routeCounts, issues, step.id)
    const routeLabels = new Set<string>()
    let standardRoutes = 0
    for (const route of routes) {
      const routeElementId = routeEdgeId(step.id, route.id)
      const label = route.label.trim()
      const normalizedLabel = label.toLowerCase()
      if (!label) {
        issues.push({
          code: 'route-label-required',
          message: `Route '${route.id}' op stap '${step.id}' heeft geen label.`,
          elementId: routeElementId,
        })
      } else if (routeLabels.has(normalizedLabel)) {
        issues.push({
          code: 'route-label-duplicate',
          message: `Route-label '${route.label}' komt meerdere keren voor op stap '${step.id}'.`,
          elementId: routeElementId,
        })
      }
      routeLabels.add(normalizedLabel)

      const hasStepTarget = Boolean(route.naarStap)
      const hasProcessTarget = Boolean(route.naarProces)
      if (hasStepTarget === hasProcessTarget) {
        issues.push({
          code: hasStepTarget ? 'route-target-ambiguous' : 'route-target-required',
          message: hasStepTarget
            ? `Route '${route.id}' moet exact één stap- of procesdoel hebben.`
            : `Route '${route.id}' heeft geen stap- of procesdoel.`,
          elementId: routeElementId,
        })
      }
      if (route.naarStap && !hasExactlyOneIdentifier(stepCounts, route.naarStap)) {
        issues.push({
          code: 'route-step-target-invalid',
          message: `Route '${route.id}' verwijst niet eenduidig naar doelstap '${route.naarStap}'.`,
          elementId: routeElementId,
        })
      }
      if (route.naarStap === step.id) {
        issues.push({
          code: 'self-route-invalid',
          message: `Route '${route.id}' kan niet naar de eigen bronstap verwijzen.`,
          elementId: routeElementId,
        })
      }
      if (route.standaard) standardRoutes += 1
    }
    if (standardRoutes > 1) {
      issues.push({
        code: 'default-route-duplicate',
        message: `Stap '${step.id}' heeft meer dan één standaardroute.`,
        elementId,
      })
    }
  }

  return { ok: issues.length === 0, issues }
}

function buildSemanticEdges(process: Process): EditorEdgeDescriptor[] {
  const candidates = semanticEdgeCandidates(process)
  const counts = countBy(candidates, (edge) => edge.id)
  return candidates.filter((edge) => counts.get(edge.id) === 1)
}

function semanticLayoutEdgeIds(process: Process): Set<string> {
  const ids = new Set(buildSemanticEdges(process).map((edge) => edge.id))
  const laneIds = new Set(process.lanes.map((lane) => lane.id))
  for (const step of process.stappen) {
    if (step.type === 'bericht' && step.doelLaneId && laneIds.has(step.doelLaneId)) {
      ids.add(messageEdgeId(step.id))
    }
  }
  return ids
}

function findSemanticEdge(process: Process, edgeId: string): EditorEdgeDescriptor | undefined {
  const matches = semanticEdgeCandidates(process).filter((edge) => edge.id === edgeId)
  return matches.length === 1 ? matches[0] : undefined
}

function semanticEdgeCandidates(process: Process): EditorEdgeDescriptor[] {
  const knownStepIds = uniqueStepIds(process)
  const edges: EditorEdgeDescriptor[] = []
  for (const step of process.stappen) {
    if (!knownStepIds.has(step.id)) continue
    if (step.naarStap && knownStepIds.has(step.naarStap)) {
      edges.push({
        id: transitionEdgeId(step.id),
        kind: 'transition',
        source: editorNodeId(step.id),
        target: editorNodeId(step.naarStap),
        sourceStepId: step.id,
        targetStepId: step.naarStap,
      })
    }
    for (const route of step.routes ?? []) {
      if (!route.naarStap || !knownStepIds.has(route.naarStap)) continue
      edges.push({
        id: routeEdgeId(step.id, route.id),
        kind: 'route',
        source: editorNodeId(step.id),
        target: editorNodeId(route.naarStap),
        sourceStepId: step.id,
        targetStepId: route.naarStap,
        label: route.label,
        routeId: route.id,
      })
    }
  }
  return edges
}

function validateEndpoints(
  process: Process,
  sourceId: string,
  targetId: string,
): EditorModelIssue | undefined {
  if (!hasUniqueStep(process, sourceId)) {
    return {
      code: 'source-not-found',
      message: `Bronstap '${sourceId}' bestaat niet eenduidig.`,
      elementId: sourceId,
    }
  }
  if (!hasUniqueStep(process, targetId)) {
    return {
      code: 'target-not-found',
      message: `Doelstap '${targetId}' bestaat niet eenduidig.`,
      elementId: targetId,
    }
  }
  if (sourceId === targetId) {
    return {
      code: 'self-connection',
      message: 'Een stap kan niet met zichzelf worden verbonden.',
      elementId: sourceId,
    }
  }
  return undefined
}

function orderedStepsForLayout(process: Process): Step[] {
  const knownSections = new Set(process.secties.map((section) => section.id))
  const ordered: Step[] = []
  const included = new Set<string>()
  for (const section of process.secties) {
    for (const step of process.stappen) {
      if (step.sectieId === section.id && !included.has(step.id)) {
        ordered.push(step)
        included.add(step.id)
      }
    }
  }
  for (const step of process.stappen) {
    if ((!step.sectieId || !knownSections.has(step.sectieId)) && !included.has(step.id)) {
      ordered.push(step)
      included.add(step.id)
    }
  }
  return ordered
}

/**
 * Geeft uitsluitend bekende semantische staprelaties terug. De volgorde is
 * bewust direct vervolg, daarna routevolgorde: zo blijft de uitkomst stabiel
 * en volgen parallelle routes de volgorde waarin de gebruiker ze heeft gezet.
 */
function layoutAdjacency(
  orderedSteps: readonly Step[],
  stepsById: ReadonlyMap<string, Step>,
): Map<string, string[]> {
  const adjacency = new Map<string, string[]>()
  for (const step of orderedSteps) {
    const targets: string[] = []
    const included = new Set<string>()
    const include = (targetId: string | undefined) => {
      if (!targetId || !stepsById.has(targetId) || included.has(targetId)) return
      included.add(targetId)
      targets.push(targetId)
    }
    include(step.naarStap)
    for (const route of step.routes ?? []) include(route.naarStap)
    adjacency.set(step.id, targets)
  }
  return adjacency
}

/**
 * Condenseert cycli voordat lagen worden berekend. Elke SCC is één knoop in
 * een gegarandeerd acyclische graaf, waardoor een teruglus nooit een
 * oneindige rangberekening kan veroorzaken.
 */
function stronglyConnectedComponents(
  orderedSteps: readonly Step[],
  adjacency: ReadonlyMap<string, readonly string[]>,
  stepOrder: ReadonlyMap<string, number>,
): string[][] {
  let nextIndex = 0
  const indexByStep = new Map<string, number>()
  const lowLinkByStep = new Map<string, number>()
  const stack: string[] = []
  const onStack = new Set<string>()
  const components: string[][] = []

  const visit = (stepId: string) => {
    const currentIndex = nextIndex
    nextIndex += 1
    indexByStep.set(stepId, currentIndex)
    lowLinkByStep.set(stepId, currentIndex)
    stack.push(stepId)
    onStack.add(stepId)

    for (const targetId of adjacency.get(stepId) ?? []) {
      if (!indexByStep.has(targetId)) {
        visit(targetId)
        lowLinkByStep.set(
          stepId,
          Math.min(lowLinkByStep.get(stepId)!, lowLinkByStep.get(targetId)!),
        )
      } else if (onStack.has(targetId)) {
        lowLinkByStep.set(
          stepId,
          Math.min(lowLinkByStep.get(stepId)!, indexByStep.get(targetId)!),
        )
      }
    }

    if (lowLinkByStep.get(stepId) !== indexByStep.get(stepId)) return
    const component: string[] = []
    let member: string | undefined
    do {
      member = stack.pop()
      if (member === undefined) break
      onStack.delete(member)
      component.push(member)
    } while (member !== stepId)
    component.sort(
      (left, right) =>
        (stepOrder.get(left) ?? Number.MAX_SAFE_INTEGER) -
        (stepOrder.get(right) ?? Number.MAX_SAFE_INTEGER),
    )
    components.push(component)
  }

  for (const step of orderedSteps) {
    if (!indexByStep.has(step.id)) visit(step.id)
  }
  return components
}

/** Groepeert de gecondenseerde graaf op zwakke verbondenheid. */
function weakComponentGroups(
  componentCount: number,
  outgoing: readonly ReadonlySet<number>[],
  incoming: readonly ReadonlySet<number>[],
): number[][] {
  const seen = new Set<number>()
  const groups: number[][] = []
  for (let candidate = 0; candidate < componentCount; candidate += 1) {
    if (seen.has(candidate)) continue
    const group: number[] = []
    const pending = [candidate]
    seen.add(candidate)
    while (pending.length > 0) {
      const current = pending.shift()!
      group.push(current)
      for (const neighbour of [...outgoing[current], ...incoming[current]]) {
        if (seen.has(neighbour)) continue
        seen.add(neighbour)
        pending.push(neighbour)
      }
    }
    groups.push(group)
  }
  return groups
}

function minimumComponentOrder(
  components: readonly number[],
  componentOrder: readonly number[],
): number {
  return Math.min(
    ...components.map((component) => componentOrder[component] ?? Number.MAX_SAFE_INTEGER),
  )
}

/**
 * Berekent langste-padlagen op de gecondenseerde DAG. Startcomponenten
 * blijven op laag nul, ook bij ongeldige inkomende semantiek; zo blijft een
 * start visueel bovenaan zonder dat een foutieve terugverwijzing de layout
 * instabiel maakt.
 */
function rankDirectedComponents(
  flowComponent: readonly number[],
  outgoing: readonly ReadonlySet<number>[],
  incoming: readonly ReadonlySet<number>[],
  hasStart: readonly boolean[],
  componentOrder: readonly number[],
): Map<number, number> {
  const included = new Set(flowComponent)
  const remainingIncoming = new Map<number, number>()
  const ranks = new Map<number, number>()
  const compare = (left: number, right: number) => {
    if (hasStart[left] !== hasStart[right]) return hasStart[left] ? -1 : 1
    return componentOrder[left] - componentOrder[right]
  }
  const ready: number[] = []

  for (const component of flowComponent) {
    const count = [...incoming[component]].filter((source) => included.has(source)).length
    remainingIncoming.set(component, count)
    if (hasStart[component]) ranks.set(component, 0)
    if (count === 0) {
      if (!ranks.has(component)) ranks.set(component, 0)
      ready.push(component)
    }
  }
  ready.sort(compare)

  while (ready.length > 0) {
    const source = ready.shift()!
    const sourceRank = ranks.get(source) ?? 0
    const targets = [...outgoing[source]]
      .filter((target) => included.has(target))
      .sort(compare)
    for (const target of targets) {
      if (!hasStart[target]) {
        ranks.set(target, Math.max(ranks.get(target) ?? 0, sourceRank + 1))
      }
      const remaining = (remainingIncoming.get(target) ?? 0) - 1
      remainingIncoming.set(target, remaining)
      if (remaining === 0) {
        if (!ranks.has(target)) ranks.set(target, 0)
        ready.push(target)
        ready.sort(compare)
      }
    }
  }

  // De SCC-condensatie hoort acyclisch te zijn. Deze fallback houdt een
  // eventueel beschadigd invoermodel alsnog deterministisch en zichtbaar.
  for (const component of [...flowComponent].sort(compare)) {
    if (!ranks.has(component)) ranks.set(component, 0)
  }
  return ranks
}

function uniqueSteps(process: Process): Step[] {
  const counts = new Map<string, number>()
  for (const step of process.stappen) counts.set(step.id, (counts.get(step.id) ?? 0) + 1)
  return process.stappen.filter((step) => counts.get(step.id) === 1)
}

function uniqueStepIds(process: Process): Set<string> {
  return new Set(uniqueSteps(process).map((step) => step.id))
}

function hasUniqueStep(process: Process, stepId: string): boolean {
  return process.stappen.filter((step) => step.id === stepId).length === 1
}

function isValidPlacement(value: unknown): value is DiagramNodePlacement {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<DiagramNodePlacement>
  return isSafeCoordinate(candidate.x) &&
    isSafeCoordinate(candidate.y) &&
    (candidate.width === undefined || isSafeSize(candidate.width)) &&
    (candidate.height === undefined || isSafeSize(candidate.height))
}

function isValidEdgePlacement(value: unknown): value is DiagramEdgePlacement {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as DiagramEdgePlacement
  return (candidate.waypoints === undefined ||
      (Array.isArray(candidate.waypoints) &&
        candidate.waypoints.length <= MAX_EDGE_WAYPOINTS &&
        candidate.waypoints.every(isValidPoint))) &&
    (candidate.labelPosition === undefined || isValidPoint(candidate.labelPosition)) &&
    (candidate.sourcePort === undefined || isSafePort(candidate.sourcePort)) &&
    (candidate.targetPort === undefined || isSafePort(candidate.targetPort))
}

function isSafeCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= MAX_COORDINATE
}

function isSafeSize(value: unknown): value is number {
  return isSafeCoordinate(value) && value > 0
}

function isValidPoint(value: unknown): value is { x: number; y: number } {
  if (!value || typeof value !== 'object') return false
  const candidate = value as { x?: unknown; y?: unknown }
  return isSafeCoordinate(candidate.x) && isSafeCoordinate(candidate.y)
}

function isSafePort(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128
}

function replaceStep(process: EditorProcess, replacement: Step): EditorProcess {
  return {
    ...process,
    stappen: process.stappen.map((step) => step.id === replacement.id ? replacement : step),
  }
}

function withoutEmptyArray<T>(values: T[] | undefined): T[] | undefined {
  return values && values.length > 0 ? values : undefined
}

function identifierCounts(ids: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const id of ids) {
    const normalized = normalizeIdentifier(id)
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1)
  }
  return counts
}

function hasExactlyOneIdentifier(counts: ReadonlyMap<string, number>, id: string): boolean {
  const normalized = normalizeIdentifier(id)
  return normalized.length > 0 && counts.get(normalized) === 1
}

function validateIdentifiers(
  kind: 'lane' | 'section' | 'step' | 'route',
  ids: readonly string[],
  counts: ReadonlyMap<string, number>,
  issues: EditorModelIssue[],
  ownerId?: string,
): void {
  const labels = {
    lane: 'Lane',
    section: 'Sectie',
    step: 'Stap',
    route: 'Route',
  } as const
  const reportedDuplicates = new Set<string>()
  for (const id of ids) {
    const normalized = normalizeIdentifier(id)
    const elementId = kind === 'route' && ownerId !== undefined
      ? routeEdgeId(ownerId, id)
      : id || undefined
    if (!normalized) {
      issues.push({
        code: `${kind}-id-required`,
        message: `${labels[kind]}-id mag niet leeg zijn.`,
        elementId,
      })
    } else if ((counts.get(normalized) ?? 0) > 1 && !reportedDuplicates.has(normalized)) {
      issues.push({
        code: `${kind}-id-duplicate`,
        message: `${labels[kind]}-id '${id}' komt meerdere keren voor.`,
        elementId,
      })
      reportedDuplicates.add(normalized)
    }
  }
}

function normalizeIdentifier(id: string): string {
  return id.trim().toLocaleLowerCase('en-US')
}

function countBy<T>(values: readonly T[], key: (value: T) => string): Map<string, number> {
  const counts = new Map<string, number>()
  for (const value of values) {
    const itemKey = key(value)
    counts.set(itemKey, (counts.get(itemKey) ?? 0) + 1)
  }
  return counts
}

function nextRouteId(routes: readonly EditorStepRoute[], label: string): string {
  const slug = label
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'route'
  const existing = new Set(routes.map((route) => route.id))
  let candidate = `route-${slug}`
  let suffix = 2
  while (existing.has(candidate)) {
    candidate = `route-${slug}-${suffix}`
    suffix += 1
  }
  return candidate
}

function createEmptyDiagramLayout(): EditorDiagramLayout {
  return {
    version: 1,
    coordinateSystem: 'px96-y-down',
    nodes: {},
  }
}

function success(process: EditorProcess): EditorMutationResult {
  return { ok: true, process, issues: [] }
}

function failure(
  process: EditorProcess,
  code: string,
  message: string,
  elementId?: string,
): EditorMutationResult {
  return { ok: false, process, issues: [{ code, message, elementId }] }
}
