import type { Lane, Process, ProcessNodePlacement, Section, Step } from '../../contract'
import type {
  DiagramExport,
  DiagramFormatAdapter,
  DiagramWarning,
  ImportReport,
  ImportedGeometry,
  UnmappedDiagramItem,
} from './types'
import { unavailableImport } from './types'

const FORMAT = 'drawio-xml' as const
const SCHEMA_VERSION = '1'
const MAX_SOURCE_CHARS = 10_000_000
const MAX_EXPANDED_CHARS = 10_000_000
const MAX_COMPRESSION_RATIO = 100
const MAX_ELEMENTS = 5_000
const MAX_METADATA_CHARS = 100_000
const LANE_WIDTH = 240
const STEP_WIDTH = 200
const STEP_HEIGHT = 72
const ROW_HEIGHT = 136
const START_Y = 70
const SECTION_HEIGHT = 44
const MAX_LAYOUT_VALUE = 1_000_000

type MetadataKind = 'lane' | 'section' | 'step'

interface ProcessHeader {
  id: string
  hoofdproces: string
  detailproces: string
  versie: string
  status: Process['status']
  laatsteWijziging: string
  revision?: number
  bron?: Process['bron']
}

interface ObjectCell {
  object: Element
  cell: Element
  kind: MetadataKind
  semanticId: string
}

interface GenericCell {
  cell: Element
  externalId: string
  label: string
  style: string
  parentId?: string
}

function emptyReport(): ImportReport {
  return {
    ok: false,
    format: FORMAT,
    process: null,
    geometry: [],
    warnings: [],
    unmapped: [],
    confidence: { overall: 0, mappedItems: 0, totalItems: 0, metadataBacked: false },
    errors: [],
  }
}

function createElement(document: XMLDocument, name: string, attributes: Record<string, string>): Element {
  const element = document.createElement(name)
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value)
  return element
}

function appendGeometry(
  document: XMLDocument,
  cell: Element,
  geometry: { x: number; y: number; width: number; height: number },
): void {
  cell.appendChild(
    createElement(document, 'mxGeometry', {
      x: String(geometry.x),
      y: String(geometry.y),
      width: String(geometry.width),
      height: String(geometry.height),
      as: 'geometry',
    }),
  )
}

function appendObjectCell(
  document: XMLDocument,
  root: Element,
  input: {
    externalId: string
    kind: MetadataKind
    semanticId: string
    label: string
    data: Lane | Section | Step
    style: string
    geometry: { x: number; y: number; width: number; height: number }
  },
): void {
  const object = createElement(document, 'object', {
    label: input.label,
    spgSchema: SCHEMA_VERSION,
    spgKind: input.kind,
    spgId: input.semanticId,
    spgData: JSON.stringify(input.data),
  })
  const cell = createElement(document, 'mxCell', {
    id: input.externalId,
    parent: '1',
    vertex: '1',
    style: input.style,
  })
  appendGeometry(document, cell, input.geometry)
  object.appendChild(cell)
  root.appendChild(object)
}

function appendEdge(
  document: XMLDocument,
  root: Element,
  input: {
    id: string
    kind: 'transition' | 'route' | 'message'
    source: string
    target: string
    label?: string
    routeId?: string
  },
): void {
  const object = createElement(document, 'object', {
    label: input.label ?? '',
    spgSchema: SCHEMA_VERSION,
    spgKind: input.kind,
    spgSourceStepId: input.source.replace(/^step:/, ''),
    ...(input.routeId ? { spgRouteId: input.routeId } : {}),
  })
  const cell = createElement(document, 'mxCell', {
    id: input.id,
    parent: '1',
    edge: '1',
    source: input.source,
    target: input.target,
    style:
      input.kind === 'message'
        ? 'edgeStyle=orthogonalEdgeStyle;rounded=0;endArrow=block;strokeColor=#ea5b0c;'
        : 'edgeStyle=orthogonalEdgeStyle;rounded=1;endArrow=block;strokeColor=#8b8b95;',
  })
  cell.appendChild(createElement(document, 'mxGeometry', { relative: '1', as: 'geometry' }))
  object.appendChild(cell)
  root.appendChild(object)
}

function stepStyle(step: Step, laneColor: string): string {
  const common = `whiteSpace=wrap;html=0;strokeColor=${laneColor};fillColor=#ffffff;fontSize=12;`
  if (step.type === 'beslissing') return `rhombus;${common}`
  if (step.type === 'start') return `ellipse;${common}aspect=fixed;`
  if (step.type === 'eind') return `ellipse;${common}double=1;aspect=fixed;`
  if (step.type === 'subproces') return `rounded=1;${common}double=1;`
  return `rounded=1;${common}`
}

function safeFilePart(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
  return normalized || 'proces'
}

function veiligeCoordinaat(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= MAX_LAYOUT_VALUE
    ? value
    : fallback
}

function veiligeAfmeting(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= MAX_LAYOUT_VALUE
    ? value
    : fallback
}

function handmatigeStapPlaatsing(process: Process, stepId: string): ProcessNodePlacement | undefined {
  const layout = process.diagramLayout
  if (layout?.version !== 1 || layout.coordinateSystem !== 'px96-y-down') return undefined
  const placement = layout.nodes[`step:${stepId}`]
  return placement && typeof placement === 'object' ? placement : undefined
}

