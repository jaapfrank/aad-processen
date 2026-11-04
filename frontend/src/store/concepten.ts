import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  Process,
  ProcessDiagramLayout,
  ProcessDiagramPoint,
  ProcessEdgePlacement,
  ProcessNodePlacement,
} from '../contract'

// Lokale conceptprocessen (procesbouwer). In mock-modus is dit de opslag;
// zodra de backend gekoppeld is, worden concepten via POST/PUT /api/processes
// gesynchroniseerd en blijft dit de offline-buffer.

interface ConceptenState {
  concepten: Record<string, Process>
  opslaan: (p: Process) => void
  verwijderen: (id: string) => void
}

interface PersistedConceptenState {
  concepten: Record<string, Process>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isPoint(value: unknown): value is ProcessDiagramPoint {
  return isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y)
}

function isNodePlacement(value: unknown): value is ProcessNodePlacement {
  if (!isRecord(value) || !isFiniteNumber(value.x) || !isFiniteNumber(value.y)) return false
  return (
    (value.width === undefined || (isFiniteNumber(value.width) && value.width > 0)) &&
    (value.height === undefined || (isFiniteNumber(value.height) && value.height > 0))
  )
}

function isEdgePlacement(value: unknown): value is ProcessEdgePlacement {
  if (!isRecord(value)) return false
  return (
    (value.waypoints === undefined ||
      (Array.isArray(value.waypoints) && value.waypoints.every(isPoint))) &&
    (value.sourcePort === undefined || typeof value.sourcePort === 'string') &&
    (value.targetPort === undefined || typeof value.targetPort === 'string') &&
    (value.labelPosition === undefined || isPoint(value.labelPosition))
  )
}

function isDiagramLayout(value: unknown): value is ProcessDiagramLayout {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    value.coordinateSystem !== 'px96-y-down' ||
    !isRecord(value.nodes)
  ) {
    return false
  }
  if (!Object.values(value.nodes).every(isNodePlacement)) return false
  return value.edges === undefined || (isRecord(value.edges) && Object.values(value.edges).every(isEdgePlacement))
}

function migrateConcepten(persistedState: unknown): PersistedConceptenState {
  if (!isRecord(persistedState) || !isRecord(persistedState.concepten)) {
    return { concepten: {} }
  }

  const concepten = Object.fromEntries(
    Object.entries(persistedState.concepten).map(([id, value]) => {
      if (!isRecord(value)) return [id, value as unknown as Process]
      const process = { ...value }
      if (process.diagramLayout !== undefined && !isDiagramLayout(process.diagramLayout)) {
        delete process.diagramLayout
      }
      return [id, process as unknown as Process]
    }),
  )
  return { concepten }
}

export const useConcepten = create<ConceptenState>()(
  persist(
    (set) => ({
      concepten: {},
      opslaan: (p) =>
        set((s) => ({ concepten: { ...s.concepten, [p.id]: p } })),
      verwijderen: (id) =>
        set((s) => {
          const rest = { ...s.concepten }
          delete rest[id]
          return { concepten: rest }
        }),
    }),
    {
      name: 'spg-concepten',
      version: 1,
      migrate: (persistedState) => migrateConcepten(persistedState),
    },
  ),
)
