import type { Process, StepType } from '../contract'

export const typeLabel: Record<StepType, string> = {
  actie: 'Actie',
  bericht: 'Bericht',
  beslissing: 'Beslissing',
  subproces: 'Subproces',
  start: 'Start',
  eind: 'Einde',
  marker: 'Markering',
}

export function laneNaam(proces: Process, laneId: string) {
  return proces.lanes.find((l) => l.id === laneId)?.naam ?? laneId
}

export function laneKleur(proces: Process, laneId: string) {
  return proces.lanes.find((l) => l.id === laneId)?.kleur ?? '#9ca3af'
}