export function exportDrawIo(process: Process): DiagramExport {
  if (typeof document === 'undefined' || typeof XMLSerializer === 'undefined') {
    return {
      ok: false,
      format: FORMAT,
      warnings: [],
      errors: [{ code: 'browser-xml-required', message: 'draw.io-export vereist browser-XML-ondersteuning.' }],
    }
  }

  const warnings: DiagramWarning[] = []
  const xml = document.implementation.createDocument('', '', null)
  const mxfile = createElement(xml, 'mxfile', {
    host: 'Service Procesgids',
    agent: 'Service Procesgids draw.io exchange',
    version: '1',
    compressed: 'false',
  })
  const header: ProcessHeader = {
    id: process.id,
    hoofdproces: process.hoofdproces,
    detailproces: process.detailproces,
    versie: process.versie,
    status: process.status,
    laatsteWijziging: process.laatsteWijziging,
    revision: process.revision,
    bron: process.bron,
  }
  const diagram = createElement(xml, 'diagram', {
    id: `spg:${process.id}`,
    name: process.detailproces,
    spgSchema: SCHEMA_VERSION,
    spgProcess: JSON.stringify(header),
  })
  const graph = createElement(xml, 'mxGraphModel', {
    dx: '1200',
    dy: '800',
    grid: '1',
    gridSize: '10',
    page: '1',
    pageScale: '1',
    pageWidth: String(Math.max(827, process.lanes.length * LANE_WIDTH + 80)),
    pageHeight: '1169',
  })
  const root = xml.createElement('root')
  root.appendChild(createElement(xml, 'mxCell', { id: '0' }))
  root.appendChild(createElement(xml, 'mxCell', { id: '1', parent: '0' }))

  const orderedGroups: Array<{ section?: Section; steps: Step[] }> = process.secties.map((section) => ({
    section,
    steps: process.stappen.filter((step) => step.sectieId === section.id),
  }))
  const withoutSection = process.stappen.filter(
    (step) => !step.sectieId || !process.secties.some((section) => section.id === step.sectieId),
  )
  if (withoutSection.length > 0) orderedGroups.push({ steps: withoutSection })

  const stepY = new Map<string, number>()
  let y = START_Y
  for (const group of orderedGroups) {
    if (group.section) {
      appendObjectCell(xml, root, {
        externalId: `section:${group.section.id}`,
        kind: 'section',
        semanticId: group.section.id,
        label: group.section.naam,
        data: group.section,
        style: 'shape=rect;rounded=0;fillColor=#f3f4f6;strokeColor=#d1d5db;fontStyle=1;align=left;',
        geometry: {
          x: 0,
          y: y - 8,
          width: Math.max(LANE_WIDTH, process.lanes.length * LANE_WIDTH),
          height: 32,
        },
      })
      y += SECTION_HEIGHT
    }
    for (const step of group.steps) {
      stepY.set(step.id, y)
      y += ROW_HEIGHT
    }
    y += 12
  }
  const stepGeometry = new Map<string, { x: number; y: number; width: number; height: number }>()
  for (const step of process.stappen) {
    const laneIndex = Math.max(
      0,
      process.lanes.findIndex((lane) => lane.id === step.laneId),
    )
    const fallback = {
      x: laneIndex * LANE_WIDTH + (LANE_WIDTH - STEP_WIDTH) / 2,
      y: stepY.get(step.id) ?? START_Y,
      width: STEP_WIDTH,
      height: STEP_HEIGHT,
    }
    const placement = handmatigeStapPlaatsing(process, step.id)
    stepGeometry.set(step.id, {
      x: veiligeCoordinaat(placement?.x, fallback.x),
      y: veiligeCoordinaat(placement?.y, fallback.y),
      width: veiligeAfmeting(placement?.width, fallback.width),
      height: veiligeAfmeting(placement?.height, fallback.height),
    })
  }
  const manualBottom = Math.max(
    0,
    ...Array.from(stepGeometry.values(), (geometry) => geometry.y + geometry.height),
  )
  const manualRight = Math.max(
    0,
    ...Array.from(stepGeometry.values(), (geometry) => geometry.x + geometry.width),
  )
  const totalHeight = Math.max(240, y, manualBottom + 40)
  graph.setAttribute(
    'pageWidth',
    String(Math.max(827, process.lanes.length * LANE_WIDTH + 80, manualRight + 80)),
  )
  graph.setAttribute('pageHeight', String(Math.max(1169, totalHeight + 80)))

  process.lanes.forEach((lane, index) => {
    appendObjectCell(xml, root, {
      externalId: `lane:${lane.id}`,
      kind: 'lane',
      semanticId: lane.id,
      label: lane.naam,
      data: lane,
      style: `shape=swimlane;horizontal=0;startSize=30;fillColor=${lane.kleur};opacity=20;strokeColor=${lane.kleur};`,
      geometry: { x: index * LANE_WIDTH, y: 0, width: LANE_WIDTH, height: totalHeight },
    })
  })

  for (const step of process.stappen) {
    const laneIndex = Math.max(
      0,
      process.lanes.findIndex((lane) => lane.id === step.laneId),
    )
    const lane = process.lanes[laneIndex]
    if (!lane) {
      warnings.push({
        code: 'unknown-lane',
        message: `Stap '${step.id}' verwijst naar een onbekende lane en is in de eerste kolom geplaatst.`,
        elementId: step.id,
      })
    }
    appendObjectCell(xml, root, {
      externalId: `step:${step.id}`,
      kind: 'step',
      semanticId: step.id,
      label: step.activiteit,
      data: step,
      style: stepStyle(step, lane?.kleur ?? '#9ca3af'),
      geometry: stepGeometry.get(step.id) ?? {
        x: laneIndex * LANE_WIDTH + (LANE_WIDTH - STEP_WIDTH) / 2,
        y: stepY.get(step.id) ?? START_Y,
        width: STEP_WIDTH,
        height: STEP_HEIGHT,
      },
    })
  }

  const knownSteps = new Set(process.stappen.map((step) => step.id))
  const knownLanes = new Set(process.lanes.map((lane) => lane.id))
  for (const step of process.stappen) {
    if (step.naarStap && knownSteps.has(step.naarStap)) {
      appendEdge(xml, root, {
        id: `transition:${step.id}`,
        kind: 'transition',
        source: `step:${step.id}`,
        target: `step:${step.naarStap}`,
      })
    } else if (step.naarStap) {
      warnings.push({
        code: 'unknown-target',
        message: `Stap '${step.id}' verwijst naar onbekende stap '${step.naarStap}'; de verbinding is niet getekend.`,
        elementId: step.id,
      })
    }
    for (const route of step.routes ?? []) {
      if (route.naarStap && knownSteps.has(route.naarStap)) {
        appendEdge(xml, root, {
          id: `route:${step.id}:${route.id}`,
          kind: 'route',
          source: `step:${step.id}`,
          target: `step:${route.naarStap}`,
          label: route.label,
          routeId: route.id,
        })
      } else if (route.naarStap) {
        warnings.push({
          code: 'unknown-route-target',
          message: `Route '${route.id}' verwijst naar onbekende stap '${route.naarStap}'; de verbinding is niet getekend.`,
          elementId: route.id,
        })
      }
    }
    if (step.type === 'bericht' && step.doelLaneId && knownLanes.has(step.doelLaneId)) {
      appendEdge(xml, root, {
        id: `message:${step.id}`,
        kind: 'message',
        source: `step:${step.id}`,
        target: `lane:${step.doelLaneId}`,
      })
    } else if (step.type === 'bericht' && step.doelLaneId) {
      warnings.push({
        code: 'unknown-message-lane',
        message: `Berichtstap '${step.id}' verwijst naar onbekende doel-lane '${step.doelLaneId}'.`,
        elementId: step.id,
      })
    }
  }

  graph.appendChild(root)
  diagram.appendChild(graph)
  mxfile.appendChild(diagram)
  xml.appendChild(mxfile)
  const content = `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(xml)}`
  return {
    ok: true,
    format: FORMAT,
    fileName: `${safeFilePart(process.id)}.drawio`,
    mediaType: 'application/vnd.jgraph.mxfile',
    content,
    warnings,
    errors: [],
  }
}

