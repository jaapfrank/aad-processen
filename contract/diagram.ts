import type { Process } from './model'

/** Bewerkbare diagramformaten waarmee de procesgids kan uitwisselen. */
export type DiagramFormat = 'drawio' | 'visio-vsdx' | 'lucid-standard'

/** Canoniek coördinatenstelsel: CSS-pixels bij 96 DPI, oorsprong linksboven. */
export interface DiagramBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface DiagramSemanticRef {
  kind: 'process' | 'lane' | 'section' | 'step' | 'route' | 'annotation'
  id: string
}

export interface DiagramNode {
  id: string
  semanticRef?: DiagramSemanticRef
  kind: string
  bounds: DiagramBounds
  rotation?: number
  parentId?: string
  zIndex?: number
  text?: string
  style?: Record<string, string | number | boolean>
  /** Begrensde, niet-uitvoerbare metadata per leverancier. */
  extensions?: Record<string, string>
}

export interface DiagramEndpoint {
  nodeId: string
  port?: string
}

export interface DiagramPoint {
  x: number
  y: number
}

export interface DiagramEdge {
  id: string
  semanticRef?: DiagramSemanticRef
  source: DiagramEndpoint
  target: DiagramEndpoint
  label?: string
  waypoints?: DiagramPoint[]
  directed?: boolean
  style?: Record<string, string | number | boolean>
  extensions?: Record<string, string>
}

export interface DiagramPage {
  id: string
  title: string
  width: number
  height: number
  nodes: DiagramNode[]
  edges: DiagramEdge[]
  layers?: Array<{ id: string; name: string; visible: boolean }>
}

export interface DiagramDocument {
  schemaVersion: '1.0'
  coordinateSystem: 'px96-y-down'
  processId: string
  pages: DiagramPage[]
  source?: {
    format: DiagramFormat
    sourceHash?: string
    importerVersion?: string
  }
}

export type DiagramIssueSeverity = 'info' | 'warning' | 'error'

export interface DiagramImportIssue {
  code: string
  severity: DiagramIssueSeverity
  message: string
  itemId?: string
}

export interface DiagramImportReport {
  format: DiagramFormat
  process?: Process
  diagram?: DiagramDocument
  confidence: number
  warnings: DiagramImportIssue[]
  unmappedItems: Array<{ id: string; kind: string; label?: string }>
  /** Commit mag alleen na review en zonder blokkerende fouten. */
  requiresReview: boolean
}

export interface DiagramFormatCapability {
  format: DiagramFormat
  label: string
  import: 'native' | 'connector' | 'planned'
  export: 'native' | 'connector' | 'planned'
  roundTrip: 'semantic' | 'own-exports-only' | 'none'
  note: string
}

/** Resultaat van een begrensde servercodec voor ZIP/OPC-diagramformaten. */
export interface DiagramPackageIssue {
  code: string
  message: string
  elementId?: string
}

export interface DiagramElementGeometry {
  externalId: string
  semanticKind: string
  semanticId: string
  x?: number
  y?: number
  width?: number
  height?: number
  unit: 'px' | 'in'
}

export interface VisioImportPage {
  id: string
  name: string
  number: number
  background: boolean
}

export interface DiagramPackageImportResult {
  pages?: VisioImportPage[]
  ok: boolean
  format: 'lucid-standard' | 'visio-vsdx'
  process?: Process
  geometry: DiagramElementGeometry[]
  warnings: DiagramPackageIssue[]
  unmapped: DiagramPackageIssue[]
  errors: DiagramPackageIssue[]
  confidence: number
}

export interface DiagramExportBlocker {
  format: 'visio-vsdx'
  code: string
  message: string
  requiresValidatedTemplate: boolean
}
