import type { Process, ProcessNodePlacement, Step } from '../../contract'
import type { DiagramExport, DiagramWarning } from './types'

const PX_PER_INCH = 96
const LANE_WIDTH = 240
const STEP_WIDTH = 200
const STEP_HEIGHT = 72
const ROW_HEIGHT = 136
const START_Y = 70
const SECTION_HEIGHT = 44
const VISIO_NS = 'http://schemas.microsoft.com/office/visio/2012/main'
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
const OFFICE_REL_NS =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

interface ExportLayout {
  pageWidth: number
  pageHeight: number
  lanes: Map<string, Bounds>
  sections: Map<string, Bounds>
  steps: Map<string, Bounds>
}

interface ZipEntry {
  name: string
  bytes: Uint8Array<ArrayBuffer>
}

const encoder = new TextEncoder()

function xml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function text(value: string, max = 4_000): string {
  return [...value]
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0
      return char === '\t' || char === '\n' || char === '\r' || (code >= 32 && code !== 0xfffe && code !== 0xffff)
    })
    .slice(0, max)
    .join('')
}

function safeName(value: string): string {
  const result = value.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/^-+|-+$/g, '')
  return (result || 'item').slice(0, 96)
}

function safeFilePart(value: string): string {
  return safeName(value).toLowerCase()
}

function number(value: number): string {
  return value.toFixed(10).replace(/\.?0+$/, '') || '0'
}

function visioString(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

function cell(name: string, value: number | string, formula?: string, unit?: string): string {
  return `<Cell N="${xml(name)}" V="${xml(typeof value === 'number' ? number(value) : value)}"${formula ? ` F="${xml(formula)}"` : ''}${unit ? ` U="${xml(unit)}"` : ''}/>`
}

function property(name: string, value: string): string {
  return `<Row N="Prop.${safeName(name)}">${cell('Value', visioString(value), undefined, 'STR')}</Row>`
}

function metadata(kind: string, id: string, data = '{}'): string {
  return `<Section N="Property">${property('spgSchema', '1')}${property('spgKind', kind)}${property('spgId', id)}${property('spgData', data)}</Section>`
}

function colorFormula(color: string): string {
  const match = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color)
  if (!match) return 'RGB(156,163,175)'
  return `RGB(${Number.parseInt(match[1], 16)},${Number.parseInt(match[2], 16)},${Number.parseInt(match[3], 16)})`
}

function lightFill(color: string, lane: boolean): string {
  const match = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color)
  if (!match) return '#f3f4f6'
  const ratio = lane ? 0.88 : 0.82
  return `#${match.slice(1).map((part) => {
    const channel = Number.parseInt(part, 16)
    return Math.round(channel + (255 - channel) * ratio).toString(16).padStart(2, '0')
  }).join('')}`
}

function placement(process: Process, key: string): ProcessNodePlacement | undefined {
  const layout = process.diagramLayout
  if (layout?.version !== 1 || layout.coordinateSystem !== 'px96-y-down') return undefined
  return layout.nodes[key]
}

function validCoordinate(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1_000_000
}

function validSize(value: number | undefined): boolean {
  return value === undefined || (Number.isFinite(value) && value > 0 && value <= 1_000_000)
}

function autoY(process: Process): Map<string, number> {
  const result = new Map<string, number>()
  let y = START_Y
  for (const section of process.secties) {
    y += SECTION_HEIGHT
    for (const step of process.stappen.filter((candidate) => candidate.sectieId === section.id)) {
      result.set(step.id, y)
      y += ROW_HEIGHT
    }
    y += 12
  }
  for (const step of process.stappen.filter(
    (candidate) =>
      !candidate.sectieId ||
      !process.secties.some((section) => section.id === candidate.sectieId),
  )) {
    result.set(step.id, y)
    y += ROW_HEIGHT
  }
  return result
}