function directChild(element: Element, name: string): Element | null {
  for (const child of Array.from(element.children)) if (child.localName === name) return child
  return null
}

function parseJsonAttribute<T>(element: Element, name: string): T | null {
  const raw = element.getAttribute(name)
  if (!raw || raw.length > MAX_METADATA_CHARS) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function finiteNumber(raw: string | null): number | undefined {
  if (raw === null || raw.trim() === '') return undefined
  const value = Number(raw)
  return Number.isFinite(value) && Math.abs(value) <= 1_000_000 ? value : undefined
}

function geometryOf(cell: Element): Pick<ImportedGeometry, 'x' | 'y' | 'width' | 'height'> {
  const geometry = directChild(cell, 'mxGeometry')
  return geometry
    ? {
        x: finiteNumber(geometry.getAttribute('x')),
        y: finiteNumber(geometry.getAttribute('y')),
        width: finiteNumber(geometry.getAttribute('width')),
        height: finiteNumber(geometry.getAttribute('height')),
      }
    : {}
}

function readableLabel(raw: string | null): string {
  if (!raw) return ''
  const withBreaks = raw.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(?:div|p|li)>/gi, '\n')
  const parsed = new DOMParser().parseFromString(`<body>${withBreaks}</body>`, 'text/html')
  return (parsed.body.textContent ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

function labelOf(cell: Element): string {
  const wrapper = cell.parentElement?.localName === 'object' ? cell.parentElement : null
  return readableLabel(
    wrapper?.getAttribute('label') ??
      wrapper?.getAttribute('value') ??
      wrapper?.getAttribute('name') ??
      cell.getAttribute('value'),
  )
}

function genericCells(graphRoot: Element): GenericCell[] {
  const cells: GenericCell[] = []
  for (const cell of Array.from(graphRoot.getElementsByTagName('mxCell'))) {
    const externalId = cell.getAttribute('id')
    if (!externalId || externalId === '0' || externalId === '1') continue
    cells.push({
      cell,
      externalId,
      label: labelOf(cell),
      style: cell.getAttribute('style') ?? '',
      parentId: cell.getAttribute('parent') ?? undefined,
    })
  }
  return cells
}

function isVertex(cell: GenericCell): boolean {
  return cell.cell.getAttribute('vertex') === '1'
}

function isEdge(cell: GenericCell): boolean {
  return cell.cell.getAttribute('edge') === '1'
}

function isSwimlane(cell: GenericCell): boolean {
  if (!isVertex(cell)) return false
  const style = cell.style.toLowerCase()
  return /(?:^|;)swimlane(?:;|$)/.test(style) || /(?:^|;)shape=swimlane(?:;|$)/.test(style)
}

function styleValue(style: string, key: string): string | undefined {
  const prefix = `${key.toLowerCase()}=`
  return style
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.toLowerCase().startsWith(prefix))
    ?.slice(prefix.length)
}

function semanticId(prefix: string, externalId: string): string {
  return `${prefix}-${safeFilePart(externalId)}`
}

function absoluteGeometry(
  cell: GenericCell,
  byExternalId: ReadonlyMap<string, GenericCell>,
): Pick<ImportedGeometry, 'x' | 'y' | 'width' | 'height'> {
  const own = geometryOf(cell.cell)
  let x = own.x
  let y = own.y
  let parentId = cell.parentId
  const seen = new Set<string>()
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId)
    const parent = byExternalId.get(parentId)
    if (!parent) break
    const parentGeometry = geometryOf(parent.cell)
    if (parentGeometry.x !== undefined) x = (x ?? 0) + parentGeometry.x
    if (parentGeometry.y !== undefined) y = (y ?? 0) + parentGeometry.y
    parentId = parent.parentId
  }
  return { x, y, width: own.width, height: own.height }
}

function hasAncestor(
  cell: GenericCell,
  candidateAncestorId: string,
  byExternalId: ReadonlyMap<string, GenericCell>,
): boolean {
  let parentId = cell.parentId
  const seen = new Set<string>()
  while (parentId && !seen.has(parentId)) {
    if (parentId === candidateAncestorId) return true
    seen.add(parentId)
    parentId = byExternalId.get(parentId)?.parentId
  }
  return false
}

