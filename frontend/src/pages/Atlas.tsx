import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ReactFlow, Background, Controls, MarkerType, Handle, Position } from '@xyflow/react'
import type { Node, Edge, NodeProps, NodeTypes } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { dataSource } from '../data'
import type { ProcessSummary } from '../contract'

// De atlas toont alle processen als klikbare kaart met de "Start proces ..."-
// koppelingen als pijlen. Processen waarnaar verwezen wordt maar die nog niet
// zijn ingevoerd, verschijnen als spookkaart ("nog niet ingevoerd").

const COL_W = 300
const ROW_H = 130
const COMPONENT_GAP = 180

interface AtlasItem {
  id: string
  naam: string
  bestaat: boolean
  summary?: ProcessSummary
}

interface AtlasLink {
  source: string
  target: string
}

interface AtlasPosition {
  x: number
  y: number
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort((a, b) => a.localeCompare(b, 'nl'))
}

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined
  const ordered = [...values].sort((a, b) => a - b)
  const middle = Math.floor(ordered.length / 2)
  return ordered.length % 2 === 0
    ? (ordered[middle - 1] + ordered[middle]) / 2
    : ordered[middle]
}

/**
 * Pak één kolom zo dicht mogelijk rond de gewenste y-posities, zonder dat
 * kaarten over elkaar heen komen. Dit is isotone regressie op de minimale
 * rijafstand en centreert bijvoorbeeld twee uitgaande processen rond hun bron.
 */
function packColumn(ids: string[], desiredY: Map<string, number>): Map<string, number> {
  interface Block {
    start: number
    end: number
    sum: number
    count: number
  }

  const blocks: Block[] = []
  ids.forEach((id, index) => {
    blocks.push({
      start: index,
      end: index,
      sum: (desiredY.get(id) ?? index * ROW_H) - index * ROW_H,
      count: 1,
    })

    while (blocks.length > 1) {
      const right = blocks[blocks.length - 1]
      const left = blocks[blocks.length - 2]
      if (left.sum / left.count <= right.sum / right.count) break
      blocks.splice(blocks.length - 2, 2, {
        start: left.start,
        end: right.end,
        sum: left.sum + right.sum,
        count: left.count + right.count,
      })
    }
  })

  const result = new Map<string, number>()
  for (const block of blocks) {
    const base = block.sum / block.count
    for (let index = block.start; index <= block.end; index += 1)
      result.set(ids[index], base + index * ROW_H)
  }
  return result
}

/**
 * Tarjan groepeert cycli tot één knoop. De vervolglayout werkt daardoor op een
 * acyclische graaf en blijft ook bij A → B → A eindig en voorspelbaar.
 */
function findStronglyConnectedComponents(
  nodeIds: string[],
  outgoing: Map<string, string[]>,
): string[][] {
  let nextIndex = 0
  const indexById = new Map<string, number>()
  const lowLinkById = new Map<string, number>()
  const stack: string[] = []
  const onStack = new Set<string>()
  const components: string[][] = []

  const visit = (id: string) => {
    indexById.set(id, nextIndex)
    lowLinkById.set(id, nextIndex)
    nextIndex += 1
    stack.push(id)
    onStack.add(id)

    for (const target of outgoing.get(id) ?? []) {
      if (!indexById.has(target)) {
        visit(target)
        lowLinkById.set(id, Math.min(lowLinkById.get(id)!, lowLinkById.get(target)!))
      } else if (onStack.has(target)) {
        lowLinkById.set(id, Math.min(lowLinkById.get(id)!, indexById.get(target)!))
      }
    }

    if (lowLinkById.get(id) !== indexById.get(id)) return
    const component: string[] = []
    let member: string
    do {
      member = stack.pop()!
      onStack.delete(member)
      component.push(member)
    } while (member !== id)
    components.push(sorted(component))
  }

  for (const id of nodeIds) if (!indexById.has(id)) visit(id)
  return components.sort((a, b) => a[0].localeCompare(b[0], 'nl'))
}