function buildLayout(process: Process, warnings: DiagramWarning[]): ExportLayout {
  const fallbackY = autoY(process)
  const steps = new Map<string, Bounds>()
  for (const step of process.stappen) {
    let laneIndex = process.lanes.findIndex((lane) => lane.id === step.laneId)
    if (laneIndex < 0) {
      laneIndex = 0
      warnings.push({
        code: 'unknown-lane',
        message: `Stap '${step.id}' is in de eerste Visio-lane geplaatst.`,
        elementId: step.id,
      })
    }
    const manual = placement(process, `step:${step.id}`)
    if (
      manual &&
      validCoordinate(manual.x) &&
      validCoordinate(manual.y) &&
      validSize(manual.width) &&
      validSize(manual.height)
    ) {
      steps.set(step.id, {
        x: manual.x,
        y: manual.y,
        width: manual.width ?? STEP_WIDTH,
        height: manual.height ?? STEP_HEIGHT,
      })
    } else {
      if (manual) {
        warnings.push({
          code: 'invalid-manual-geometry',
          message: `Ongeldige geometrie van stap '${step.id}' is vervangen door auto-layout.`,
          elementId: step.id,
        })
      }
      steps.set(step.id, {
        x: laneIndex * LANE_WIDTH + (LANE_WIDTH - STEP_WIDTH) / 2,
        y: fallbackY.get(step.id) ?? START_Y,
        width: STEP_WIDTH,
        height: STEP_HEIGHT,
      })
    }
  }

  const laneSpan = Math.max(LANE_WIDTH, process.lanes.length * LANE_WIDTH)
  const sections = new Map<string, Bounds>()
  for (const section of process.secties) {
    const sectionSteps = process.stappen
      .filter((step) => step.sectieId === section.id)
      .map((step) => steps.get(step.id)?.y ?? START_Y + SECTION_HEIGHT)
    sections.set(section.id, {
      x: 0,
      y: Math.max(0, Math.min(...(sectionSteps.length ? sectionSteps : [START_Y + SECTION_HEIGHT])) - SECTION_HEIGHT),
      width: laneSpan,
      height: 32,
    })
  }
  const right = Math.max(laneSpan, ...[...steps.values()].map((bounds) => bounds.x + bounds.width))
  const bottom = Math.max(
    520,
    ...[...steps.values(), ...sections.values()].map((bounds) => bounds.y + bounds.height + 40),
  )
  const pageWidth = Math.max(800, right + 40)
  const pageHeight = Math.max(600, bottom + 40)
  const lanes = new Map<string, Bounds>()
  process.lanes.forEach((lane, index) =>
    lanes.set(lane.id, { x: index * LANE_WIDTH, y: 0, width: LANE_WIDTH, height: pageHeight - 40 }),
  )
  return { pageWidth, pageHeight, lanes, sections, steps }
}

function geometry(width: number, height: number, kind: string): string {
  const points =
    kind === 'beslissing'
      ? [
          [width / 2, 0],
          [width, height / 2],
          [width / 2, height],
          [0, height / 2],
          [width / 2, 0],
        ]
      : [
          [0, 0],
          [width, 0],
          [width, height],
          [0, height],
          [0, 0],
        ]
  return `<Section N="Geometry" IX="0">${points
    .map(
      ([x, y], index) =>
        `<Row T="${index === 0 ? 'MoveTo' : 'LineTo'}" IX="${index + 1}">${cell('X', x)}${cell('Y', y)}</Row>`,
    )
    .join('')}</Section>`
}

function shape(
  id: number,
  name: string,
  label: string,
  bounds: Bounds,
  pageHeight: number,
  color: string,
  visualKind: string,
  semanticKind: string,
  semanticId: string,
  data = '{}',
  hidden = false,
): string {
  const width = bounds.width / PX_PER_INCH
  const height = bounds.height / PX_PER_INCH
  const pinX = (bounds.x + bounds.width / 2) / PX_PER_INCH
  const pinY = (pageHeight - bounds.y - bounds.height / 2) / PX_PER_INCH
  const rounded = ['start', 'eind', 'marker'].includes(visualKind)
    ? Math.min(width, height) / 2
    : ['actie', 'bericht', 'subproces'].includes(visualKind)
      ? 0.08
      : 0
  const textHeight = visualKind === 'lane' ? Math.min(0.42, height) : Math.max(0.1, height - 0.12)
  const textPinY = visualKind === 'lane' ? Math.max(textHeight / 2, height - textHeight / 2) : height / 2
  return `<Shape ID="${id}" NameU="${xml(text(name, 255))}" Type="Shape">
${cell('PinX', pinX)}${cell('PinY', pinY)}${cell('Width', width)}${cell('Height', height)}
${cell('LocPinX', width / 2, 'Width*0.5')}${cell('LocPinY', height / 2, 'Height*0.5')}
${cell('Angle', 0)}${cell('FlipX', 0)}${cell('FlipY', 0)}${cell('ResizeMode', 0)}
${cell('FillForegnd', 1, colorFormula(hidden ? '#ffffff' : visualKind === 'section' ? '#f3f4f6' : lightFill(color, visualKind === 'lane')))}
${cell('FillPattern', hidden ? 0 : 1)}${cell('LineColor', 0, colorFormula(color))}
${cell('LinePattern', hidden ? 0 : 1)}${cell('LineWeight', hidden ? 0 : 1.5 / 72)}${cell('Rounding', rounded)}
${cell('TxtPinX', width / 2)}${cell('TxtPinY', textPinY)}${cell('TxtWidth', Math.max(0.1, width - 0.12))}
${cell('TxtHeight', textHeight)}${cell('TxtLocPinX', Math.max(0.05, width - 0.12) / 2)}${cell('TxtLocPinY', textHeight / 2)}
${metadata(semanticKind, semanticId, data)}
${hidden ? '' : `${geometry(width, height, visualKind)}<Section N="Paragraph"><Row IX="0">${cell('HorzAlign', 1)}</Row></Section><Text>${xml(text(label))}</Text>`}
</Shape>`
}