function nearestLane(
  cell: GenericCell,
  lanesByExternalId: ReadonlyMap<string, Lane>,
  byExternalId: ReadonlyMap<string, GenericCell>,
): Lane | undefined {
  let parentId = cell.parentId
  const seen = new Set<string>()
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId)
    const lane = lanesByExternalId.get(parentId)
    if (lane) return lane
    parentId = byExternalId.get(parentId)?.parentId
  }
  return undefined
}

function genericStepType(
  cell: GenericCell,
): { type: Step['type']; ambiguousTerminal: boolean } {
  const style = cell.style.toLowerCase()
  const label = cell.label.toLowerCase().replace(/[.!?:]+$/g, '').trim()
  const decision =
    /(?:^|;)rhombus(?:;|$)/.test(style) ||
    style.includes('shape=rhombus') ||
    style.includes('flowchart.decision') ||
    style.includes('shape=mxgraph.flowchart.decision')
  if (decision) return { type: 'beslissing', ambiguousTerminal: false }

  const explicitStart =
    style.includes('flowchart.start') ||
    style.includes('eventtype=start') ||
    style.includes('eventtype=startevent')
  const explicitEnd =
    style.includes('flowchart.end') ||
    style.includes('flowchart.terminator') ||
    style.includes('eventtype=end') ||
    style.includes('eventtype=endevent') ||
    style.includes('doubleellipse')
  const terminalShape =
    /(?:^|;)ellipse(?:;|$)/.test(style) ||
    style.includes('shape=ellipse') ||
    (style.includes('rounded=1') && (style.includes('arcsize=50') || style.includes('arcsize=100')))
  const startLabel = /^(start|begin|proces start)$/.test(label)
  const endLabel = /^(eind|einde|stop|klaar|proces einde)$/.test(label)

  if (explicitStart || (terminalShape && startLabel)) return { type: 'start', ambiguousTerminal: false }
  if (explicitEnd || (terminalShape && endLabel)) return { type: 'eind', ambiguousTerminal: false }
  return { type: 'actie', ambiguousTerminal: terminalShape }
}

