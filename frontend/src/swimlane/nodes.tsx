import { Handle, Position } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import { useNavigate } from 'react-router-dom'
import type { Step } from '../contract'

const typeLabel: Record<string, string> = {
  actie: 'Actie',
  bericht: 'Bericht',
  beslissing: 'Beslissing',
  subproces: 'Subproces',
  start: 'Start',
  eind: 'Einde',
  marker: 'Markering',
}

export function StepNode({ data, selected }: NodeProps) {
  const navigate = useNavigate()
  const step = data.step as Step
  const laneKleur = data.laneKleur as string
  const laneNaam = data.laneNaam as string
  const dim = Boolean(data.dim)
  const isBlok = step.type === 'subproces' || step.type === 'eind' || step.type === 'start'

  return (
    <div
      className={`sl-step${isBlok ? ' sl-blok' : ''}${selected ? ' sel' : ''}${dim ? ' sl-dim' : ''}`}
      style={{ borderTopColor: laneKleur }}
      title={`${laneNaam} · stap ${step.nummer}`}
    >
      <Handle type="target" position={Position.Top} id="in" />
      <div className="sl-step-head">
        <span className="sl-nr" style={{ background: laneKleur }}>
          {step.nummer}
        </span>
        {step.type !== 'actie' && <span className="sl-type">{typeLabel[step.type]}</span>}
      </div>
      <div className="sl-act">{step.activiteit}</div>
      {step.voorwaarde && <div className="sl-cond">Indien: {step.voorwaarde}</div>}
      {step.toelichting && <div className="sl-toel">{step.toelichting}</div>}
      {step.zijnotitie && <div className="sl-zij">{step.zijnotitie}</div>}
      {step.naarProces && (
        <button
          className="sl-link sl-link-btn"
          title={`Ga naar ${step.naarProces}`}
          onClick={(e) => {
            e.stopPropagation()
            navigate(`/proces/${step.naarProces}`)
          }}
        >
          → {step.naarProces}
        </button>
      )}
      <Handle type="source" position={Position.Bottom} id="out" />
      <Handle type="source" position={Position.Right} id="msg" />
    </div>
  )
}

export function LaneNode({ data }: NodeProps) {
  const naam = data.naam as string
  const kleur = data.kleur as string
  return (
    <div className="sl-lane">
      <div className="sl-lane-head" style={{ borderBottomColor: kleur }}>
        <span className="sl-lane-dot" style={{ background: kleur }} />
        {naam}
      </div>
    </div>
  )
}

export function SectieNode({ data }: NodeProps) {
  return <div className="sl-sectie">{data.naam as string}</div>
}

export function AnchorNode({ data }: NodeProps) {
  // Zichtbaar eindpunt van een bericht-pijl: toont de ontvangende rol.
  const naam = (data?.naam as string) ?? ''
  const kleur = (data?.kleur as string) ?? '#9ca3af'
  return (
    <div className="sl-msg-doel" style={{ borderColor: kleur }}>
      <Handle type="target" position={Position.Left} id="in" />
      <span className="lane-dot" style={{ background: kleur }} />
      {naam || 'ontvanger'}
    </div>
  )
}