/**
 * Deterministische Sugiyama-achtige atlaslayout:
 * - cycli worden eerst gecondenseerd;
 * - de resulterende DAG bepaalt de kolommen;
 * - mediane voor- en achterwaartse sweeps beperken kruisende pijlen;
 * - y-coördinaten worden rond direct gekoppelde kaarten uitgelijnd.
 */
function layoutAtlas(nodeIds: string[], links: AtlasLink[]): Map<string, AtlasPosition> {
  const outgoing = new Map(nodeIds.map((id) => [id, [] as string[]]))
  const incoming = new Map(nodeIds.map((id) => [id, [] as string[]]))
  for (const { source, target } of links) {
    outgoing.get(source)!.push(target)
    incoming.get(target)!.push(source)
  }
  for (const id of nodeIds) {
    outgoing.set(id, sorted(new Set(outgoing.get(id))))
    incoming.set(id, sorted(new Set(incoming.get(id))))
  }

  const components = findStronglyConnectedComponents(nodeIds, outgoing)
  const componentByNode = new Map<string, number>()
  components.forEach((component, componentId) => {
    for (const id of component) componentByNode.set(id, componentId)
  })

  const componentOutgoing = new Map(components.map((_, id) => [id, new Set<number>()]))
  const componentIncoming = new Map(components.map((_, id) => [id, new Set<number>()]))
  for (const { source, target } of links) {
    const from = componentByNode.get(source)!
    const to = componentByNode.get(target)!
    if (from === to) continue
    componentOutgoing.get(from)!.add(to)
    componentIncoming.get(to)!.add(from)
  }

  // Losse ketens komen onder elkaar te staan, niet door elkaar in dezelfde rijen.
  const weakComponents: number[][] = []
  const visited = new Set<number>()
  for (const start of components.keys()) {
    if (visited.has(start)) continue
    const queue = [start]
    const group: number[] = []
    visited.add(start)
    while (queue.length > 0) {
      const current = queue.shift()!
      group.push(current)
      const neighbours = new Set([
        ...componentOutgoing.get(current)!,
        ...componentIncoming.get(current)!,
      ])
      for (const neighbour of [...neighbours].sort((a, b) =>
        components[a][0].localeCompare(components[b][0], 'nl'),
      )) {
        if (visited.has(neighbour)) continue
        visited.add(neighbour)
        queue.push(neighbour)
      }
    }
    weakComponents.push(group)
  }
  weakComponents.sort((a, b) =>
    components[a[0]][0].localeCompare(components[b[0]][0], 'nl'),
  )

  const positions = new Map<string, AtlasPosition>()
  let componentOffsetY = 0

  for (const weakComponent of weakComponents) {
    const componentSet = new Set(weakComponent)
    const inDegree = new Map(
      weakComponent.map((id) => [
        id,
        [...componentIncoming.get(id)!].filter((parent) => componentSet.has(parent)).length,
      ]),
    )
    const rankByComponent = new Map(weakComponent.map((id) => [id, 0]))
    const topologicalOrder: number[] = []
    const ready = weakComponent
      .filter((id) => inDegree.get(id) === 0)
      .sort((a, b) => components[a][0].localeCompare(components[b][0], 'nl'))

    // Langste-pad-rangschikking houdt iedere pijl naar rechts, behalve pijlen
    // binnen een cyclus. Een langere keten krijgt dus nooit een terugwaartse pijl.
    while (ready.length > 0) {
      const current = ready.shift()!
      topologicalOrder.push(current)
      const nextComponents = [...componentOutgoing.get(current)!]
        .filter((id) => componentSet.has(id))
        .sort((a, b) => components[a][0].localeCompare(components[b][0], 'nl'))
      for (const next of nextComponents) {
        rankByComponent.set(
          next,
          Math.max(rankByComponent.get(next)!, rankByComponent.get(current)! + 1),
        )
        inDegree.set(next, inDegree.get(next)! - 1)
        if (inDegree.get(next) === 0) {
          ready.push(next)
          ready.sort((a, b) => components[a][0].localeCompare(components[b][0], 'nl'))
        }
      }
    }

    // Schuif korte takken binnen hun geldige bandbreedte naar hun buren toe.
    // Dit voorkomt bijvoorbeeld dat A → B → D een kolom overslaat wanneer een
    // andere, langere keten ook in D uitkomt. Vertakkingen blijven juist links
    // uitgelijnd als dat hun verbindingen korter houdt.
    const maximumRank = Math.max(...rankByComponent.values())
    const compactRank = (componentId: number) => {
      const parents = [...componentIncoming.get(componentId)!].filter((id) =>
        componentSet.has(id),
      )
      const children = [...componentOutgoing.get(componentId)!].filter((id) =>
        componentSet.has(id),
      )
      const minimum = parents.length
        ? Math.max(...parents.map((id) => rankByComponent.get(id)! + 1))
        : 0
      const maximum = children.length
        ? Math.min(...children.map((id) => rankByComponent.get(id)! - 1))
        : maximumRank
      const preferred = median([
        ...parents.map((id) => rankByComponent.get(id)! + 1),
        ...children.map((id) => rankByComponent.get(id)! - 1),
      ])
      if (preferred === undefined) return
      rankByComponent.set(
        componentId,
        Math.max(minimum, Math.min(maximum, Math.round(preferred))),
      )
    }
    for (let sweep = 0; sweep < 6; sweep += 1) {
      for (const componentId of topologicalOrder) compactRank(componentId)
      for (const componentId of [...topologicalOrder].reverse()) compactRank(componentId)
    }

    const rankByNode = new Map<string, number>()
    const columns = new Map<number, string[]>()
    for (const componentId of weakComponent) {
      const rank = rankByComponent.get(componentId)!
      for (const id of components[componentId]) {
        rankByNode.set(id, rank)
        columns.set(rank, [...(columns.get(rank) ?? []), id])
      }
    }
    for (const [rank, ids] of columns) columns.set(rank, sorted(ids))
    const ranks = [...columns.keys()].sort((a, b) => a - b)

    const orderIndex = () => {
      const result = new Map<string, number>()
      for (const ids of columns.values()) {
        const divisor = Math.max(ids.length - 1, 1)
        ids.forEach((id, index) => result.set(id, index / divisor))
      }
      return result
    }
    const reorder = (rank: number, neighbours: Map<string, string[]>) => {
      const ids = columns.get(rank)!
      const oldIndex = new Map(ids.map((id, index) => [id, index]))
      const neighbourIndex = orderIndex()
      columns.set(
        rank,
        [...ids].sort((a, b) => {
          const scoreA = median(
            (neighbours.get(a) ?? [])
              .filter((id) => rankByNode.get(id) !== rank)
              .map((id) => neighbourIndex.get(id)!),
          )
          const scoreB = median(
            (neighbours.get(b) ?? [])
              .filter((id) => rankByNode.get(id) !== rank)
              .map((id) => neighbourIndex.get(id)!),
          )
          if (scoreA !== undefined && scoreB !== undefined && scoreA !== scoreB)
            return scoreA - scoreB
          if (scoreA !== undefined && scoreB === undefined) return -1
          if (scoreA === undefined && scoreB !== undefined) return 1
          return oldIndex.get(a)! - oldIndex.get(b)! || a.localeCompare(b, 'nl')
        }),
      )
    }

    // Meerdere sweeps benaderen de barycentrische volgorde van beide kanten.
    for (let sweep = 0; sweep < 4; sweep += 1) {
      for (const rank of ranks.slice(1)) reorder(rank, incoming)
      for (const rank of [...ranks].reverse().slice(1)) reorder(rank, outgoing)
    }

    const localY = new Map<string, number>()
    for (const ids of columns.values()) {
      const centreOffset = ((ids.length - 1) * ROW_H) / 2
      ids.forEach((id, index) => localY.set(id, index * ROW_H - centreOffset))
    }

    const alignColumn = (rank: number, neighbours: Map<string, string[]>) => {
      const ids = columns.get(rank)!
      const desired = new Map<string, number>()
      for (const id of ids) {
        const neighbourY = (neighbours.get(id) ?? [])
          .filter((other) => rankByNode.get(other) !== rank)
          .map((other) => localY.get(other)!)
        const connectedY = median(neighbourY)
        desired.set(
          id,
          connectedY === undefined ? localY.get(id)! : (localY.get(id)! + connectedY) / 2,
        )
      }
      const packed = packColumn(ids, desired)
      for (const [id, y] of packed) localY.set(id, y)
    }

    for (let sweep = 0; sweep < 6; sweep += 1) {
      for (const rank of ranks.slice(1)) alignColumn(rank, incoming)
      for (const rank of [...ranks].reverse().slice(1)) alignColumn(rank, outgoing)
    }

    const minimumY = Math.min(...localY.values())
    const maximumY = Math.max(...localY.values())
    for (const id of rankByNode.keys()) {
      positions.set(id, {
        x: rankByNode.get(id)! * COL_W,
        y: localY.get(id)! - minimumY + componentOffsetY,
      })
    }
    componentOffsetY += maximumY - minimumY + ROW_H + COMPONENT_GAP
  }

  return positions
}