function shapeName(step: Step): string {
  const prefix: Record<string, string> = {
    beslissing: 'Decision',
    start: 'Start',
    eind: 'End',
    subproces: 'Subprocess',
    bericht: 'Message',
    marker: 'Marker',
    actie: 'Process',
  }
  return `${prefix[step.type] ?? 'Process'} ${safeName(step.id)}`
}

function connectorPoints(source: Bounds, target: Bounds): [[number, number], [number, number]] {
  const sourceX = source.x + source.width / 2
  const sourceY = source.y + source.height / 2
  const targetX = target.x + target.width / 2
  const targetY = target.y + target.height / 2
  const dx = targetX - sourceX
  const dy = targetY - sourceY
  if (Math.abs(dy) >= Math.abs(dx)) {
    return dy >= 0
      ? [[sourceX, source.y + source.height], [targetX, target.y]]
      : [[sourceX, source.y], [targetX, target.y + target.height]]
  }
  return dx >= 0
    ? [[source.x + source.width, sourceY], [target.x, targetY]]
    : [[source.x, sourceY], [target.x + target.width, targetY]]
}

function connector(
  id: number,
  semanticId: string,
  kind: string,
  source: Bounds,
  target: Bounds,
  pageHeight: number,
  label: string,
  color: string,
): string {
  const [[beginXpx, beginYpx], [endXpx, endYpx]] = connectorPoints(source, target)
  const beginX = beginXpx / PX_PER_INCH
  const beginY = (pageHeight - beginYpx) / PX_PER_INCH
  const endX = endXpx / PX_PER_INCH
  const endY = (pageHeight - endYpx) / PX_PER_INCH
  const width = endX - beginX
  const height = endY - beginY
  return `<Shape ID="${id}" NameU="Dynamic connector ${safeName(semanticId)}" Type="Shape" OneD="1">
${cell('BeginX', beginX)}${cell('BeginY', beginY)}${cell('EndX', endX)}${cell('EndY', endY)}
${cell('Width', width)}${cell('Height', height)}${cell('LocPinX', width / 2)}${cell('LocPinY', height / 2)}
${cell('LineColor', 0, colorFormula(color))}${cell('LinePattern', 1)}${cell('LineWeight', 1.4 / 72)}
${cell('BeginArrow', 0)}${cell('EndArrow', 13)}${cell('EndArrowSize', 2)}
${metadata(kind, semanticId)}
<Section N="Geometry" IX="0"><Row T="MoveTo" IX="1">${cell('X', 0)}${cell('Y', 0)}</Row><Row T="LineTo" IX="2">${cell('X', width, 'Width')}${cell('Y', height, 'Height')}</Row></Section>
${label ? `<Text>${xml(text(label, 512))}</Text>` : ''}
</Shape>`
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function uint16(value: number): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(2)
  new DataView(result.buffer).setUint16(0, value, true)
  return result
}

function uint32(value: number): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(4)
  new DataView(result.buffer).setUint32(0, value >>> 0, true)
  return result
}

function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

