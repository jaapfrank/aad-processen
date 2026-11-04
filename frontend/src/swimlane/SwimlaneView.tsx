import { useEffect, useMemo, useRef } from 'react'
import { ReactFlow, Background, Controls } from '@xyflow/react'
import type { NodeTypes, ReactFlowInstance } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { Process, Step } from '../contract'
import { buildSwimlane } from './layout'
import { StepNode, LaneNode, SectieNode, AnchorNode } from './nodes'

const nodeTypes: NodeTypes = {
  step: StepNode,
  lane: LaneNode,
  sectie: SectieNode,
  anchor: AnchorNode,
}

const LANE_BREEDTE = 240

export function SwimlaneView({
  proces,
  onSelect,
  highlightLane,
  zoom = 1,
  fitOpdracht = 0,
  onZoomWijziging,
}: {
  proces: Process
  onSelect: (step: Step) => void
  /** Lane-id van "Mijn rol": andere stappen worden gedimd. */
  highlightLane?: string
  /** Zoomniveau dat door de algemene visualisatiewerkbalk wordt aangestuurd. */
  zoom?: number
  /** Oplopende teller om opnieuw passend op breedte te zetten. */
  fitOpdracht?: number
  onZoomWijziging?: (zoom: number) => void
}) {
  const wrapper = useRef<HTMLDivElement>(null)
  const instanceRef = useRef<ReactFlowInstance | null>(null)
  const { nodes: baseNodes, edges } = useMemo(() => buildSwimlane(proces), [proces])

  const nodes = useMemo(() => {
    if (!highlightLane) return baseNodes
    return baseNodes.map((n) =>
      n.type === 'step'
        ? { ...n, data: { ...n.data, dim: (n.data.step as Step).laneId !== highlightLane } }
        : n,
    )
  }, [baseNodes, highlightLane])

  // Fit op breedte (leesbaar) en scroll verticaal door het proces, in plaats
  // van fitView dat het hele (hoge) diagram onleesbaar klein maakt.
  const fitOpBreedte = (inst: ReactFlowInstance) => {
    const beschikbaar = wrapper.current?.clientWidth ?? 1200
    const inhoud = proces.lanes.length * LANE_BREEDTE
    const zoom = Math.min(1, (beschikbaar - 32) / inhoud)
    inst.setViewport({ x: (beschikbaar - inhoud * zoom) / 2, y: 12, zoom })
    onZoomWijziging?.(zoom)
  }

  useEffect(() => {
    const instance = instanceRef.current
    if (!instance || Math.abs(instance.getZoom() - zoom) < 0.005) return
    void instance.zoomTo(zoom, { duration: 160 })
  }, [zoom])

  useEffect(() => {
    if (fitOpdracht === 0 || !instanceRef.current) return
    fitOpBreedte(instanceRef.current)
  // `fitOpBreedte` gebruikt bewust de actuele props en canvasbreedte.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitOpdracht])

  return (
    <div className="sl-canvas" ref={wrapper}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onInit={(instance) => {
          instanceRef.current = instance
          fitOpBreedte(instance)
        }}
        onMove={(_, viewport) => onZoomWijziging?.(viewport.zoom)}
        minZoom={0.4}
        maxZoom={2}
        panOnScroll
        zoomOnScroll={false}
        nodesDraggable={false}
        nodesConnectable={false}
        onNodeClick={(_, node) => {
          if (node.type === 'step') onSelect((node.data as { step: Step }).step)
        }}
      >
        <Background gap={22} color="#ececf0" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}