function buildAtlas(processen: ProcessSummary[]): { nodes: Node[]; edges: Edge[] } {
  const items = new Map<string, AtlasItem>()
  for (const p of processen)
    items.set(p.id, { id: p.id, naam: p.detailproces, bestaat: true, summary: p })
  for (const p of processen)
    for (const k of p.koppelingen)
      if (!items.has(k))
        items.set(k, { id: k, naam: k.replace(/-/g, ' '), bestaat: false })

  const linkKeys = new Set<string>()
  const links: AtlasLink[] = []
  for (const process of [...processen].sort((a, b) => a.id.localeCompare(b.id, 'nl'))) {
    for (const target of sorted(new Set(process.koppelingen))) {
      const key = `${process.id}\u0000${target}`
      if (linkKeys.has(key)) continue
      linkKeys.add(key)
      links.push({ source: process.id, target })
    }
  }
  const itemIds = sorted(items.keys())
  const atlasPositions = layoutAtlas(itemIds, links)

  const nodes: Node[] = itemIds.map((id) => {
    const it = items.get(id)!
    return {
      id: it.id,
      type: 'proces',
      position: atlasPositions.get(it.id)!,
      data: { item: it },
      draggable: true,
    }
  })

  const edges: Edge[] = links.map(({ source, target }) => ({
      id: `${source}->${target}`,
      source,
      target,
      type: 'smoothstep',
      animated: true,
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: '#ea5b0c' },
      style: { stroke: '#ea5b0c', strokeWidth: 1.5 },
    }))

  return { nodes, edges }
}