function importGenericDrawIo(
  diagram: Element,
  graphRoot: Element,
  report: ImportReport,
): ImportReport {
  const cells = genericCells(graphRoot)
  const byExternalId = new Map(cells.map((cell) => [cell.externalId, cell]))
  const allSwimlanes = cells.filter(isSwimlane)
  // Een buitenste pool is geen verantwoordelijke rol wanneer hij andere swimlanes bevat.
  const roleLaneCells = allSwimlanes.filter(
    (candidate) =>
      !allSwimlanes.some(
        (other) =>
          other.externalId !== candidate.externalId &&
          hasAncestor(other, candidate.externalId, byExternalId),
      ),
  )
  const lanes: Lane[] = []
  const lanesByExternalId = new Map<string, Lane>()
  const palette = ['#3B82F6', '#F59E0B', '#10B981', '#8B5CF6', '#EF4444', '#14B8A6']

  for (const [index, cell] of roleLaneCells.entries()) {
    if (!cell.label) {
      report.errors.push({
        code: 'generic-lane-label-missing',
        message: `Swimlane '${cell.externalId}' heeft geen expliciete rolnaam.`,
        elementId: cell.externalId,
      })
      report.unmapped.push({
        externalId: cell.externalId,
        kind: 'lane',
        reason: 'Een lane zonder label kan niet veilig als verantwoordelijke rol worden gebruikt.',
      })
      continue
    }
    const color = styleValue(cell.style, 'fillColor')
    const lane: Lane = {
      id: semanticId('lane', cell.externalId),
      naam: cell.label,
      kleur: color && /^#[0-9a-f]{6}$/i.test(color) ? color : palette[index % palette.length],
    }
    lanes.push(lane)
    lanesByExternalId.set(cell.externalId, lane)
    report.geometry.push({
      externalId: cell.externalId,
      semanticKind: 'lane',
      semanticId: lane.id,
      ...absoluteGeometry(cell, byExternalId),
    })
  }
  if (lanes.length === 0) {
    report.errors.push({
      code: 'generic-lanes-missing',
      message: 'Geen expliciet gelabelde swimlane-ouders gevonden; rollen worden niet uit positie gegokt.',
    })
    report.unmapped.push({
      externalId: `diagram:${diagram.getAttribute('id') ?? 'pagina'}`,
      kind: 'lanes',
      reason: 'Het diagram bevat geen expliciete, gelabelde swimlane-ouders voor verantwoordelijkheden.',
    })
  }

  const stepCells = cells.filter((cell) => isVertex(cell) && !isSwimlane(cell))
  const orderedStepCells = [...stepCells].sort((left, right) => {
    const a = absoluteGeometry(left, byExternalId)
    const b = absoluteGeometry(right, byExternalId)
    return (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0) || left.externalId.localeCompare(right.externalId)
  })
  const steps: Step[] = []
  const stepIdByExternalId = new Map<string, string>()
  let displayNumber = 1
  for (const cell of orderedStepCells) {
    if (!cell.label) {
      report.errors.push({
        code: 'generic-step-label-missing',
        message: `Vorm '${cell.externalId}' heeft geen expliciete activiteit.`,
        elementId: cell.externalId,
      })
      report.unmapped.push({
        externalId: cell.externalId,
        kind: 'step',
        reason: 'Een ongelabelde vorm kan niet veilig als processtap worden geïnterpreteerd.',
      })
      continue
    }
    const lane = nearestLane(cell, lanesByExternalId, byExternalId)
    if (!lane) {
      report.errors.push({
        code: 'generic-step-role-missing',
        message: `Stap '${cell.label}' is geen kind van een expliciete swimlane.`,
        elementId: cell.externalId,
      })
      report.unmapped.push({
        externalId: cell.externalId,
        kind: 'step',
        reason: 'De verantwoordelijke rol ontbreekt; geometrische overlap wordt niet als lane-toewijzing gebruikt.',
      })
      continue
    }
    const classification = genericStepType(cell)
    if (classification.ambiguousTerminal) {
      report.errors.push({
        code: 'generic-terminal-ambiguous',
        message: `Terminalvorm '${cell.label}' is niet expliciet als Start of Einde gelabeld.`,
        elementId: cell.externalId,
      })
      report.unmapped.push({
        externalId: cell.externalId,
        kind: 'step',
        reason: 'De terminalvorm kan zonder expliciet start-/eindlabel niet veilig worden geclassificeerd.',
      })
      continue
    }
    const id = semanticId('step', cell.externalId)
    const step: Step = {
      id,
      nummer:
        classification.type === 'start'
          ? 'S'
          : classification.type === 'eind'
            ? 'E'
            : String(displayNumber++),
      sectieId: 'hoofd',
      laneId: lane.id,
      type: classification.type,
      activiteit: cell.label,
    }
    steps.push(step)
    stepIdByExternalId.set(cell.externalId, id)
    report.geometry.push({
      externalId: cell.externalId,
      semanticKind: 'step',
      semanticId: id,
      ...absoluteGeometry(cell, byExternalId),
    })
  }

  const stepById = new Map(steps.map((step) => [step.id, step]))
  const outgoing = new Map<string, Array<{ cell: GenericCell; targetId: string; label: string }>>()
  for (const edge of cells.filter(isEdge)) {
    const sourceExternalId = edge.cell.getAttribute('source')
    const targetExternalId = edge.cell.getAttribute('target')
    const sourceId = sourceExternalId ? stepIdByExternalId.get(sourceExternalId) : undefined
    const targetId = targetExternalId ? stepIdByExternalId.get(targetExternalId) : undefined
    if (!sourceExternalId || !targetExternalId || !sourceId || !targetId) {
      report.errors.push({
        code: 'generic-edge-endpoint-missing',
        message: `Verbinding '${edge.externalId}' heeft geen twee herkenbare stap-endpoints.`,
        elementId: edge.externalId,
      })
      report.unmapped.push({
        externalId: edge.externalId,
        kind: 'edge',
        reason: 'Bron en doel moeten beide expliciete, gemapte processtappen zijn.',
      })
      continue
    }
    const entries = outgoing.get(sourceId) ?? []
    entries.push({ cell: edge, targetId, label: edge.label })
    outgoing.set(sourceId, entries)
    report.geometry.push({
      externalId: edge.externalId,
      semanticKind: 'edge',
      semanticId: semanticId('edge', edge.externalId),
      sourceId,
      targetId,
    })
  }

  for (const step of steps) {
    const edges = outgoing.get(step.id) ?? []
    if (step.type === 'eind') {
      if (edges.length > 0) {
        report.errors.push({
          code: 'generic-end-has-outgoing',
          message: `Eindstap '${step.activiteit}' heeft nog een uitgaande verbinding.`,
          elementId: step.id,
        })
      }
      continue
    }
    if (step.type === 'beslissing') {
      if (edges.length < 2) {
        report.errors.push({
          code: 'generic-decision-routes-missing',
          message: `Beslissing '${step.activiteit}' heeft minder dan twee expliciete routes.`,
          elementId: step.id,
        })
        continue
      }
      const routeLabels = new Set<string>()
      step.routes = []
      for (const edge of edges) {
        if (!edge.label) {
          report.errors.push({
            code: 'generic-decision-label-missing',
            message: `Een route vanuit beslissing '${step.activiteit}' heeft geen expliciet label.`,
            elementId: edge.cell.externalId,
          })
          report.unmapped.push({
            externalId: edge.cell.externalId,
            kind: 'route',
            reason: 'Beslisroutes moeten een expliciet label zoals Ja/Nee of een concrete voorwaarde hebben.',
          })
          continue
        }
        const normalizedLabel = edge.label.toLocaleLowerCase()
        if (routeLabels.has(normalizedLabel)) {
          report.errors.push({
            code: 'generic-decision-label-duplicate',
            message: `Beslissing '${step.activiteit}' heeft dubbel routelabel '${edge.label}'.`,
            elementId: edge.cell.externalId,
          })
          continue
        }
        routeLabels.add(normalizedLabel)
        step.routes.push({
          id: semanticId('route', edge.cell.externalId),
          label: edge.label,
          naarStap: edge.targetId,
        })
      }
      continue
    }
    if (edges.length === 0) {
      report.errors.push({
        code: 'generic-step-target-missing',
        message: `Stap '${step.activiteit}' heeft geen expliciet vervolg.`,
        elementId: step.id,
      })
    } else if (edges.length > 1) {
      report.errors.push({
        code: 'generic-implicit-decision',
        message: `Stap '${step.activiteit}' heeft meerdere uitgangen maar geen expliciete beslisvorm.`,
        elementId: step.id,
      })
    } else {
      step.naarStap = edges[0].targetId
    }
  }

  const starts = steps.filter((step) => step.type === 'start')
  const ends = steps.filter((step) => step.type === 'eind')
  if (starts.length !== 1) {
    report.errors.push({
      code: starts.length === 0 ? 'generic-start-missing' : 'generic-start-ambiguous',
      message:
        starts.length === 0
          ? 'Geen expliciete Start-vorm gevonden.'
          : 'Meerdere Start-vormen gevonden; de procesingang is niet eenduidig.',
    })
    if (starts.length === 0) {
      report.unmapped.push({
        externalId: `diagram:${diagram.getAttribute('id') ?? 'pagina'}`,
        kind: 'start',
        reason: 'Een expliciete Start-vorm ontbreekt.',
      })
    }
  }
  if (ends.length === 0) {
    report.errors.push({ code: 'generic-end-missing', message: 'Geen expliciete Einde-vorm gevonden.' })
    report.unmapped.push({
      externalId: `diagram:${diagram.getAttribute('id') ?? 'pagina'}`,
      kind: 'end',
      reason: 'Een expliciete Einde-vorm ontbreekt.',
    })
  }

  if (starts.length === 1) {
    const reachable = new Set<string>()
    const queue = [starts[0].id]
    while (queue.length > 0) {
      const currentId = queue.shift()
      if (!currentId || reachable.has(currentId)) continue
      reachable.add(currentId)
      const step = stepById.get(currentId)
      if (!step) continue
      const targets = [
        step.naarStap,
        ...(step.routes?.map((route) => route.naarStap).filter((id): id is string => Boolean(id)) ?? []),
      ].filter((id): id is string => Boolean(id))
      queue.push(...targets)
    }
    for (const step of steps) {
      if (!reachable.has(step.id)) {
        report.errors.push({
          code: 'generic-step-unreachable',
          message: `Stap '${step.activiteit}' is niet bereikbaar vanaf Start.`,
          elementId: step.id,
        })
      }
    }
    if (!ends.some((step) => reachable.has(step.id))) {
      report.errors.push({
        code: 'generic-end-unreachable',
        message: 'Vanaf Start is geen expliciete eindstap bereikbaar.',
      })
    }
  }

  const name = readableLabel(diagram.getAttribute('name'))
  if (!name) {
    report.errors.push({
      code: 'generic-process-name-missing',
      message: 'De draw.io-pagina heeft geen expliciete naam voor het proces.',
    })
  }
  const uniqueLanes = uniqueById(lanes, 'Lane', report.errors)
  const uniqueSteps = uniqueById(steps, 'Stap', report.errors)
  if (name && uniqueLanes.length > 0 && uniqueSteps.length > 0) {
    report.process = {
      id: safeFilePart(name),
      hoofdproces: name,
      detailproces: name,
      versie: 'V0.1',
      status: 'concept',
      laatsteWijziging: new Date().toISOString().slice(0, 10),
      bron: { type: 'handmatig', bestand: `${safeFilePart(name)}.drawio` },
      lanes: uniqueLanes,
      secties: [{ id: 'hoofd', naam: 'Hoofdflow' }],
      stappen: uniqueSteps,
    }
  }

  const mappedItems = report.geometry.length
  const totalItems = mappedItems + report.unmapped.length
  report.confidence = {
    overall: totalItems === 0 ? 0 : mappedItems / totalItems,
    mappedItems,
    totalItems,
    metadataBacked: false,
    semanticSource: 'generic-structure',
  }
  report.ok = report.errors.length === 0 && report.process !== null
  if (!report.ok && report.unmapped.length === 0) {
    for (const error of report.errors) {
      if (error.elementId) {
        report.unmapped.push({
          externalId: error.elementId,
          kind: 'generic-element',
          reason: error.message,
        })
      }
    }
  }
  return report
}

