import type { Node, Edge } from '@xyflow/react'
import { MarkerType } from '@xyflow/react'
import type { Process } from '../contract'

// Auto-layout: zet een Process om in een swimlane-plaat (lanes = kolommen,
// secties top-down, stappen in de kolom van hun rol, met sequentie- en
// bericht-pijlen). Pure functie zodat hij makkelijk te testen is.

const COL_W = 240
const ROW_H = 136
const START_Y = 70
const SECTION_H = 44
const NODE_W = 200

export function buildSwimlane(proces: Process): { nodes: Node[]; edges: Edge[] } {
  const laneIndex = new Map(proces.lanes.map((l, i) => [l.id, i]))
  const laneX = (laneId: string) => (laneIndex.get(laneId) ?? 0) * COL_W
  const laneNaam = (laneId: string) => proces.lanes.find((l) => l.id === laneId)?.naam ?? laneId
  const laneKleur = (laneId: string) => proces.lanes.find((l) => l.id === laneId)?.kleur ?? '#9ca3af'

  const stepNodes: Node[] = []
  const edges: Edge[] = []
  const stepY = new Map<string, number>()
  let y = START_Y

  for (const sectie of proces.secties) {
    stepNodes.push({
      id: `sec-${sectie.id}`,
      type: 'sectie',
      position: { x: 0, y: y - 8 },
      data: { naam: sectie.naam },
      style: { width: proces.lanes.length * COL_W },
      draggable: false,
      selectable: false,
    })
    y += SECTION_H

    for (const step of proces.stappen.filter((s) => s.sectieId === sectie.id)) {
      stepY.set(step.id, y)
      stepNodes.push({
        id: step.id,
        type: 'step',
        position: { x: laneX(step.laneId) + (COL_W - NODE_W) / 2, y },
        data: { step, laneNaam: laneNaam(step.laneId), laneKleur: laneKleur(step.laneId) },
        style: { width: NODE_W },
        draggable: false,
      })
      y += ROW_H
    }
    y += 12
  }

  const totalH = y

  const laneNodes: Node[] = proces.lanes.map((l, i) => ({
    id: `lane-${l.id}`,
    type: 'lane',
    position: { x: i * COL_W, y: 0 },
    data: { naam: l.naam, kleur: l.kleur },
    style: { width: COL_W, height: totalH },
    draggable: false,
    selectable: false,
  }))

  const seqStyle = { stroke: '#b9b9c2', strokeWidth: 1.5 }
  const seqMarker = { type: MarkerType.ArrowClosed, width: 16, height: 16, color: '#b9b9c2' }

  for (const step of proces.stappen) {
    // Sequentie-pijl naar de volgende stap.
    if (step.naarStap && stepY.has(step.naarStap)) {
      edges.push({
        id: `seq-${step.id}`,
        source: step.id,
        target: step.naarStap,
        sourceHandle: 'out',
        targetHandle: 'in',
        type: 'smoothstep',
        markerEnd: seqMarker,
        style: seqStyle,
      })
    }

    // Bericht-pijl: horizontaal van bron-lane naar doel-lane.
    if (step.type === 'bericht' && step.doelLaneId) {
      const ay = stepY.get(step.id)
      if (ay !== undefined) {
        const anchorId = `msg-${step.id}`
        stepNodes.push({
          id: anchorId,
          type: 'anchor',
          position: { x: laneX(step.doelLaneId) + COL_W / 2 - 55, y: ay + 22 },
          data: { naam: laneNaam(step.doelLaneId), kleur: laneKleur(step.doelLaneId) },
          style: { width: 110 },
          draggable: false,
          selectable: false,
        })
        edges.push({
          id: `msg-${step.id}`,
          source: step.id,
          target: anchorId,
          sourceHandle: 'msg',
          targetHandle: 'in',
          type: 'straight',
          animated: true,
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: '#ea5b0c' },
          style: { stroke: '#ea5b0c', strokeWidth: 1.6 },
        })
      }
    }

    // Beslissing met meerdere routes (generiek, voor toekomstige processen).
    for (const r of step.routes ?? []) {
      if (r.naarStap && stepY.has(r.naarStap)) {
        edges.push({
          id: `route-${step.id}-${r.id}`,
          source: step.id,
          target: r.naarStap,
          sourceHandle: 'out',
          targetHandle: 'in',
          type: 'smoothstep',
          label: r.label,
          markerEnd: seqMarker,
          style: seqStyle,
        })
      }
    }
  }

  return { nodes: [...laneNodes, ...stepNodes], edges }
}
