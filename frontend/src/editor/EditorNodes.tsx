import { Handle, NodeResizer, Position } from '@xyflow/react'
import type { Node, NodeProps } from '@xyflow/react'
import type { CSSProperties } from 'react'
import type { Lane, Step } from '../contract'
import { typeLabel } from '../lib/proces'

export interface EditorStepNodeData extends Record<string, unknown> {
  step: Step
  laneName: string
  laneColor: string
  sectionName?: string
  issueCount: number
  frameworkFindingCount: number
  aiFindingCount: number
  dimmed: boolean
  onResizeEnd: (
    stepId: string,
    bounds: { x: number; y: number; width: number; height: number },
  ) => void
}

export interface EditorLaneNodeData extends Record<string, unknown> {
  lane: Lane
}

export type EditorStepNodeType = Node<EditorStepNodeData, 'editorStep'>
export type EditorLaneNodeType = Node<EditorLaneNodeData, 'editorLane'>
export type ProcessEditorNode = EditorStepNodeType | EditorLaneNodeType

export function EditorStepNode({ data, selected }: NodeProps<EditorStepNodeType>) {
  const {
    step,
    laneName,
    laneColor,
    sectionName,
    issueCount,
    frameworkFindingCount,
    aiFindingCount,
    dimmed,
    onResizeEnd,
  } = data
  const terminal = step.type === 'start' || step.type === 'eind'

  return (
    <div
      className={[
        'pe-node',
        `pe-node-${step.type}`,
        terminal ? 'pe-node-terminal' : '',
        frameworkFindingCount > 0 ? 'pe-node-kaderbevinding' : '',
        aiFindingCount > 0 ? 'pe-node-ai-bevinding' : '',
        dimmed ? 'pe-node-dimmed' : '',
        selected ? 'pe-node-selected' : '',
      ].filter(Boolean).join(' ')}
      style={{ '--pe-lane-color': laneColor } as CSSProperties}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={160}
        minHeight={72}
        maxWidth={216}
        maxHeight={360}
        color="#ea5b0c"
        handleStyle={{ width: 16, height: 16, borderRadius: 4 }}
        onResizeEnd={(_, bounds) => onResizeEnd(step.id, bounds)}
      />
      <Handle
        type="target"
        id="in"
        position={Position.Top}
        aria-label={`Ingaande verbinding voor stap ${step.nummer}`}
      />
      <div className="pe-node-head">
        <span className="pe-node-number" style={{ background: laneColor }}>
          {step.nummer || '·'}
        </span>
        <span className="pe-node-type">{typeLabel[step.type]}</span>
        {issueCount > 0 && (
          <span className="pe-node-issues" title={`${issueCount} aandachtspunt(en)`}>
            ! {issueCount}
          </span>
        )}
        {frameworkFindingCount > 0 && (
          <span
            className="pe-node-framework-findings"
            title={`${frameworkFindingCount} ISO-/kaderbevinding(en)`}
            aria-label={`${frameworkFindingCount} ISO-/kaderbevindingen`}
          >
            ⚑ {frameworkFindingCount}
          </span>
        )}
        {aiFindingCount > 0 && (
          <span
            className="pe-node-ai-findings"
            title={`${aiFindingCount} AI-onderhoudssigna(a)l(en)`}
            aria-label={`${aiFindingCount} AI-onderhoudssignalen`}
          >
            ✦ {aiFindingCount}
          </span>
        )}
      </div>
      <div className="pe-node-title">{step.activiteit || 'Nieuwe stap'}</div>
      <div className="pe-node-meta">
        <span>{laneName}</span>
        {sectionName && <span>{sectionName}</span>}
      </div>
      {step.voorwaarde && <div className="pe-node-condition">Indien {step.voorwaarde}</div>}
      {step.routes && step.routes.length > 0 && (
        <div className="pe-node-routes">{step.routes.length} route(s)</div>
      )}
      {step.naarProces && <div className="pe-node-process">→ {step.naarProces}</div>}
      {step.type !== 'eind' && (
        <Handle
          type="source"
          id="out"
          position={Position.Bottom}
          aria-label={`Nieuwe vervolgverbinding vanaf stap ${step.nummer}`}
        />
      )}
    </div>
  )
}

export function EditorLaneNode({ data }: NodeProps<EditorLaneNodeType>) {
  return (
    <div className="pe-lane" style={{ '--pe-lane-color': data.lane.kleur } as CSSProperties}>
      <div className="pe-lane-head">
        <span style={{ background: data.lane.kleur }} />
        {data.lane.naam}
      </div>
    </div>
  )
}