function objectCells(graphRoot: Element): ObjectCell[] {
  const result: ObjectCell[] = []
  for (const object of Array.from(graphRoot.getElementsByTagName('object'))) {
    const kind = object.getAttribute('spgKind')
    const semanticId = object.getAttribute('spgId')
    const cell = directChild(object, 'mxCell')
    if (
      cell &&
      semanticId &&
      (kind === 'lane' || kind === 'section' || kind === 'step')
    ) {
      result.push({ object, cell, kind, semanticId })
    }
  }
  return result
}

function uniqueById<T extends { id: string }>(
  values: T[],
  kind: string,
  errors: DiagramWarning[],
): T[] {
  const seen = new Set<string>()
  return values.filter((value) => {
    if (!value.id || seen.has(value.id)) {
      errors.push({
        code: 'duplicate-or-empty-id',
        message: `${kind} bevat een leeg of dubbel id '${value.id}'.`,
        elementId: value.id,
      })
      return false
    }
    seen.add(value.id)
    return true
  })
}

function applyEdges(
  graphRoot: Element,
  steps: Step[],
  geometry: ImportedGeometry[],
  warnings: DiagramWarning[],
  unmapped: UnmappedDiagramItem[],
): void {
  const byId = new Map(steps.map((step) => [step.id, step]))
  const externalToSemantic = new Map<string, string>()
  for (const object of Array.from(graphRoot.getElementsByTagName('object'))) {
    const cell = directChild(object, 'mxCell')
    const semanticId = object.getAttribute('spgId')
    const externalId = cell?.getAttribute('id')
    if (semanticId && externalId) externalToSemantic.set(externalId, semanticId)
  }

  for (const object of Array.from(graphRoot.getElementsByTagName('object'))) {
    const kind = object.getAttribute('spgKind')
    if (kind !== 'transition' && kind !== 'route' && kind !== 'message') continue
    const cell = directChild(object, 'mxCell')
    const externalId = cell?.getAttribute('id') ?? 'unknown-edge'
    const sourceStepId =
      object.getAttribute('spgSourceStepId') ??
      externalToSemantic.get(cell?.getAttribute('source') ?? '')
    const targetId = externalToSemantic.get(cell?.getAttribute('target') ?? '')
    const source = sourceStepId ? byId.get(sourceStepId) : undefined
    if (!cell || !source || !targetId) {
      unmapped.push({ externalId, kind, reason: 'Bron- of doelmetadata ontbreekt.' })
      continue
    }

    geometry.push({
      externalId,
      semanticKind: 'edge',
      semanticId:
        kind === 'route' ? object.getAttribute('spgRouteId') ?? externalId : source.id,
      sourceId: source.id,
      targetId,
    })
    if (kind === 'transition') source.naarStap = targetId
    if (kind === 'message') source.doelLaneId = targetId
    if (kind === 'route') {
      const routeId = object.getAttribute('spgRouteId')
      const routes = [...(source.routes ?? [])]
      const existing = routes.find((route) => route.id === routeId)
      if (existing) {
        existing.naarStap = targetId
        existing.label = object.getAttribute('label') ?? existing.label
      } else if (routeId) {
        routes.push({ id: routeId, label: object.getAttribute('label') ?? '', naarStap: targetId })
      } else {
        warnings.push({
          code: 'route-id-missing',
          message: `Route-edge '${externalId}' heeft geen stabiel spgRouteId.`,
          elementId: externalId,
        })
      }
      source.routes = routes
    }
  }
}

