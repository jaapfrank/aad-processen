import type { Process } from '../../contract'

export type DiagramFormatId = 'drawio-xml' | 'visio-vsdx' | 'lucid-standard'

export interface DiagramCapability {
  format: DiagramFormatId
  label: string
  extensions: readonly string[]
  localImport: boolean
  localExport: boolean
  roundTrip: 'semantic-subset' | 'backend-required' | 'connector-required'
  requiresBackend: boolean
  requiresExternalService: boolean
  explanation: string
}

export interface DiagramWarning {
  code: string
  message: string
  elementId?: string
}

export interface UnmappedDiagramItem {
  externalId: string
  kind: string
  reason: string
}

export interface ImportedGeometry {
  externalId: string
  semanticKind: 'lane' | 'section' | 'step' | 'edge'
  semanticId: string
  x?: number
  y?: number
  width?: number
  height?: number
  sourceId?: string
  targetId?: string
}

export interface ImportConfidence {
  overall: number
  mappedItems: number
  totalItems: number
  metadataBacked: boolean
  /** Herkomst van de semantiek; generieke structuur wordt strenger en met lagere fidelity behandeld. */
  semanticSource?: 'spg-metadata' | 'generic-structure'
}

export interface ImportReport {
  ok: boolean
  format: DiagramFormatId
  process: Process | null
  geometry: ImportedGeometry[]
  warnings: DiagramWarning[]
  unmapped: UnmappedDiagramItem[]
  confidence: ImportConfidence
  errors: DiagramWarning[]
}

export interface DiagramExport {
  ok: boolean
  format: DiagramFormatId
  fileName?: string
  mediaType?: string
  content?: string | Uint8Array<ArrayBuffer>
  warnings: DiagramWarning[]
  errors: DiagramWarning[]
}

export interface DiagramFormatAdapter {
  readonly capability: DiagramCapability
  importProcess(source: string | ArrayBuffer): ImportReport
  exportProcess(process: Process): DiagramExport
}

export function unavailableImport(
  format: DiagramFormatId,
  code: string,
  message: string,
): ImportReport {
  return {
    ok: false,
    format,
    process: null,
    geometry: [],
    warnings: [],
    unmapped: [],
    confidence: { overall: 0, mappedItems: 0, totalItems: 0, metadataBacked: false },
    errors: [{ code, message }],
  }
}

export function unavailableExport(
  format: DiagramFormatId,
  code: string,
  message: string,
): DiagramExport {
  return { ok: false, format, warnings: [], errors: [{ code, message }] }
}
