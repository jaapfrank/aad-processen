export { drawIoAdapter, exportDrawIo, importDrawIo, normaliseerDrawIoXml } from './drawio'
export { exportVisioVsdx } from './visio'
export { lucidStandardAdapter, visioVsdxAdapter } from './adapters'
export { diagramLayoutUitGeometrie } from './layout'
export { runDrawIoSelfTest } from './selfTest'
export type { DiagramImportGeometry } from './layout'
export type {
  DiagramCapability,
  DiagramExport,
  DiagramFormatAdapter,
  DiagramFormatId,
  DiagramWarning,
  ImportConfidence,
  ImportedGeometry,
  ImportReport,
  UnmappedDiagramItem,
} from './types'

import { lucidStandardAdapter, visioVsdxAdapter } from './adapters'
import { drawIoAdapter } from './drawio'

export const diagramFormatAdapters = [
  drawIoAdapter,
  visioVsdxAdapter,
  lucidStandardAdapter,
] as const