function ProcesNode({ data }: NodeProps) {
  const it = data.item as AtlasItem
  return (
    <div className={`atlas-node${it.bestaat ? '' : ' ghost'}`}>
      <Handle type="target" position={Position.Left} />
      <div className="atlas-kicker">{it.summary?.hoofdproces ?? 'Nog niet ingevoerd'}</div>
      <div className="atlas-naam">{it.naam}</div>
      {it.summary && (
        <div className="atlas-meta">
          {it.summary.versie} · {it.summary.aantalStappen} stappen
        </div>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

const nodeTypes: NodeTypes = { proces: ProcesNode }

export function Atlas() {
  const [processen, setProcessen] = useState<ProcessSummary[] | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    void dataSource.getProcesses().then(setProcessen)
  }, [])

  const graaf = useMemo(() => (processen ? buildAtlas(processen) : null), [processen])

  if (!graaf) return <p className="muted">Laden…</p>

  return (
    <div className="atlas-page">
      <h1>Procesatlas</h1>
      <p className="muted">
        De hele keten in één oogopslag. Pijlen zijn "Start proces …"-koppelingen; klik een proces om
        in te zoomen. Vervaagde kaarten zijn nog niet ingevoerd.
      </p>
      <div className="sl-canvas">
        <ReactFlow
          nodes={graaf.nodes}
          edges={graaf.edges}
          nodeTypes={nodeTypes}
          fitView
          minZoom={0.2}
          nodesConnectable={false}
          onNodeClick={(_, node) => {
            const it = node.data.item as AtlasItem
            if (it.bestaat) navigate(`/proces/${it.id}`)
          }}
        >
          <Background gap={22} color="#ececf0" />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  )
}
