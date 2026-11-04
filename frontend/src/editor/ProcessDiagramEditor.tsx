import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  applyNodeChanges,
  type Connection,
  type Edge,
  type NodeChange,
  type ReactFlowInstance,
} from '@xyflow/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Lane, Process, ProcessSummary, Section, Step, StepType } from '../contract'
import { typeLabel } from '../lib/proces'
import type { ProcessMaintenanceIssue } from '@contract/ai-process-steward'
import { EditorLaneNode, EditorStepNode, type ProcessEditorNode } from './EditorNodes'
import {
  AiProcessStewardPanel,
  type AiProcessStewardController,
} from './AiProcessStewardPanel'
import {
  ProcessMaintenanceRunHistory,
  type ProcessMaintenanceRunHistoryController,
} from './ProcessMaintenanceRunHistory'
import {
  buildEditorGraph,
  changeStepTypeSafely,
  clearDirectTransition,
  connectSteps,
  createAutoDiagramLayout,
  deleteEditorEdge,
  deleteRoute,
  deleteStepSafely,
  findViewportInsertionPlacement,
  reconnectEditorEdge,
  setNodePlacement,
  transitionEdgeId,
  validateEditorProcessStructure,
  type EditorMutationResult,
} from './processEditorModel'
import '@xyflow/react/dist/style.css'
import './editor.css'

const LANE_WIDTH = 240
const DEFAULT_NODE_WIDTH = 200
const DEFAULT_NODE_HEIGHT = 96
const MAX_ALIGNED_NODE_WIDTH = LANE_WIDTH - 24
const TOP_ROW_Y = 76
const LANE_BOUNDARY_GUTTER = 24
const EDITOR_MIN_ZOOM = 0.25
const EDITOR_MAX_ZOOM = 2.5
const EDITOR_ZOOM_STEP = 0.1
const HISTORY_LIMIT = 50
const GROUP_WINDOW_MS = 750
const NO_AI_ISSUES: readonly ProcessMaintenanceIssue[] = []

const nodeTypes = {
  editorStep: EditorStepNode,
  editorLane: EditorLaneNode,
}

export interface ProcessEditorIssue {
  stapId?: string
  bericht: string
  ernst: string
  bron?: 'gezondheid' | 'kader' | 'ai'
  kaderId?: string
  kaderNaam?: string
  controleId?: string
  titel?: string
  advies?: string
}

export interface ProcessDiagramEditorProps {
  proces: Process
  onChange: (proces: Process) => void
  onSave: (proces: Process) => boolean | void | Promise<boolean | void>
  knownProcesses: ProcessSummary[]
  savedSnapshot: string
  issues?: readonly ProcessEditorIssue[]
  score?: number
  initialFocusStepId?: string
  aiSteward?: AiProcessStewardController
  aiRunHistory?: ProcessMaintenanceRunHistoryController
}

interface RouteDialogState {
  sourceId: string
  targetId: string
  label: string
  voorwaarde: string
  standaard: boolean
  fout?: string
}

interface HistoryState {
  past: Process[]
  future: Process[]
  groupKey?: string
  groupAt: number
}

function fingerprint(value: Process): string {
  return JSON.stringify(value)
}

function isFormTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
}

function stripStepPrefix(nodeId: string | null | undefined): string | undefined {
  return nodeId?.startsWith('step:') ? nodeId.slice('step:'.length) : undefined
}

function newId(prefix: string, used: Set<string>): string {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const suffix = globalThis.crypto?.randomUUID?.().slice(0, 8) ??
      Math.random().toString(36).slice(2, 10)
    const candidate = `${prefix}-${suffix}`
    if (!used.has(candidate)) return candidate
  }
  let index = used.size + 1
  while (used.has(`${prefix}-${index}`)) index += 1
  return `${prefix}-${index}`
}

function nextNumber(proces: Process, type: StepType): string {
  if (type === 'start') return proces.stappen.some((step) => step.nummer === 'S') ? 'S2' : 'S'
  if (type === 'eind') return proces.stappen.some((step) => step.nummer === 'E') ? 'E2' : 'E'
  if (type === 'subproces') return `SC${proces.stappen.filter((step) => step.type === type).length + 1}`
  if (type === 'beslissing') return `B${proces.stappen.filter((step) => step.type === type).length + 1}`
  const numeric = proces.stappen
    .map((step) => Number(step.nummer))
    .filter((number) => Number.isInteger(number) && number > 0)
  return String(Math.max(0, ...numeric) + 1)
}

function defaultActivity(type: StepType): string {
  const labels: Record<StepType, string> = {
    actie: 'Nieuwe activiteit',
    bericht: 'Nieuw bericht',
    beslissing: 'Nieuwe beslissing',
    subproces: 'Nieuw subproces',
    start: 'Start',
    eind: 'Einde',
    marker: 'Nieuwe marker',
  }
  return labels[type]
}

function listToText(values: string[] | undefined): string {
  return values?.join('\n') ?? ''
}

function textToList(value: string): string[] | undefined {
  const lines = value.split('\n').map((line) => line.trim()).filter(Boolean)
  return lines.length > 0 ? lines : undefined
}

function nearestLaneIndex(
  proces: Process,
  currentLaneId: string,
  centerX: number,
): number {
  const currentIndex = Math.max(0, proces.lanes.findIndex((lane) => lane.id === currentLaneId))
  const nearestBoundary = Math.round(centerX / LANE_WIDTH) * LANE_WIDTH
  if (Math.abs(centerX - nearestBoundary) < LANE_BOUNDARY_GUTTER) return currentIndex
  return Math.max(0, Math.min(proces.lanes.length - 1, Math.floor(centerX / LANE_WIDTH)))
}

function semanticBlockers(proces: Process): string[] {
  const blockers: string[] = []
  const stepIds = new Set(proces.stappen.map((step) => step.id))
  const laneIds = new Set(proces.lanes.map((lane) => lane.id))
  if (!proces.detailproces.trim()) blockers.push('Geef het proces eerst een naam.')
  if (proces.lanes.length === 0) blockers.push('Voeg minimaal één rol toe.')
  if (stepIds.size !== proces.stappen.length) blockers.push('Stap-id’s moeten uniek zijn.')
  for (const step of proces.stappen) {
    if (!laneIds.has(step.laneId)) blockers.push(`Stap ${step.nummer} heeft een onbekende verantwoordelijke.`)
    if (step.naarStap && !stepIds.has(step.naarStap)) blockers.push(`Stap ${step.nummer} heeft een onbekend vervolg.`)
    if (step.naarStap && (step.routes?.length ?? 0) > 0) {
      blockers.push(`Stap ${step.nummer} combineert een direct vervolg met routes.`)
    }
    const labels = new Set<string>()
    for (const route of step.routes ?? []) {
      const label = route.label.trim().toLowerCase()
      if (!label) blockers.push(`Een route van stap ${step.nummer} heeft nog geen label.`)
      if (label && labels.has(label)) blockers.push(`Stap ${step.nummer} heeft twee routes met label "${route.label}".`)
      labels.add(label)
      if (!route.naarStap && !route.naarProces) {
        blockers.push(`Route "${route.label || '?'}" van stap ${step.nummer} heeft nog geen doel.`)
      }
      if (route.naarStap && !stepIds.has(route.naarStap)) {
        blockers.push(`Route "${route.label || '?'}" van stap ${step.nummer} heeft een onbekend doel.`)
      }
    }
  }
  const derivedId = proces.id.trim() || proces.detailproces
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const structural = validateEditorProcessStructure({ ...proces, id: derivedId })
  blockers.push(...structural.issues.map((issue) => issue.message))
  return [...new Set(blockers)]
}