export function importDrawIo(source: string | ArrayBuffer): ImportReport {
  if (typeof source !== 'string') {
    return unavailableImport(FORMAT, 'text-required', 'draw.io XML moet als tekst worden aangeleverd.')
  }
  if (typeof DOMParser === 'undefined') {
    return unavailableImport(FORMAT, 'browser-xml-required', 'draw.io-import vereist browser-XML-ondersteuning.')
  }
  if (source.length > MAX_SOURCE_CHARS) {
    return unavailableImport(FORMAT, 'file-too-large', 'Het draw.io-bestand overschrijdt de veilige limiet.')
  }
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) {
    return unavailableImport(FORMAT, 'unsafe-xml', 'DOCTYPE- en ENTITY-declaraties zijn niet toegestaan.')
  }

  const report = emptyReport()
  const document = new DOMParser().parseFromString(source, 'application/xml')
  if (document.getElementsByTagName('parsererror').length > 0) {
    report.errors.push({ code: 'invalid-xml', message: 'Het draw.io-bestand bevat ongeldige XML.' })
    return report
  }
  const mxfile = document.documentElement
  if (mxfile.localName !== 'mxfile') {
    report.errors.push({ code: 'invalid-root', message: 'Verwacht een draw.io mxfile-document.' })
    return report
  }
  const diagram = directChild(mxfile, 'diagram')
  if (!diagram) {
    report.errors.push({ code: 'diagram-missing', message: 'Het draw.io-bestand bevat geen pagina.' })
    return report
  }
  const graph = directChild(diagram, 'mxGraphModel')
  if (!graph) {
    const encoded = diagram.textContent?.trim()
    report.errors.push({
      code: encoded ? 'compressed-not-supported' : 'graph-missing',
      message: encoded
        ? 'Dit draw.io-bestand gebruikt gecomprimeerde diagramdata. Alleen een on-gecomprimeerd mxGraphModel wordt momenteel ondersteund.'
        : 'De draw.io-pagina bevat geen mxGraphModel.',
    })
    return report
  }
  const graphRoot = directChild(graph, 'root')
  if (!graphRoot) {
    report.errors.push({ code: 'graph-root-missing', message: 'Het mxGraphModel bevat geen root.' })
    return report
  }
  const totalElements = graphRoot.getElementsByTagName('*').length
  if (totalElements > MAX_ELEMENTS) {
    report.errors.push({ code: 'too-many-elements', message: 'Het diagram bevat te veel elementen.' })
    return report
  }

  const header = parseJsonAttribute<ProcessHeader>(diagram, 'spgProcess')
  if (!header || diagram.getAttribute('spgSchema') !== SCHEMA_VERSION) {
    return importGenericDrawIo(diagram, graphRoot, report)
  }

  const cells = objectCells(graphRoot)
  const geometries: ImportedGeometry[] = []
  const lanes: Lane[] = []
  const sections: Section[] = []
  const steps: Step[] = []
  const mappedExternalIds = new Set<string>()

  for (const item of cells) {
    const externalId = item.cell.getAttribute('id') ?? item.semanticId
    mappedExternalIds.add(externalId)
    const data = parseJsonAttribute<Lane | Section | Step>(item.object, 'spgData')
    if (!data) {
      report.unmapped.push({
        externalId,
        kind: item.kind,
        reason: 'Ongeldige of ontbrekende spgData-metadata.',
      })
      continue
    }
    geometries.push({
      externalId,
      semanticKind: item.kind,
      semanticId: item.semanticId,
      ...geometryOf(item.cell),
    })
    if (item.kind === 'lane') {
      const lane = { ...(data as Lane), id: item.semanticId }
      const editedLabel = item.object.getAttribute('label')
      if (editedLabel !== null) lane.naam = editedLabel
      lanes.push(lane)
    }
    if (item.kind === 'section') {
      const section = { ...(data as Section), id: item.semanticId }
      const editedLabel = item.object.getAttribute('label')
      if (editedLabel !== null) section.naam = editedLabel
      sections.push(section)
    }
    if (item.kind === 'step') {
      const step = { ...(data as Step), id: item.semanticId }
      const editedLabel = item.object.getAttribute('label')
      if (editedLabel !== null && editedLabel !== step.activiteit) {
        step.activiteit = editedLabel
        report.warnings.push({
          code: 'label-updated',
          message: `De gewijzigde draw.io-label van stap '${step.id}' is als activiteit overgenomen.`,
          elementId: step.id,
        })
      }
      steps.push(step)
    }
  }

  const uniqueLanes = uniqueById(lanes, 'Lane', report.errors)
  const uniqueSections = uniqueById(sections, 'Sectie', report.errors)
  const uniqueSteps = uniqueById(steps, 'Stap', report.errors)
  // Interne diagramverbindingen zijn leidend bij herimport. Externe
  // procesverwijzingen blijven uit de metadata behouden.
  for (const step of uniqueSteps) {
    step.naarStap = undefined
    if (step.type === 'bericht') step.doelLaneId = undefined
    if (step.routes) {
      step.routes = step.routes.map((route) => ({ ...route, naarStap: undefined }))
    }
  }
  applyEdges(graphRoot, uniqueSteps, geometries, report.warnings, report.unmapped)

  for (const cell of Array.from(graphRoot.getElementsByTagName('mxCell'))) {
    const externalId = cell.getAttribute('id')
    if (
      externalId &&
      externalId !== '0' &&
      externalId !== '1' &&
      !mappedExternalIds.has(externalId) &&
      cell.parentElement?.localName !== 'object'
    ) {
      report.unmapped.push({
        externalId,
        kind: cell.getAttribute('edge') === '1' ? 'edge' : 'cell',
        reason: 'Element heeft geen ondersteunde spg-metadata.',
      })
    }
  }

  const laneIds = new Set(uniqueLanes.map((lane) => lane.id))
  const stepIds = new Set(uniqueSteps.map((step) => step.id))
  for (const step of uniqueSteps) {
    if (!laneIds.has(step.laneId)) {
      report.warnings.push({
        code: 'unknown-lane',
        message: `Stap '${step.id}' verwijst naar onbekende lane '${step.laneId}'.`,
        elementId: step.id,
      })
    }
    if (step.naarStap && !stepIds.has(step.naarStap)) {
      report.warnings.push({
        code: 'unknown-target',
        message: `Stap '${step.id}' verwijst naar onbekende stap '${step.naarStap}'.`,
        elementId: step.id,
      })
    }
  }

  report.process = {
    ...header,
    lanes: uniqueLanes,
    secties: uniqueSections,
    stappen: uniqueSteps,
  }
  report.geometry = geometries
  const mappedItems = geometries.length
  const totalItems = mappedItems + report.unmapped.length
  report.confidence = {
    overall: totalItems === 0 ? 0 : mappedItems / totalItems,
    mappedItems,
    totalItems,
    metadataBacked: true,
    semanticSource: 'spg-metadata',
  }
  report.ok = report.errors.length === 0 && uniqueLanes.length > 0 && uniqueSteps.length > 0
  if (!report.ok && report.errors.length === 0) {
    report.errors.push({
      code: 'process-incomplete',
      message: 'Een proces vereist minimaal één lane en één stap.',
    })
  }
  return report
}