/** Kleine, deterministische ZIP-writer met Store-methode; voldoende voor OPC en zonder dependency. */
function zip(entries: ZipEntry[]): Uint8Array<ArrayBuffer> {
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let offset = 0
  for (const entry of entries) {
    const name = encoder.encode(entry.name)
    const checksum = crc32(entry.bytes)
    const local = concat([
      uint32(0x04034b50),
      uint16(20),
      uint16(0x0800),
      uint16(0),
      uint16(0),
      uint16(0x0021),
      uint32(checksum),
      uint32(entry.bytes.length),
      uint32(entry.bytes.length),
      uint16(name.length),
      uint16(0),
      name,
      entry.bytes,
    ])
    localParts.push(local)
    centralParts.push(
      concat([
        uint32(0x02014b50),
        uint16(20),
        uint16(20),
        uint16(0x0800),
        uint16(0),
        uint16(0),
        uint16(0x0021),
        uint32(checksum),
        uint32(entry.bytes.length),
        uint32(entry.bytes.length),
        uint16(name.length),
        uint16(0),
        uint16(0),
        uint16(0),
        uint16(0),
        uint32(0),
        uint32(offset),
        name,
      ]),
    )
    offset += local.length
  }
  const central = concat(centralParts)
  const end = concat([
    uint32(0x06054b50),
    uint16(0),
    uint16(0),
    uint16(entries.length),
    uint16(entries.length),
    uint32(central.length),
    uint32(offset),
    uint16(0),
  ])
  return concat([...localParts, central, end])
}

function addEntry(entries: ZipEntry[], name: string, content: string): void {
  entries.push({ name, bytes: encoder.encode(`<?xml version="1.0" encoding="UTF-8"?>${content}`) })
}

/**
 * Browser-native VSDX-export. Ondersteunde subset: één pagina, standalone
 * lanes/secties/procesvormen, beslisdiamanten, start/einde en gelijmde
 * transition/route/message-connectors. Geen macro's, masters, externe links,
 * afbeeldingen, dataconnecties of meerdere pagina's.
 */