export function ProcessDiagramEditor({
  proces,
  onChange,
  onSave,
  knownProcesses,
  savedSnapshot,
  issues = [],
  score,
  initialFocusStepId,
  aiSteward,
  aiRunHistory,
}: ProcessDiagramEditorProps) {
  const shellRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const instanceRef = useRef<ReactFlowInstance<ProcessEditorNode, Edge> | null>(null)
  const processRef = useRef(proces)
  const lastEmittedRef = useRef<Process | null>(null)
  const historyRef = useRef<HistoryState>({ past: [], future: [], groupAt: 0 })
  const [historyAvailability, setHistoryAvailability] = useState({
    canUndo: false,
    canRedo: false,
  })
  const [nodes, setNodes] = useState<ProcessEditorNode[]>([])
  const [selectedStepId, setSelectedStepId] = useState<string>()
  const [selectedLaneId, setSelectedLaneId] = useState<string>()
  const [selectedEdgeId, setSelectedEdgeId] = useState<string>()
  const [routeDialog, setRouteDialog] = useState<RouteDialogState>()
  const [announcement, setAnnouncement] = useState('Visuele editor gereed.')
  const [viewportZoom, setViewportZoom] = useState(1)
  const [aiHistoryOpen, setAiHistoryOpen] = useState(false)
  const [issueFilter, setIssueFilter] = useState<'all' | 'kader' | 'ai'>(
    issues.some((issue) => issue.bron === 'kader' && issue.stapId) ? 'kader' : 'all',
  )
  const initialFocusKeyRef = useRef<string | undefined>(undefined)
  const aiRunFocusKeyRef = useRef<string | undefined>(undefined)

  const viewportInsertion = useCallback((
    current: Process,
    preferredLaneId?: string,
    dimensions?: { width?: number; height?: number },
  ) => {
    const canvas = canvasRef.current
    const instance = instanceRef.current
    if (!canvas || !instance) {
      return findViewportInsertionPlacement(
        current,
        { centerX: LANE_WIDTH / 2, topY: TOP_ROW_Y - 20 },
        preferredLaneId,
        dimensions,
      )
    }
    const bounds = canvas.getBoundingClientRect()
    const center = instance.screenToFlowPosition({
      x: bounds.left + bounds.width / 2,
      y: bounds.top,
    })
    return findViewportInsertionPlacement(
      current,
      { centerX: center.x, topY: center.y },
      preferredLaneId,
      dimensions,
    )
  }, [])

  const refreshHistoryAvailability = useCallback(() => {
    const history = historyRef.current
    setHistoryAvailability({
      canUndo: history.past.length > 0,
      canRedo: history.future.length > 0,
    })
  }, [])

  const commit = useCallback((
    next: Process,
    message: string,
    groupKey?: string,
  ) => {
    const current = processRef.current
    if (fingerprint(current) === fingerprint(next)) return

    const history = historyRef.current
    const now = Date.now()
    const grouped = Boolean(
      groupKey &&
      groupKey === history.groupKey &&
      now - history.groupAt <= GROUP_WINDOW_MS,
    )
    if (!grouped) {
      history.past = [...history.past, structuredClone(current)].slice(-HISTORY_LIMIT)
    }
    history.future = []
    history.groupKey = groupKey
    history.groupAt = now
    processRef.current = next
    lastEmittedRef.current = next
    onChange(next)
    refreshHistoryAvailability()
    setAnnouncement(message)
  }, [onChange, refreshHistoryAvailability])

  const applyMutation = useCallback((
    result: EditorMutationResult,
    message: string,
  ): boolean => {
    if (!result.ok) {
      setAnnouncement(result.issues.map((issue) => issue.message).join(' '))
      return false
    }
    commit(result.process, message)
    return true
  }, [commit])

  const handleResizeEnd = useCallback((
    stepId: string,
    bounds: { x: number; y: number; width: number; height: number },
  ) => {
    const current = processRef.current
    const step = current.stappen.find((candidate) => candidate.id === stepId)
    const laneIndex = step
      ? current.lanes.findIndex((lane) => lane.id === step.laneId)
      : -1
    const centeredBounds = laneIndex >= 0
      ? {
          ...bounds,
          width: Math.min(bounds.width, MAX_ALIGNED_NODE_WIDTH),
          x: laneIndex * LANE_WIDTH +
            (LANE_WIDTH - Math.min(bounds.width, MAX_ALIGNED_NODE_WIDTH)) / 2,
        }
      : bounds
    applyMutation(
      setNodePlacement(current, stepId, centeredBounds),
      'Afmetingen aangepast; de stap blijft gecentreerd in de lane.',
    )
  }, [applyMutation])

  useEffect(() => {
    if (lastEmittedRef.current === proces) {
      lastEmittedRef.current = null
      processRef.current = proces
      return
    }
    if (processRef.current !== proces) {
      processRef.current = proces
      historyRef.current = { past: [], future: [], groupAt: 0 }
      refreshHistoryAvailability()
      setSelectedStepId(undefined)
      setSelectedLaneId(undefined)
      setSelectedEdgeId(undefined)
    }
  }, [proces, refreshHistoryAvailability])

  const graph = useMemo(() => buildEditorGraph(proces), [proces])
  const canvasHeight = useMemo(() => {
    const bottom = graph.nodes.reduce(
      (maximum, node) => Math.max(
        maximum,
        node.position.y + (node.position.height ?? DEFAULT_NODE_HEIGHT),
      ),
      560,
    )
    return Math.max(640, bottom + 100)
  }, [graph.nodes])

  const issueCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const issue of issues) {
      if (issue.stapId && issue.bron !== 'kader' && issue.bron !== 'ai') {
        counts.set(issue.stapId, (counts.get(issue.stapId) ?? 0) + 1)
      }
    }
    return counts
  }, [issues])
  const aiIssues =
    aiSteward?.result?.status === 'voorstel'
      ? aiSteward.result.issues
      : NO_AI_ISSUES
  const aiStepIssues = useMemo(
    () => aiIssues.filter(
      (issue): issue is ProcessMaintenanceIssue & { stapId: string } =>
        Boolean(issue.stapId),
    ),
    [aiIssues],
  )
  const aiProcessIssues = useMemo(
    () => aiIssues.filter((issue) => !issue.stapId),
    [aiIssues],
  )
  const aiIssueCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const issue of aiStepIssues) {
      counts.set(issue.stapId, (counts.get(issue.stapId) ?? 0) + 1)
    }
    return counts
  }, [aiStepIssues])
  const aiStepIds = useMemo(
    () => new Set(aiStepIssues.map((issue) => issue.stapId)),
    [aiStepIssues],
  )
  const aiSteps = useMemo(
    () => proces.stappen.filter((step) => aiStepIds.has(step.id)),
    [aiStepIds, proces.stappen],
  )
  const kaderIssues = useMemo(
    () => issues.filter((issue) => issue.bron === 'kader'),
    [issues],
  )
  const kaderStepIssues = useMemo(
    () => kaderIssues.filter(
      (issue): issue is ProcessEditorIssue & { stapId: string } =>
        Boolean(issue.stapId),
    ),
    [kaderIssues],
  )
  const procesKaderIssues = useMemo(
    () => kaderIssues.filter((issue) => !issue.stapId),
    [kaderIssues],
  )
  const kaderIssueCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const issue of kaderStepIssues) {
      counts.set(issue.stapId, (counts.get(issue.stapId) ?? 0) + 1)
    }
    return counts
  }, [kaderStepIssues])
  const kaderStepIds = useMemo(
    () => new Set(kaderStepIssues.map((issue) => issue.stapId)),
    [kaderStepIssues],
  )
  const kaderSteps = useMemo(
    () => proces.stappen.filter((step) => kaderStepIds.has(step.id)),
    [kaderStepIds, proces.stappen],
  )

  const flowNodes = useMemo<ProcessEditorNode[]>(() => {
    const laneNodes: ProcessEditorNode[] = proces.lanes.map((lane, index) => ({
      id: `lane:${lane.id}`,
      type: 'editorLane',
      position: { x: index * LANE_WIDTH, y: 0 },
      width: LANE_WIDTH,
      height: canvasHeight,
      data: { lane },
      draggable: false,
      connectable: false,
      selectable: true,
      selected: selectedLaneId === lane.id,
      deletable: false,
      zIndex: -10,
      ariaLabel: `Lane ${lane.naam}`,
    }))
    const stepNodes: ProcessEditorNode[] = graph.nodes.map((descriptor) => {
      const step = proces.stappen.find((candidate) => candidate.id === descriptor.stepId)!
      const lane = proces.lanes.find((candidate) => candidate.id === step.laneId)
      const section = proces.secties.find((candidate) => candidate.id === step.sectieId)
      return {
        id: descriptor.id,
        type: 'editorStep',
        position: { x: descriptor.position.x, y: descriptor.position.y },
        width: descriptor.position.width ?? DEFAULT_NODE_WIDTH,
        height: descriptor.position.height ?? DEFAULT_NODE_HEIGHT,
        data: {
          step,
          laneName: lane?.naam ?? 'Onbekende rol',
          laneColor: lane?.kleur ?? '#6b7280',
          sectionName: section?.naam,
          issueCount: issueCounts.get(step.id) ?? 0,
          frameworkFindingCount: kaderIssueCounts.get(step.id) ?? 0,
          aiFindingCount: aiIssueCounts.get(step.id) ?? 0,
          dimmed:
            (issueFilter === 'kader' && !kaderStepIds.has(step.id)) ||
            (issueFilter === 'ai' && !aiStepIds.has(step.id)),
          onResizeEnd: handleResizeEnd,
        },
        draggable: true,
        connectable: true,
        selectable: true,
        selected: selectedStepId === step.id,
        deletable: false,
        zIndex: 10,
        ariaLabel: `${typeLabel[step.type]} ${step.nummer}: ${step.activiteit}. Verantwoordelijke ${lane?.naam ?? 'onbekend'}.`,
      }
    })
    return [...laneNodes, ...stepNodes]
  }, [
    canvasHeight,
    graph.nodes,
    handleResizeEnd,
    aiIssueCounts,
    aiStepIds,
    issueCounts,
    issueFilter,
    kaderIssueCounts,
    kaderStepIds,
    proces.lanes,
    proces.secties,
    proces.stappen,
    selectedLaneId,
    selectedStepId,
  ])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setNodes(flowNodes))
    return () => window.cancelAnimationFrame(frame)
  }, [flowNodes])

  const focusStep = useCallback((stepId: string, message?: string) => {
    const descriptor = buildEditorGraph(processRef.current).nodes.find(
      (node) => node.stepId === stepId,
    )
    if (!descriptor) {
      setAnnouncement(`De gekoppelde stap '${stepId}' bestaat niet meer in deze werkversie.`)
      return
    }
    setSelectedStepId(stepId)
    setSelectedLaneId(undefined)
    setSelectedEdgeId(undefined)
    if (message) setAnnouncement(message)
    window.setTimeout(() => {
      const instance = instanceRef.current
      if (!instance) return
      const width = descriptor.position.width ?? DEFAULT_NODE_WIDTH
      const height = descriptor.position.height ?? DEFAULT_NODE_HEIGHT
      void instance.setCenter(
        descriptor.position.x + width / 2,
        descriptor.position.y + height / 2,
        {
          zoom: Math.min(1.25, Math.max(0.9, instance.getZoom())),
          duration: 220,
        },
      )
    }, 0)
  }, [])

  useEffect(() => {
    if (!initialFocusStepId || !kaderStepIds.has(initialFocusStepId)) return
    const key = `${proces.id}:${initialFocusStepId}`
    if (initialFocusKeyRef.current === key) return
    initialFocusKeyRef.current = key
    setIssueFilter('kader')
    focusStep(
      initialFocusStepId,
      'Gekoppelde ISO-/kaderbevinding geopend; de bijbehorende stap is geselecteerd.',
    )
  }, [focusStep, initialFocusStepId, kaderStepIds, proces.id])

  useEffect(() => {
    if (
      aiSteward?.result?.status !== 'voorstel' ||
      aiStepIds.size === 0 ||
      aiRunFocusKeyRef.current === aiSteward.result.runId
    ) return
    aiRunFocusKeyRef.current = aiSteward.result.runId
    setIssueFilter('ai')
  }, [aiSteward?.result, aiStepIds])

  const flowEdges = useMemo<Edge[]>(() => graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    type: 'smoothstep',
    animated: edge.kind === 'route',
    reconnectable: 'target',
    selectable: true,
    deletable: false,
    selected: selectedEdgeId === edge.id,
    zIndex: 5,
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: edge.kind === 'route' ? '#b56b00' : '#566274',
    },
    style: {
      stroke: edge.kind === 'route' ? '#b56b00' : '#566274',
      strokeWidth: 2,
    },
    labelStyle: { fill: '#6f4400', fontWeight: 700 },
    labelBgStyle: { fill: '#fffaf0', fillOpacity: 0.95 },
    ariaLabel: edge.kind === 'route'
      ? `Route ${edge.label ?? ''} naar ${edge.targetStepId}`
      : `Vervolg naar ${edge.targetStepId}`,
  })), [graph.edges, selectedEdgeId])

  const selectedStep = proces.stappen.find((step) => step.id === selectedStepId)
  const selectedStepKaderIssues = selectedStep
    ? kaderStepIssues.filter((issue) => issue.stapId === selectedStep.id)
    : []
  const selectedStepAiIssues = selectedStep
    ? aiStepIssues.filter((issue) => issue.stapId === selectedStep.id)
    : []
  const selectedLane = proces.lanes.find((lane) => lane.id === selectedLaneId)
  const selectedEdge = graph.edges.find((edge) => edge.id === selectedEdgeId)
  const dirty = fingerprint(proces) !== savedSnapshot
  const { canUndo, canRedo } = historyAvailability
  const aiBusy =
    aiSteward?.phase === 'saving' ||
    aiSteward?.phase === 'analyzing' ||
    aiSteward?.phase === 'accepting'

  const updateStep = useCallback((
    stepId: string,
    patch: Partial<Step>,
    field: string,
  ) => {
    const current = processRef.current
    const step = current.stappen.find((candidate) => candidate.id === stepId)
    if (!step) return
    commit({
      ...current,
      stappen: current.stappen.map((candidate) =>
        candidate.id === stepId ? { ...candidate, ...patch } : candidate,
      ),
    }, 'Stapeigenschappen aangepast.', `step:${stepId}:${field}`)
  }, [commit])

  const changeStepType = useCallback((stepId: string, newType: StepType) => {
    const current = processRef.current
    const firstAttempt = changeStepTypeSafely(current, stepId, newType)
    if (firstAttempt.ok) {
      commit(firstAttempt.process, `Staptype gewijzigd naar ${typeLabel[newType]}.`)
      return
    }
    if (!firstAttempt.issues.some((issue) => issue.code === 'step-type-cleanup-required')) {
      setAnnouncement(firstAttempt.issues.map((issue) => issue.message).join(' '))
      return
    }
    if (!window.confirm(
      `${firstAttempt.issues[0].message} Deze verborgen relaties gaan verloren. Type toch wijzigen?`,
    )) return
    applyMutation(
      changeStepTypeSafely(current, stepId, newType, true),
      `Staptype gewijzigd naar ${typeLabel[newType]}; incompatibele relaties zijn verwijderd.`,
    )
  }, [applyMutation, commit])

  const undo = useCallback(() => {
    const history = historyRef.current
    const previous = history.past.at(-1)
    if (!previous) return
    history.past = history.past.slice(0, -1)
    history.future = [structuredClone(processRef.current), ...history.future].slice(0, HISTORY_LIMIT)
    history.groupKey = undefined
    processRef.current = previous
    lastEmittedRef.current = previous
    onChange(previous)
    refreshHistoryAvailability()
    setAnnouncement('Laatste wijziging ongedaan gemaakt.')
  }, [onChange, refreshHistoryAvailability])

  const redo = useCallback(() => {
    const history = historyRef.current
    const next = history.future[0]
    if (!next) return
    history.future = history.future.slice(1)
    history.past = [...history.past, structuredClone(processRef.current)].slice(-HISTORY_LIMIT)
    history.groupKey = undefined
    processRef.current = next
    lastEmittedRef.current = next
    onChange(next)
    refreshHistoryAvailability()
    setAnnouncement('Wijziging opnieuw uitgevoerd.')
  }, [onChange, refreshHistoryAvailability])

  const addStep = useCallback((type: StepType) => {
    const current = processRef.current
    if (current.lanes.length === 0) {
      setAnnouncement('Voeg eerst minimaal één rol toe.')
      return
    }
    const used = new Set(current.stappen.map((step) => step.id))
    const id = newId(type, used)
    const insertion = viewportInsertion(current)
    if (!insertion) {
      setAnnouncement('Er is geen geldige plek voor de nieuwe stap gevonden.')
      return
    }
    const lane = current.lanes.find((candidate) => candidate.id === insertion.laneId)!
    const step: Step = {
      id,
      nummer: nextNumber(current, type),
      sectieId: selectedStep?.sectieId ?? current.secties[0]?.id,
      laneId: lane.id,
      type,
      activiteit: defaultActivity(type),
    }
    const withStep: Process = { ...current, stappen: [...current.stappen, step] }
    const placement = setNodePlacement(withStep, id, insertion.placement)
    if (!placement.ok) {
      setAnnouncement(placement.issues.map((issue) => issue.message).join(' '))
      return
    }
    commit(placement.process, `${typeLabel[type]} toegevoegd.`)
    setSelectedStepId(id)
    setSelectedLaneId(undefined)
    setSelectedEdgeId(undefined)
  }, [commit, selectedStep, viewportInsertion])

  const duplicateSelected = useCallback(() => {
    const current = processRef.current
    const source = current.stappen.find((step) => step.id === selectedStepId)
    if (!source) return
    const id = newId(source.type, new Set(current.stappen.map((step) => step.id)))
    const copy: Step = {
      ...structuredClone(source),
      id,
      nummer: nextNumber(current, source.type),
      activiteit: `${source.activiteit} (kopie)`,
      naarStap: undefined,
      routes: undefined,
      naarProces: undefined,
    }
    const currentPlacement = buildEditorGraph(current).nodes.find((node) => node.stepId === source.id)?.position
    const width = Math.min(currentPlacement?.width ?? DEFAULT_NODE_WIDTH, MAX_ALIGNED_NODE_WIDTH)
    const height = currentPlacement?.height ?? DEFAULT_NODE_HEIGHT
    const insertion = viewportInsertion(current, source.laneId, { width, height })
    if (!insertion) {
      setAnnouncement('Er is geen geldige plek voor de kopie gevonden.')
      return
    }
    const withStep: Process = { ...current, stappen: [...current.stappen, copy] }
    const result = setNodePlacement(withStep, id, insertion.placement)
    if (!result.ok) {
      setAnnouncement(result.issues.map((issue) => issue.message).join(' '))
      return
    }
    commit(result.process, 'Stap gedupliceerd zonder procesverbindingen.')
    setSelectedStepId(id)
    setSelectedEdgeId(undefined)
  }, [commit, selectedStepId, viewportInsertion])

  const removeSelectedStep = useCallback(() => {
    const current = processRef.current
    const step = current.stappen.find((candidate) => candidate.id === selectedStepId)
    if (!step) return
    const incoming = current.stappen.reduce(
      (count, candidate) =>
        count +
        Number(candidate.naarStap === step.id) +
        (candidate.routes?.filter((route) => route.naarStap === step.id).length ?? 0),
      0,
    )
    const outgoing = Number(Boolean(step.naarStap)) + (step.routes?.length ?? 0)
    if (!window.confirm(
      `Stap "${step.activiteit}" verwijderen? Daarbij worden ${incoming} inkomende en ${outgoing} uitgaande verbinding(en) veilig opgeruimd.`,
    )) return
    if (applyMutation(deleteStepSafely(current, step.id), 'Stap en verwijzingen verwijderd.')) {
      setSelectedStepId(undefined)
    }
  }, [applyMutation, selectedStepId])

  const connect = useCallback((connection: Connection) => {
    const sourceId = stripStepPrefix(connection.source)
    const targetId = stripStepPrefix(connection.target)
    if (!sourceId || !targetId) {
      setAnnouncement('Verbind twee processtappen; een lane is geen procesdoel.')
      return
    }
    const current = processRef.current
    const source = current.stappen.find((step) => step.id === sourceId)
    if (!source) return
    if (source.type === 'beslissing') {
      setRouteDialog({
        sourceId,
        targetId,
        label: '',
        voorwaarde: '',
        standaard: false,
      })
      return
    }
    if (source.naarStap && source.naarStap !== targetId) {
      if (!window.confirm(
        `Deze stap gaat nu naar "${source.naarStap}". Bestaand vervolg vervangen door "${targetId}"?`,
      )) return
      applyMutation(
        reconnectEditorEdge(current, transitionEdgeId(sourceId), targetId),
        'Bestaand vervolg expliciet vervangen.',
      )
      return
    }
    applyMutation(connectSteps(current, sourceId, targetId), 'Stappen verbonden.')
  }, [applyMutation])

  const submitRoute = useCallback(() => {
    if (!routeDialog) return
    const label = routeDialog.label.trim()
    if (!label) {
      setRouteDialog({ ...routeDialog, fout: 'Geef de route een duidelijk label, bijvoorbeeld Ja of Nee.' })
      return
    }
    const beforeRouteIds = new Set(
      processRef.current.stappen
        .find((step) => step.id === routeDialog.sourceId)
        ?.routes?.map((route) => route.id) ?? [],
    )
    const result = connectSteps(
      processRef.current,
      routeDialog.sourceId,
      routeDialog.targetId,
      label,
    )
    if (!result.ok) {
      setRouteDialog({ ...routeDialog, fout: result.issues.map((issue) => issue.message).join(' ') })
      return
    }
    const enriched: Process = {
      ...result.process,
      stappen: result.process.stappen.map((step) => {
        if (step.id !== routeDialog.sourceId) return step
        return {
          ...step,
          routes: step.routes?.map((route) => {
            if (beforeRouteIds.has(route.id)) {
              return routeDialog.standaard ? { ...route, standaard: undefined } : route
            }
            return {
              ...route,
              voorwaarde: routeDialog.voorwaarde.trim() || undefined,
              standaard: routeDialog.standaard || undefined,
            }
          }),
        }
      }),
    }
    commit(enriched, `Route "${label}" toegevoegd.`)
    setRouteDialog(undefined)
  }, [commit, routeDialog])

  const reconnect = useCallback((oldEdge: Edge, connection: Connection) => {
    const targetId = stripStepPrefix(connection.target)
    if (!targetId || connection.source !== oldEdge.source) {
      setAnnouncement('Alleen het doel van een verbinding kan worden verplaatst.')
      return
    }
    applyMutation(
      reconnectEditorEdge(processRef.current, oldEdge.id, targetId),
      'Doel van verbinding aangepast.',
    )
  }, [applyMutation])

  const deleteSelectedEdge = useCallback(() => {
    if (!selectedEdgeId) return
    if (!window.confirm('Deze procesverbinding verwijderen?')) return
    if (applyMutation(
      deleteEditorEdge(processRef.current, selectedEdgeId),
      'Procesverbinding verwijderd.',
    )) {
      setSelectedEdgeId(undefined)
    }
  }, [applyMutation, selectedEdgeId])

  const save = useCallback(async () => {
    const blockers = semanticBlockers(processRef.current)
    if (blockers.length > 0) {
      setAnnouncement(`Opslaan gepauzeerd: ${blockers[0]}${blockers.length > 1 ? ` (+${blockers.length - 1})` : ''}`)
      return
    }
    const saved = await onSave(processRef.current)
    if (saved === false) {
      setAnnouncement('Opslaan is niet gelukt. Controleer de melding boven de editor.')
      return
    }
    setAnnouncement('Concept opgeslagen.')
  }, [onSave])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isFormTarget(event.target)) return
      const modifier = event.ctrlKey || event.metaKey
      const key = event.key.toLowerCase()
      if (modifier && key === 's') {
        event.preventDefault()
        void save()
      } else if (modifier && key === 'z' && event.shiftKey) {
        event.preventDefault()
        redo()
      } else if (modifier && key === 'z') {
        event.preventDefault()
        undo()
      } else if (modifier && key === 'y') {
        event.preventDefault()
        redo()
      } else if (modifier && key === 'd') {
        event.preventDefault()
        duplicateSelected()
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedEdgeId) {
        event.preventDefault()
        deleteSelectedEdge()
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedStepId) {
        event.preventDefault()
        removeSelectedStep()
      } else if (event.key === 'Escape') {
        setRouteDialog(undefined)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    deleteSelectedEdge,
    duplicateSelected,
    redo,
    removeSelectedStep,
    save,
    selectedEdgeId,
    selectedStepId,
    undo,
  ])

  const changeDirectTarget = (step: Step, targetId: string) => {
    if (!targetId && step.naarStap) {
      applyMutation(clearDirectTransition(proces, step.id), 'Direct vervolg verwijderd.')
    } else if (targetId && step.naarStap) {
      const cleared = clearDirectTransition(proces, step.id)
      if (!cleared.ok) {
        setAnnouncement(cleared.issues.map((issue) => issue.message).join(' '))
        return
      }
      applyMutation(connectSteps(cleared.process, step.id, targetId), 'Direct vervolg aangepast.')
    } else if (targetId) {
      applyMutation(connectSteps(proces, step.id, targetId), 'Direct vervolg toegevoegd.')
    }
  }

  const changeRoute = (
    stepId: string,
    routeId: string,
    patch: Record<string, unknown>,
    field: string,
  ) => {
    const current = processRef.current
    const step = current.stappen.find((candidate) => candidate.id === stepId)
    if (!step) return
    commit({
      ...current,
      stappen: current.stappen.map((candidate) =>
        candidate.id === stepId
          ? {
              ...candidate,
              routes: candidate.routes?.map((route) =>
                route.id === routeId ? { ...route, ...patch } : route,
              ),
            }
          : candidate,
      ),
    }, 'Route aangepast.', `route:${stepId}:${routeId}:${field}`)
  }

  const deleteLane = (lane: Lane) => {
    const current = processRef.current
    const used = current.stappen.filter(
      (step) => step.laneId === lane.id || step.doelLaneId === lane.id,
    )
    if (used.length > 0) {
      setAnnouncement(`Rol "${lane.naam}" wordt nog door ${used.length} stap(pen) gebruikt.`)
      return
    }
    if (current.lanes.length <= 1) {
      setAnnouncement('Een proces moet minimaal één rol houden.')
      return
    }
    commit({ ...current, lanes: current.lanes.filter((candidate) => candidate.id !== lane.id) }, 'Rol verwijderd.')
    setSelectedLaneId(undefined)
  }

  const deleteSection = (section: Section) => {
    const current = processRef.current
    const used = current.stappen.filter((step) => step.sectieId === section.id)
    if (used.length > 0) {
      setAnnouncement(`Verplaats eerst ${used.length} stap(pen) uit sectie "${section.naam}".`)
      return
    }
    commit({
      ...current,
      secties: current.secties.filter((candidate) => candidate.id !== section.id),
    }, 'Sectie verwijderd.')
  }

  return (
    <div className="pe-shell" ref={shellRef}>
      <datalist id="pe-known-processes">
        {knownProcesses.map((summary) => (
          <option key={summary.id} value={summary.id}>{summary.detailproces}</option>
        ))}
      </datalist>
      <div className="pe-toolbar" aria-label="Werkbalk visuele proceseditor">
        <div className="pe-toolbar-group" aria-label="Stappen toevoegen">
          {(['start', 'actie', 'beslissing', 'bericht', 'subproces', 'eind'] as StepType[]).map((type) => (
            <button key={type} onClick={() => addStep(type)} title={`${typeLabel[type]} toevoegen`}>
              + {typeLabel[type]}
            </button>
          ))}
        </div>
        <div className="pe-toolbar-group">
          <button onClick={undo} disabled={!canUndo} title="Ongedaan maken (Ctrl+Z)">↶ Undo</button>
          <button onClick={redo} disabled={!canRedo} title="Opnieuw (Ctrl+Y)">↷ Redo</button>
          <button
            onClick={() => {
              if (!window.confirm('Auto-layout vervangt alle handmatige stap-posities. Je kunt dit daarna ongedaan maken. Doorgaan?')) return
              commit(
                { ...processRef.current, diagramLayout: createAutoDiagramLayout(processRef.current) },
                'Automatische layout toegepast.',
              )
              window.setTimeout(() => instanceRef.current?.fitView({ padding: 0.08 }), 0)
            }}
          >
            Auto-layout
          </button>
        </div>
        <div className="pe-toolbar-group pe-zoom-bediening" role="group" aria-label="Zoom visuele editor">
          <button
            type="button"
            aria-label="Uitzoomen"
            title="Uitzoomen"
            disabled={viewportZoom <= EDITOR_MIN_ZOOM}
            onClick={() => void instanceRef.current?.zoomTo(
              Math.max(EDITOR_MIN_ZOOM, viewportZoom - EDITOR_ZOOM_STEP),
              { duration: 160 },
            )}
          >
            −
          </button>
          <output aria-label="Zoomniveau editor" aria-live="polite">
            {Math.round(viewportZoom * 100)}%
          </output>
          <button
            type="button"
            aria-label="Inzoomen"
            title="Inzoomen"
            disabled={viewportZoom >= EDITOR_MAX_ZOOM}
            onClick={() => void instanceRef.current?.zoomTo(
              Math.min(EDITOR_MAX_ZOOM, viewportZoom + EDITOR_ZOOM_STEP),
              { duration: 160 },
            )}
          >
            +
          </button>
          <button
            type="button"
            aria-label="Zoom editor herstellen naar 100%"
            title="Zoom herstellen naar 100%"
            disabled={Math.abs(viewportZoom - 1) < 0.005}
            onClick={() => void instanceRef.current?.zoomTo(1, { duration: 160 })}
          >
            Reset
          </button>
          <button
            type="button"
            aria-label="Procesdiagram passend weergeven"
            title="Procesdiagram passend weergeven"
            onClick={() => void instanceRef.current?.fitView({ padding: 0.08, duration: 160 })}
          >
            Passend
          </button>
        </div>
        <div className="pe-toolbar-group">
          <button onClick={duplicateSelected} disabled={!selectedStep}>Dupliceer</button>
          <button
            className="pe-danger"
            onClick={selectedEdge ? deleteSelectedEdge : removeSelectedStep}
            disabled={!selectedStep && !selectedEdge}
          >
            Verwijder
          </button>
          <button
            onClick={() => {
              if (document.fullscreenElement) void document.exitFullscreen()
              else void shellRef.current?.requestFullscreen()
            }}
          >
            Volledig scherm
          </button>
        </div>
        <div className="pe-toolbar-group">
          {aiSteward && (
            <button
              type="button"
              className="pe-ai-analyse"
              disabled={aiSteward.analyzeDisabled || aiBusy}
              title={aiSteward.analyzeDisabledReason ?? 'Controleer onderhoud en maak een conceptvoorstel'}
              onClick={aiSteward.onAnalyze}
            >
              ✨ {aiSteward.analyzeLabel ?? 'Analyseer onderhoud'}
            </button>
          )}
          {aiRunHistory && (
            <button
              type="button"
              className="pe-ai-history"
              aria-expanded={aiHistoryOpen}
              onClick={() => {
                if (!aiHistoryOpen) aiRunHistory.onOpen?.()
                setAiHistoryOpen((open) => !open)
              }}
            >
              🕘 AI-historie
              {aiRunHistory.items.length > 0 && (
                <span aria-label={`${aiRunHistory.items.length} runs`}>
                  {aiRunHistory.items.length}
                </span>
              )}
            </button>
          )}
          <button className="pe-save" onClick={() => void save()}>💾 Opslaan</button>
        </div>
        <span className={`pe-status ${dirty ? 'pe-status-dirty' : 'pe-status-clean'}`}>
          {typeof score === 'number' && <span>Gezondheid {Math.round(score)} ·</span>}
          {dirty ? 'Niet opgeslagen' : 'Opgeslagen'}
        </span>
      </div>
      <div className="pe-feedback" role="status" aria-live="polite">{announcement}</div>
      {aiRunHistory && aiHistoryOpen && (
        <ProcessMaintenanceRunHistory
          controller={aiRunHistory}
          onClose={() => setAiHistoryOpen(false)}
        />
      )}
      {aiSteward && (
        <AiProcessStewardPanel
          controller={aiSteward}
          onFocusStep={(stepId, issue) => {
            focusStep(
              stepId,
              `AI-onderhoudssignaal geopend: ${issue.titel}`,
            )
          }}
        />
      )}
      {kaderIssues.length > 0 && (
        <section className="pe-findings-bar" aria-label="ISO- en kaderbevindingen">
          <div className="pe-findings-summary">
            <strong>⚑ Kaderbevindingen</strong>
            <span>
              {kaderIssues.length} bevinding(en): {kaderStepIds.size} stap(pen)
              {procesKaderIssues.length > 0 && ` · ${procesKaderIssues.length} op procesniveau`}
            </span>
          </div>
          <div className="pe-findings-legend" aria-label="Legenda aandachtspunten">
            <span><i className="pe-legend-framework" /> ISO/kader</span>
            <span><i className="pe-legend-health" /> Modelgezondheid</span>
          </div>
          <div className="pe-findings-filter" role="group" aria-label="Filter processtappen">
            <button
              type="button"
              className={issueFilter === 'all' ? 'active' : ''}
              aria-pressed={issueFilter === 'all'}
              onClick={() => setIssueFilter('all')}
            >
              Alle stappen
            </button>
            <button
              type="button"
              className={issueFilter === 'kader' ? 'active' : ''}
              aria-pressed={issueFilter === 'kader'}
              disabled={kaderStepIds.size === 0}
              onClick={() => setIssueFilter('kader')}
            >
              Focus gemarkeerd
            </button>
          </div>
          <label className="pe-findings-select">
            Ga naar stap
            <select
              value={selectedStepId && kaderStepIds.has(selectedStepId) ? selectedStepId : ''}
              onChange={(event) => {
                if (!event.target.value) return
                focusStep(event.target.value, 'Gekoppelde kaderbevinding geselecteerd.')
              }}
            >
              <option value="">Kies een gemarkeerde stap…</option>
              {kaderSteps.map((step) => (
                <option key={step.id} value={step.id}>
                  {step.nummer} · {step.activiteit} ({kaderIssueCounts.get(step.id) ?? 0})
                </option>
              ))}
            </select>
          </label>
          {procesKaderIssues.length > 0 && (
            <details className="pe-process-findings">
              <summary>{procesKaderIssues.length} procesniveau-taak/taken</summary>
              <ul>
                {procesKaderIssues.map((issue, index) => (
                  <li key={`${issue.kaderId ?? 'kader'}:${issue.controleId ?? index}`}>
                    <strong>{issue.titel ?? 'Procesbevinding'}</strong>
                    {issue.kaderNaam && <span>{issue.kaderNaam}</span>}
                    <p>{issue.bericht}</p>
                    {issue.advies && <p>Volgende stap: {issue.advies}</p>}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}
      {aiIssues.length > 0 && (
        <section className="pe-ai-findings-bar" aria-label="AI-onderhoudssignalen">
          <div className="pe-findings-summary">
            <strong>✦ AI-onderhoudssignalen</strong>
            <span>
              {aiIssues.length} bevinding(en): {aiStepIds.size} stap(pen)
              {aiProcessIssues.length > 0 && ` · ${aiProcessIssues.length} op procesniveau`}
            </span>
          </div>
          <div className="pe-findings-filter pe-ai-findings-filter" role="group" aria-label="Filter AI-onderhoudssignalen">
            <button
              type="button"
              className={issueFilter === 'all' ? 'active' : ''}
              aria-pressed={issueFilter === 'all'}
              onClick={() => setIssueFilter('all')}
            >
              Alle stappen
            </button>
            <button
              type="button"
              className={issueFilter === 'ai' ? 'active' : ''}
              aria-pressed={issueFilter === 'ai'}
              disabled={aiStepIds.size === 0}
              onClick={() => setIssueFilter('ai')}
            >
              Focus AI
            </button>
          </div>
          <label className="pe-findings-select pe-ai-findings-select">
            Ga naar stap
            <select
              value={selectedStepId && aiStepIds.has(selectedStepId) ? selectedStepId : ''}
              onChange={(event) => {
                if (!event.target.value) return
                const issue = aiStepIssues.find((candidate) =>
                  candidate.stapId === event.target.value
                )
                focusStep(
                  event.target.value,
                  `AI-onderhoudssignaal geopend: ${issue?.titel ?? 'aandachtspunt'}`,
                )
              }}
            >
              <option value="">Kies een AI-gemarkeerde stap…</option>
              {aiSteps.map((step) => (
                <option key={step.id} value={step.id}>
                  {step.nummer} · {step.activiteit} ({aiIssueCounts.get(step.id) ?? 0})
                </option>
              ))}
            </select>
          </label>
          {aiProcessIssues.length > 0 && (
            <details className="pe-process-findings pe-ai-process-findings">
              <summary>{aiProcessIssues.length} procesniveau-signa(a)l(en)</summary>
              <ul>
                {aiProcessIssues.map((issue) => (
                  <li key={issue.id}>
                    <strong>{issue.titel}</strong>
                    <p>{issue.bevinding}</p>
                    <p>{issue.uitleg}</p>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      <div className="pe-workspace">
        <div className="pe-canvas" ref={canvasRef}>
          <ReactFlow<ProcessEditorNode, Edge>
            nodes={nodes}
            edges={flowEdges}
            nodeTypes={nodeTypes}
            onInit={(instance) => {
              instanceRef.current = instance
              window.setTimeout(() => instance.fitView({ padding: 0.08 }), 0)
            }}
            onMove={(_, viewport) => setViewportZoom(viewport.zoom)}
            onNodesChange={(changes: NodeChange<ProcessEditorNode>[]) => {
              setNodes((current) => applyNodeChanges(
                changes.filter((change) => change.type !== 'remove'),
                current,
              ))
            }}
            onNodeClick={(_, node) => {
              const stepId = stripStepPrefix(node.id)
              setSelectedStepId(stepId)
              setSelectedLaneId(node.id.startsWith('lane:') ? node.id.slice('lane:'.length) : undefined)
              setSelectedEdgeId(undefined)
            }}
            onNodeDragStop={(_, node) => {
              const stepId = stripStepPrefix(node.id)
              if (!stepId) return
              const current = processRef.current
              const previous = buildEditorGraph(current).nodes.find((item) => item.stepId === stepId)?.position
              const measuredWidth = Math.min(
                node.measured?.width ?? previous?.width ?? DEFAULT_NODE_WIDTH,
                MAX_ALIGNED_NODE_WIDTH,
              )
              const measuredHeight = node.measured?.height ?? previous?.height ?? DEFAULT_NODE_HEIGHT
              const centerX = node.position.x + measuredWidth / 2
              const step = current.stappen.find((candidate) => candidate.id === stepId)
              if (!step) return
              const laneIndex = nearestLaneIndex(current, step.laneId, centerX)
              const lane = current.lanes[laneIndex]
              const alignedPlacement = setNodePlacement(current, stepId, {
                x: laneIndex * LANE_WIDTH + (LANE_WIDTH - measuredWidth) / 2,
                y: Math.max(54, node.position.y),
                width: measuredWidth,
                height: measuredHeight,
              })
              if (!alignedPlacement.ok) {
                setAnnouncement(alignedPlacement.issues.map((issue) => issue.message).join(' '))
                return
              }
              const withLane = lane && step && step.laneId !== lane.id
                ? {
                    ...alignedPlacement.process,
                    stappen: alignedPlacement.process.stappen.map((candidate) =>
                      candidate.id === stepId ? { ...candidate, laneId: lane.id } : candidate,
                    ),
                  }
                : alignedPlacement.process
              commit(
                withLane,
                lane && step?.laneId !== lane.id
                  ? `Stap verplaatst en verantwoordelijkheid gewijzigd naar ${lane.naam}.`
                  : 'Stap verplaatst.',
              )
            }}
            onEdgeClick={(_, edge) => {
              setSelectedEdgeId(edge.id)
              setSelectedStepId(undefined)
              setSelectedLaneId(undefined)
            }}
            onPaneClick={() => {
              setSelectedStepId(undefined)
              setSelectedLaneId(undefined)
              setSelectedEdgeId(undefined)
            }}
            onConnect={connect}
            onReconnect={reconnect}
            isValidConnection={(connection) =>
              Boolean(stripStepPrefix(connection.source)) &&
              Boolean(stripStepPrefix(connection.target)) &&
              connection.source !== connection.target
            }
            edgesReconnectable
            nodesConnectable
            nodesDraggable
            elementsSelectable
            deleteKeyCode={null}
            snapToGrid
            snapGrid={[12, 12]}
            panOnScroll
            zoomOnScroll
            minZoom={EDITOR_MIN_ZOOM}
            maxZoom={EDITOR_MAX_ZOOM}
            onlyRenderVisibleElements
            fitView
          >
            <Background gap={24} size={1} color="#d8dbe2" />
            <MiniMap
              pannable
              zoomable
              nodeColor={(node) =>
                node.type === 'editorLane'
                  ? '#eceef2'
                  : String((node.data as { laneColor?: string }).laneColor ?? '#6b7280')
              }
            />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>

        <aside className="pe-inspector" aria-label="Eigenschappen">
          {selectedStep ? (
            <>
              <h2>Stap {selectedStep.nummer || 'zonder nummer'}</h2>
              <p className="muted">{typeLabel[selectedStep.type]} · id {selectedStep.id}</p>
              {selectedStepAiIssues.length > 0 && (
                <section className="pe-step-ai-findings" aria-label="AI-onderhoudssignalen voor geselecteerde stap">
                  <h3>AI-onderhoudssignalen</h3>
                  <ul>
                    {selectedStepAiIssues.map((issue) => (
                      <li key={issue.id} className={`severity-${issue.ernst}`}>
                        <strong>{issue.titel}</strong>
                        <p>{issue.bevinding}</p>
                        <p>{issue.uitleg}</p>
                        {issue.bronIds.length > 0 && aiSteward?.result && (
                          <ul className="pe-step-ai-citations" aria-label="Bronnen">
                            {aiSteward.result.bronnen
                              .filter((source) => issue.bronIds.includes(source.id))
                              .map((source) => (
                                <li key={source.id}>{source.label}</li>
                              ))}
                          </ul>
                        )}
                        {aiSteward?.result?.wijzigingen.some(
                          (change) => change.stapId === issue.stapId,
                        ) && aiSteward.onSelectIssue && (
                          <button
                            type="button"
                            onClick={() => aiSteward.onSelectIssue?.(issue.id)}
                          >
                            Bekijk in voorstel
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {selectedStepKaderIssues.length > 0 && (
                <section className="pe-step-findings" aria-label="Kaderbevindingen voor geselecteerde stap">
                  <h3>ISO-/kaderbevindingen</h3>
                  <ul>
                    {selectedStepKaderIssues.map((issue, index) => (
                      <li key={`${issue.kaderId ?? 'kader'}:${issue.controleId ?? index}`}>
                        <strong>{issue.titel ?? 'Kaderbevinding'}</strong>
                        {issue.kaderNaam && <span>{issue.kaderNaam}</span>}
                        <p>{issue.bericht}</p>
                        {issue.advies && <p className="pe-step-finding-advice">Volgende stap: {issue.advies}</p>}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              <div className="pe-inspector-grid">
                <label>
                  Nummer
                  <input
                    value={selectedStep.nummer}
                    onChange={(event) => updateStep(selectedStep.id, { nummer: event.target.value }, 'nummer')}
                  />
                </label>
                <label>
                  Type
                  <select
                    value={selectedStep.type}
                    onChange={(event) => changeStepType(selectedStep.id, event.target.value as StepType)}
                  >
                    {(['start', 'actie', 'beslissing', 'bericht', 'subproces', 'eind', 'marker'] as StepType[]).map((type) => (
                      <option key={type} value={type}>{typeLabel[type]}</option>
                    ))}
                  </select>
                </label>
                <label className="pe-wide">
                  Activiteit
                  <textarea
                    rows={3}
                    value={selectedStep.activiteit}
                    onChange={(event) =>
                      updateStep(selectedStep.id, { activiteit: event.target.value }, 'activiteit')
                    }
                  />
                </label>
                <label>
                  Verantwoordelijke
                  <select
                    value={selectedStep.laneId}
                    onChange={(event) => updateStep(selectedStep.id, { laneId: event.target.value }, 'lane')}
                  >
                    {proces.lanes.map((lane) => <option key={lane.id} value={lane.id}>{lane.naam}</option>)}
                  </select>
                </label>
                <label>
                  Sectie
                  <select
                    value={selectedStep.sectieId ?? ''}
                    onChange={(event) =>
                      updateStep(selectedStep.id, { sectieId: event.target.value || undefined }, 'sectie')
                    }
                  >
                    <option value="">Geen sectie</option>
                    {proces.secties.map((section) => (
                      <option key={section.id} value={section.id}>{section.naam}</option>
                    ))}
                  </select>
                </label>
                {selectedStep.type === 'bericht' && (
                  <label className="pe-wide">
                    Bericht naar rol
                    <select
                      value={selectedStep.doelLaneId ?? ''}
                      onChange={(event) =>
                        updateStep(
                          selectedStep.id,
                          { doelLaneId: event.target.value || undefined },
                          'doelLane',
                        )
                      }
                    >
                      <option value="">Kies ontvanger…</option>
                      {proces.lanes.map((lane) => <option key={lane.id} value={lane.id}>{lane.naam}</option>)}
                    </select>
                  </label>
                )}
                {selectedStep.type !== 'beslissing' && selectedStep.type !== 'eind' && (
                  <label className="pe-wide">
                    Direct vervolg
                    <select
                      value={selectedStep.naarStap ?? ''}
                      onChange={(event) => changeDirectTarget(selectedStep, event.target.value)}
                    >
                      <option value="">Geen direct vervolg</option>
                      {proces.stappen
                        .filter((step) => step.id !== selectedStep.id)
                        .map((step) => (
                          <option key={step.id} value={step.id}>
                            {step.nummer} · {step.activiteit}
                          </option>
                        ))}
                    </select>
                  </label>
                )}
                <label className="pe-wide">
                  Vervolgproces
                  <input
                    list="pe-known-processes"
                    value={selectedStep.naarProces ?? ''}
                    onChange={(event) =>
                      updateStep(
                        selectedStep.id,
                        { naarProces: event.target.value || undefined },
                        'naarProces',
                      )
                    }
                  />
                </label>
              </div>

              {selectedStep.type === 'beslissing' && (
                <>
                  <h3>Beslisroutes</h3>
                  <div className="pe-route-list">
                    {(selectedStep.routes ?? []).map((route) => (
                      <div className="pe-route-card" key={route.id}>
                        <div className="pe-inspector-grid">
                          <label>
                            Label
                            <input
                              value={route.label}
                              onChange={(event) =>
                                changeRoute(selectedStep.id, route.id, { label: event.target.value }, 'label')
                              }
                            />
                          </label>
                          <label>
                            Doel
                            <select
                              value={route.naarStap ?? ''}
                              onChange={(event) =>
                                changeRoute(
                                  selectedStep.id,
                                  route.id,
                                  {
                                    naarStap: event.target.value || undefined,
                                    ...(event.target.value ? { naarProces: undefined } : {}),
                                  },
                                  'target',
                                )
                              }
                            >
                              <option value="">Geen stapdoel</option>
                              {proces.stappen
                                .filter((step) => step.id !== selectedStep.id)
                                .map((step) => (
                                  <option key={step.id} value={step.id}>
                                    {step.nummer} · {step.activiteit}
                                  </option>
                                ))}
                            </select>
                          </label>
                          <label className="pe-wide">
                            Vervolgproces
                            <input
                              list="pe-known-processes"
                              value={route.naarProces ?? ''}
                              onChange={(event) =>
                                changeRoute(
                                  selectedStep.id,
                                  route.id,
                                  {
                                    naarProces: event.target.value || undefined,
                                    ...(event.target.value ? { naarStap: undefined } : {}),
                                  },
                                  'processTarget',
                                )
                              }
                            />
                          </label>
                          <label className="pe-wide">
                            Voorwaarde
                            <input
                              value={route.voorwaarde ?? ''}
                              onChange={(event) =>
                                changeRoute(
                                  selectedStep.id,
                                  route.id,
                                  { voorwaarde: event.target.value || undefined },
                                  'condition',
                                )
                              }
                            />
                          </label>
                          <label className="pe-wide pe-check">
                            <input
                              type="checkbox"
                              checked={Boolean(route.standaard)}
                              onChange={(event) => {
                                const current = processRef.current
                                const updated = current.stappen.map((step) =>
                                  step.id === selectedStep.id
                                    ? {
                                        ...step,
                                        routes: step.routes?.map((candidate) => ({
                                          ...candidate,
                                          standaard: candidate.id === route.id
                                            ? event.target.checked || undefined
                                            : undefined,
                                        })),
                                      }
                                    : step,
                                )
                                commit({ ...current, stappen: updated }, 'Standaardroute aangepast.')
                              }}
                            />
                            Standaardroute
                          </label>
                        </div>
                        <div className="pe-inspector-actions">
                          <button
                            className="pe-danger"
                            onClick={() => {
                              if (!window.confirm(`Route "${route.label || route.id}" verwijderen?`)) return
                              applyMutation(
                                deleteRoute(proces, selectedStep.id, route.id),
                                'Route verwijderd.',
                              )
                            }}
                          >
                            Route verwijderen
                          </button>
                        </div>
                      </div>
                    ))}
                    {(selectedStep.routes?.length ?? 0) === 0 && (
                      <p className="muted">Trek vanaf de onderste aansluiting een lijn naar een doelstap.</p>
                    )}
                    <div className="pe-inspector-actions">
                      <button
                        disabled={proces.stappen.length < 2}
                        onClick={() => {
                          const target = proces.stappen.find((step) => step.id !== selectedStep.id)
                          if (!target) return
                          setRouteDialog({
                            sourceId: selectedStep.id,
                            targetId: target.id,
                            label: '',
                            voorwaarde: '',
                            standaard: false,
                          })
                        }}
                      >
                        + Route toevoegen
                      </button>
                    </div>
                  </div>
                </>
              )}

              <details>
                <summary>Meer eigenschappen</summary>
                <div className="pe-inspector-grid pe-more">
                  <label className="pe-wide">
                    Toelichting
                    <textarea
                      rows={2}
                      value={selectedStep.toelichting ?? ''}
                      onChange={(event) =>
                        updateStep(
                          selectedStep.id,
                          { toelichting: event.target.value || undefined },
                          'toelichting',
                        )
                      }
                    />
                  </label>
                  <label className="pe-wide">
                    Opmerking / werkinstructie
                    <textarea
                      rows={2}
                      value={selectedStep.opmerking ?? ''}
                      onChange={(event) =>
                        updateStep(
                          selectedStep.id,
                          { opmerking: event.target.value || undefined },
                          'opmerking',
                        )
                      }
                    />
                  </label>
                  <label>
                    Zij-notitie / status
                    <input
                      value={selectedStep.zijnotitie ?? ''}
                      onChange={(event) =>
                        updateStep(
                          selectedStep.id,
                          { zijnotitie: event.target.value || undefined },
                          'zijnotitie',
                        )
                      }
                    />
                  </label>
                  <label>
                    ERP-status
                    <input
                      list="erp-statussen"
                      value={selectedStep.erpStatus ?? ''}
                      onChange={(event) =>
                        updateStep(
                          selectedStep.id,
                          { erpStatus: event.target.value || undefined },
                          'erpStatus',
                        )
                      }
                    />
                  </label>
                  <label className="pe-wide">
                    Voorwaarde
                    <input
                      value={selectedStep.voorwaarde ?? ''}
                      onChange={(event) =>
                        updateStep(
                          selectedStep.id,
                          { voorwaarde: event.target.value || undefined },
                          'voorwaarde',
                        )
                      }
                    />
                  </label>
                  <label>
                    Termijn
                    <input
                      value={selectedStep.termijn ?? ''}
                      onChange={(event) =>
                        updateStep(selectedStep.id, { termijn: event.target.value || undefined }, 'termijn')
                      }
                    />
                  </label>
                  <label>
                    Waarschuwing
                    <input
                      value={selectedStep.waarschuwing ?? ''}
                      onChange={(event) =>
                        updateStep(
                          selectedStep.id,
                          { waarschuwing: event.target.value || undefined },
                          'waarschuwing',
                        )
                      }
                    />
                  </label>
                  <label className="pe-wide">
                    Checklist (één regel per punt)
                    <textarea
                      rows={4}
                      value={listToText(selectedStep.checklist)}
                      onChange={(event) =>
                        updateStep(selectedStep.id, { checklist: textToList(event.target.value) }, 'checklist')
                      }
                    />
                  </label>
                  <label className="pe-wide">
                    Foto-eisen (één regel per eis)
                    <textarea
                      rows={4}
                      value={listToText(selectedStep.fotoEisen)}
                      onChange={(event) =>
                        updateStep(selectedStep.id, { fotoEisen: textToList(event.target.value) }, 'fotoEisen')
                      }
                    />
                  </label>
                </div>
              </details>
              <div className="pe-inspector-actions">
                <button onClick={duplicateSelected}>Dupliceer stap</button>
                <button className="pe-danger" onClick={removeSelectedStep}>Verwijder stap</button>
              </div>
            </>
          ) : selectedEdge ? (
            <>
              <h2>{selectedEdge.kind === 'route' ? 'Beslisroute' : 'Procesverbinding'}</h2>
              <p className="muted">
                {selectedEdge.sourceStepId} → {selectedEdge.targetStepId}
              </p>
              {selectedEdge.kind === 'route' && (
                <p><strong>{selectedEdge.label}</strong></p>
              )}
              <label>
                Doelstap
                <select
                  value={selectedEdge.targetStepId}
                  onChange={(event) =>
                    applyMutation(
                      reconnectEditorEdge(proces, selectedEdge.id, event.target.value),
                      'Doel van verbinding aangepast.',
                    )
                  }
                >
                  {proces.stappen
                    .filter((step) => step.id !== selectedEdge.sourceStepId)
                    .map((step) => (
                      <option key={step.id} value={step.id}>
                        {step.nummer} · {step.activiteit}
                      </option>
                    ))}
                </select>
              </label>
              <p className="pe-help">
                Je kunt het eindpunt ook direct naar een andere stap slepen. De bron blijft bewust vaststaan.
              </p>
              <div className="pe-inspector-actions">
                <button className="pe-danger" onClick={deleteSelectedEdge}>Verwijder verbinding</button>
              </div>
            </>
          ) : selectedLane ? (
            <>
              <h2>Rol / lane</h2>
              <div className="pe-inspector-grid">
                <label className="pe-wide">
                  Naam
                  <input
                    value={selectedLane.naam}
                    onChange={(event) => {
                      const current = processRef.current
                      commit({
                        ...current,
                        lanes: current.lanes.map((lane) =>
                          lane.id === selectedLane.id ? { ...lane, naam: event.target.value } : lane,
                        ),
                      }, 'Rolnaam aangepast.', `lane:${selectedLane.id}:name`)
                    }}
                  />
                </label>
                <label className="pe-wide">
                  Kleur
                  <input
                    type="color"
                    value={selectedLane.kleur}
                    onChange={(event) => {
                      const current = processRef.current
                      commit({
                        ...current,
                        lanes: current.lanes.map((lane) =>
                          lane.id === selectedLane.id ? { ...lane, kleur: event.target.value } : lane,
                        ),
                      }, 'Rolkleur aangepast.', `lane:${selectedLane.id}:color`)
                    }}
                  />
                </label>
              </div>
              <div className="pe-inspector-actions">
                <button className="pe-danger" onClick={() => deleteLane(selectedLane)}>Verwijder rol</button>
              </div>
            </>
          ) : (
            <>
              <h2>Procesinstellingen</h2>
              <p className="pe-help">
                Selecteer een stap, lijn of lane voor de bijbehorende eigenschappen.
              </p>
              <div className="pe-inspector-grid">
                <label className="pe-wide">
                  Procesnaam
                  <input
                    value={proces.detailproces}
                    onChange={(event) =>
                      commit(
                        { ...processRef.current, detailproces: event.target.value },
                        'Procesnaam aangepast.',
                        'process:name',
                      )
                    }
                  />
                </label>
                <label>
                  Hoofdproces
                  <input
                    value={proces.hoofdproces}
                    onChange={(event) =>
                      commit(
                        { ...processRef.current, hoofdproces: event.target.value },
                        'Hoofdproces aangepast.',
                        'process:main',
                      )
                    }
                  />
                </label>
                <label>
                  Versie
                  <input
                    value={proces.versie}
                    onChange={(event) =>
                      commit(
                        { ...processRef.current, versie: event.target.value },
                        'Versie aangepast.',
                        'process:version',
                      )
                    }
                  />
                </label>
              </div>
              <h3>Rollen</h3>
              <div className="pe-route-list">
                {proces.lanes.map((lane) => (
                  <button
                    key={lane.id}
                    className="pe-list-button"
                    onClick={() => setSelectedLaneId(lane.id)}
                  >
                    <span style={{ background: lane.kleur }} />
                    {lane.naam}
                  </button>
                ))}
              </div>
              <div className="pe-inspector-actions">
                <button onClick={() => {
                  const current = processRef.current
                  const id = newId('rol', new Set(current.lanes.map((lane) => lane.id)))
                  commit({
                    ...current,
                    lanes: [...current.lanes, { id, naam: 'Nieuwe rol', kleur: '#10B981' }],
                  }, 'Nieuwe rol toegevoegd.')
                  setSelectedLaneId(id)
                }}>
                  + Rol
                </button>
              </div>
              <h3>Secties</h3>
              <div className="pe-route-list">
                {proces.secties.map((section) => (
                  <div className="pe-route-card" key={section.id}>
                    <label>
                      Naam
                      <input
                        value={section.naam}
                        onChange={(event) => {
                          const current = processRef.current
                          commit({
                            ...current,
                            secties: current.secties.map((candidate) =>
                              candidate.id === section.id
                                ? { ...candidate, naam: event.target.value }
                                : candidate,
                            ),
                          }, 'Sectienaam aangepast.', `section:${section.id}:name`)
                        }}
                      />
                    </label>
                    <div className="pe-inspector-actions">
                      <button className="pe-danger" onClick={() => deleteSection(section)}>Verwijder</button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="pe-inspector-actions">
                <button onClick={() => {
                  const current = processRef.current
                  const id = newId('sectie', new Set(current.secties.map((section) => section.id)))
                  commit({
                    ...current,
                    secties: [...current.secties, { id, naam: 'Nieuwe sectie' }],
                  }, 'Nieuwe sectie toegevoegd.')
                }}>
                  + Sectie
                </button>
              </div>
            </>
          )}
        </aside>
      </div>

      {routeDialog && (
        <div className="pe-dialog-backdrop" role="presentation">
          <div
            className="pe-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="route-dialog-title"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                setRouteDialog(undefined)
              }
            }}
          >
            <h2 id="route-dialog-title">Beslisroute benoemen</h2>
            <p className="muted">
              De editor maakt pas een route als het bedoelde pad duidelijk is.
            </p>
            <label>
              Doelstap *
              <select
                value={routeDialog.targetId}
                onChange={(event) =>
                  setRouteDialog({ ...routeDialog, targetId: event.target.value, fout: undefined })
                }
              >
                {proces.stappen
                  .filter((step) => step.id !== routeDialog.sourceId)
                  .map((step) => (
                    <option key={step.id} value={step.id}>
                      {step.nummer} · {step.activiteit}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Route-label *
              <input
                autoFocus
                value={routeDialog.label}
                placeholder="Bijvoorbeeld: Ja, Nee of Spoed"
                onChange={(event) =>
                  setRouteDialog({ ...routeDialog, label: event.target.value, fout: undefined })
                }
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    submitRoute()
                  }
                }}
              />
            </label>
            <label>
              Voorwaarde (optioneel)
              <textarea
                rows={2}
                value={routeDialog.voorwaarde}
                onChange={(event) =>
                  setRouteDialog({ ...routeDialog, voorwaarde: event.target.value })
                }
              />
            </label>
            <label className="pe-check">
              <input
                type="checkbox"
                checked={routeDialog.standaard}
                onChange={(event) =>
                  setRouteDialog({ ...routeDialog, standaard: event.target.checked })
                }
              />
              Gebruik als standaardroute
            </label>
            {routeDialog.fout && <p className="pe-error" role="alert">{routeDialog.fout}</p>}
            <div className="pe-inspector-actions">
              <button onClick={submitRoute}>Route maken</button>
              <button onClick={() => setRouteDialog(undefined)}>Annuleren</button>
            </div>
          </div>
        </div>
      )}

      <div className="pe-live" aria-live="polite">{announcement}</div>
    </div>
  )
}