/**
 * draw.io bewaart diagraminhoud standaard als base64 + raw-deflate van een
 * URI-gecodeerd mxGraphModel. Deze stap normaliseert dat browser-native naar
 * dezelfde ongecomprimeerde XML die de strikte synchrone importer verwerkt.
 */
export async function normaliseerDrawIoXml(source: string): Promise<string> {
  if (source.length > MAX_SOURCE_CHARS) {
    throw new Error('Het draw.io-bestand overschrijdt de veilige limiet.')
  }
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) {
    throw new Error('DOCTYPE- en ENTITY-declaraties zijn niet toegestaan.')
  }
  if (typeof DOMParser === 'undefined' || typeof XMLSerializer === 'undefined') {
    throw new Error('draw.io-decompressie vereist browser-XML-ondersteuning.')
  }

  const document = new DOMParser().parseFromString(source, 'application/xml')
  if (document.getElementsByTagName('parsererror').length > 0) {
    throw new Error('Het draw.io-bestand bevat ongeldige XML.')
  }
  const mxfile = document.documentElement
  const diagram = mxfile.localName === 'mxfile' ? directChild(mxfile, 'diagram') : null
  if (!diagram || directChild(diagram, 'mxGraphModel')) return source

  const encoded = diagram.textContent?.trim()
  if (!encoded) return source
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Deze browser ondersteunt geen veilige draw.io-decompressie.')
  }

  let compressed: Uint8Array<ArrayBuffer>
  try {
    const binary = atob(encoded)
    compressed = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  } catch {
    throw new Error('De gecomprimeerde draw.io-pagina bevat geen geldige base64-data.')
  }
  if (compressed.length === 0 || compressed.length > MAX_SOURCE_CHARS) {
    throw new Error('De gecomprimeerde draw.io-pagina valt buiten de veilige limiet.')
  }

  let expanded: ArrayBuffer
  try {
    const stream = new Blob([compressed])
      .stream()
      .pipeThrough(new DecompressionStream('deflate-raw'))
    expanded = await new Response(stream).arrayBuffer()
  } catch {
    throw new Error('De draw.io-pagina kon niet veilig als raw-deflate worden uitgepakt.')
  }
  if (
    expanded.byteLength > MAX_EXPANDED_CHARS ||
    expanded.byteLength / compressed.length > MAX_COMPRESSION_RATIO
  ) {
    throw new Error('De uitgepakte draw.io-pagina overschrijdt de veilige expansielimiet.')
  }

  let graphXml: string
  try {
    graphXml = decodeURIComponent(new TextDecoder().decode(expanded))
  } catch {
    throw new Error('De uitgepakte draw.io-pagina bevat ongeldige URI-gecodeerde XML.')
  }
  if (graphXml.length > MAX_EXPANDED_CHARS || /<!DOCTYPE|<!ENTITY/i.test(graphXml)) {
    throw new Error('De uitgepakte draw.io-XML valt buiten de veilige limiet.')
  }
  const graphDocument = new DOMParser().parseFromString(graphXml, 'application/xml')
  if (
    graphDocument.getElementsByTagName('parsererror').length > 0 ||
    graphDocument.documentElement.localName !== 'mxGraphModel'
  ) {
    throw new Error('De uitgepakte draw.io-pagina bevat geen geldig mxGraphModel.')
  }

  diagram.replaceChildren(document.importNode(graphDocument.documentElement, true))
  mxfile.setAttribute('compressed', 'false')
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(mxfile)}`
}

export const drawIoAdapter: DiagramFormatAdapter = {
  capability: {
    format: FORMAT,
    label: 'draw.io native XML',
    extensions: ['.drawio', '.xml'],
    localImport: true,
    localExport: true,
    roundTrip: 'semantic-subset',
    requiresBackend: false,
    requiresExternalService: false,
    explanation:
      'Lokale import/export van draw.io XML; standaardcompressie wordt begrensd browser-native uitgepakt. SPG-metadata behoudt volledige fidelity en generieke flowcharts worden alleen bij expliciete semantiek geïmporteerd.',
  },
  importProcess: importDrawIo,
  exportProcess: exportDrawIo,
}