export function exportVisioVsdx(process: Process): DiagramExport {
  const warnings: DiagramWarning[] = []
  if (process.lanes.length === 0) {
    return {
      ok: false,
      format: 'visio-vsdx',
      warnings,
      errors: [{ code: 'lanes-required', message: 'Visio-export vereist minimaal één procesrol.' }],
    }
  }
  const processJson = JSON.stringify(process)
  if (processJson.length > 100_000) {
    return {
      ok: false,
      format: 'visio-vsdx',
      warnings,
      errors: [{ code: 'process-metadata-too-large', message: 'Het proces is te groot voor veilige Visio Shape Data.' }],
    }
  }

  const layout = buildLayout(process, warnings)
  const shapes: string[] = []
  const connects: string[] = []
  let nextId = 1
  shapes.push(
    shape(
      nextId++,
      'SPG Process Metadata',
      '',
      { x: 0, y: layout.pageHeight - 2, width: 1, height: 1 },
      layout.pageHeight,
      '#ffffff',
      'metadata',
      'process',
      process.id,
      processJson,
      true,
    ),
  )
  const laneIds = new Map<string, number>()
  for (const lane of process.lanes) {
    const id = nextId++
    laneIds.set(lane.id, id)
    shapes.push(
      shape(id, `Swimlane ${safeName(lane.id)}`, lane.naam, layout.lanes.get(lane.id)!, layout.pageHeight, lane.kleur, 'lane', 'lane', lane.id),
    )
  }
  for (const section of process.secties) {
    shapes.push(
      shape(nextId++, `Section ${safeName(section.id)}`, section.naam, layout.sections.get(section.id)!, layout.pageHeight, '#d1d5db', 'section', 'section', section.id),
    )
  }
  const stepIds = new Map<string, number>()
  for (const step of process.stappen) {
    const id = nextId++
    stepIds.set(step.id, id)
    const color = process.lanes.find((lane) => lane.id === step.laneId)?.kleur ?? '#9ca3af'
    shapes.push(
      shape(id, shapeName(step), step.activiteit, layout.steps.get(step.id)!, layout.pageHeight, color, step.type, 'step', step.id),
    )
  }

  const addConnector = (
    semanticId: string,
    kind: string,
    sourceId: number,
    source: Bounds,
    targetId: number,
    target: Bounds,
    label: string,
    color: string,
  ) => {
    const id = nextId++
    shapes.push(connector(id, semanticId, kind, source, target, layout.pageHeight, label, color))
    connects.push(
      `<Connect FromSheet="${id}" FromCell="BeginX" ToSheet="${sourceId}" ToCell="PinX"/>`,
      `<Connect FromSheet="${id}" FromCell="EndX" ToSheet="${targetId}" ToCell="PinX"/>`,
    )
  }
  for (const step of process.stappen) {
    const sourceId = stepIds.get(step.id)!
    const source = layout.steps.get(step.id)!
    if (step.naarStap) {
      const targetId = stepIds.get(step.naarStap)
      const target = layout.steps.get(step.naarStap)
      if (targetId && target) addConnector(`transition:${step.id}`, 'transition', sourceId, source, targetId, target, '', '#6b7280')
      else warnings.push({ code: 'unknown-target', message: `Onbekend doel '${step.naarStap}' is niet geëxporteerd.`, elementId: step.id })
    }
    for (const route of step.routes ?? []) {
      if (!route.naarStap) continue
      const targetId = stepIds.get(route.naarStap)
      const target = layout.steps.get(route.naarStap)
      if (targetId && target) addConnector(`route:${step.id}:${route.id}`, 'route', sourceId, source, targetId, target, route.label, '#6b7280')
      else warnings.push({ code: 'unknown-route-target', message: `Onbekend routedoel '${route.naarStap}' is niet geëxporteerd.`, elementId: route.id })
    }
    if (step.type === 'bericht' && step.doelLaneId) {
      const targetId = laneIds.get(step.doelLaneId)
      const target = layout.lanes.get(step.doelLaneId)
      if (targetId && target) addConnector(`message:${step.id}`, 'message', sourceId, source, targetId, target, '', '#ea5b0c')
    }
  }

  const pageWidth = layout.pageWidth / PX_PER_INCH
  const pageHeight = layout.pageHeight / PX_PER_INCH
  const entries: ZipEntry[] = []
  addEntry(entries, '[Content_Types].xml', `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/visio/document.xml" ContentType="application/vnd.ms-visio.drawing.main+xml"/><Override PartName="/visio/pages/pages.xml" ContentType="application/vnd.ms-visio.pages+xml"/><Override PartName="/visio/pages/page1.xml" ContentType="application/vnd.ms-visio.page+xml"/></Types>`)
  addEntry(entries, '_rels/.rels', `<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/document" Target="visio/document.xml"/></Relationships>`)
  addEntry(entries, 'visio/document.xml', `<VisioDocument xmlns="${VISIO_NS}" xml:space="preserve"/>`)
  addEntry(entries, 'visio/_rels/document.xml.rels', `<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/pages" Target="pages/pages.xml"/></Relationships>`)
  addEntry(entries, 'visio/pages/pages.xml', `<Pages xmlns="${VISIO_NS}" xmlns:r="${OFFICE_REL_NS}" xml:space="preserve"><Page ID="0" NameU="Process" Name="${xml(text(process.detailproces, 255))}"><PageSheet><Cell N="PageWidth" V="${number(pageWidth)}"/><Cell N="PageHeight" V="${number(pageHeight)}"/><Cell N="PageScale" V="1"/><Cell N="DrawingScale" V="1"/></PageSheet><Rel r:id="rId1"/></Page></Pages>`)
  addEntry(entries, 'visio/pages/_rels/pages.xml.rels', `<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/page" Target="page1.xml"/></Relationships>`)
  addEntry(entries, 'visio/pages/page1.xml', `<PageContents xmlns="${VISIO_NS}" xmlns:r="${OFFICE_REL_NS}" xml:space="preserve"><Shapes>${shapes.join('')}</Shapes>${connects.length ? `<Connects>${connects.join('')}</Connects>` : ''}</PageContents>`)

  const content = zip(entries)
  warnings.push({
    code: 'visio-runtime-review-recommended',
    message: 'Structureel en semantisch gecontroleerd; test voor productie ook eenmaal openen, bewerken en opslaan in de gebruikte Visio-versie.',
  })
  return {
    ok: true,
    format: 'visio-vsdx',
    fileName: `${safeFilePart(process.id)}.vsdx`,
    mediaType: 'application/vnd.ms-visio.drawing',
    content,
    warnings,
    errors: [],
  }
}
