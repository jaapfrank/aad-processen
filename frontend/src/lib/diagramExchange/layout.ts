import type { ProcessDiagramLayout, ProcessNodePlacement } from '../../contract'

const INCH_NAAR_PX96 = 96

/** Gemeenschappelijke geometriesubset van lokale en servermatige diagramimports. */
export interface DiagramImportGeometry {
  semanticKind: string
  semanticId: string
  x?: number
  y?: number
  width?: number
  height?: number
  unit?: 'px' | 'in'
}

function finite(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function schaal(value: number | undefined, factor: number): number | undefined {
  return finite(value) ? value * factor : undefined
}

/**
 * Zet alleen expliciet gemapte stapgeometrie om naar de persistente proceslayout.
 * Lanes, secties en edges blijven buiten deze minimale contractslice.
 */
export function diagramLayoutUitGeometrie(
  geometry: readonly DiagramImportGeometry[],
): ProcessDiagramLayout | undefined {
  const nodes: Record<string, ProcessNodePlacement> = {}

  for (const item of geometry) {
    if (item.semanticKind !== 'step' || !item.semanticId) continue
    const factor = item.unit === 'in' ? INCH_NAAR_PX96 : 1
    const x = schaal(item.x, factor)
    const y = schaal(item.y, factor)
    if (x === undefined || y === undefined) continue

    const width = schaal(item.width, factor)
    const height = schaal(item.height, factor)
    nodes[`step:${item.semanticId}`] = {
      x,
      y,
      ...(width !== undefined && width >= 0 ? { width } : {}),
      ...(height !== undefined && height >= 0 ? { height } : {}),
    }
  }

  if (Object.keys(nodes).length === 0) return undefined
  return {
    version: 1,
    coordinateSystem: 'px96-y-down',
    nodes,
  }
}
