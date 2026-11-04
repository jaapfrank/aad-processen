import { useMemo, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import type { Process, Step, StepSystemEvent } from '../contract'
import { SwimlaneView } from '../swimlane/SwimlaneView'
import { useHuisstijl } from '../lib/huisstijl'
import {
  isSysteemLaneNaam,
  maakBrongetrouweLayout,
  tekstregels,
} from './brongetrouweLayout'
import { bepaalBrongetrouweStapSemantiek } from './brongetrouweSemantiek'
import {
  bepaalExplicieteProcesverbindingen,
  ordenStappenVoorDiagram,
} from './processConnections'
import './visualisaties.css'

export type ProcessVisualisatieModus =
  | 'brongetrouw'
  | 'interactief'
  | 'flowchart'
  | 'bpmn'
  | 'sipoc'
  | 'value-stream'

export interface ProcessVisualisatieProps {
  proces: Process
  modus?: ProcessVisualisatieModus
  standaardModus?: ProcessVisualisatieModus
  onModusWijziging?: (modus: ProcessVisualisatieModus) => void
  onSelectStep?: (step: Step) => void
  highlightLane?: string
  toonKiezer?: boolean
  className?: string
}

const MODI: ReadonlyArray<{
  id: ProcessVisualisatieModus
  label: string
  kort: string
}> = [
  { id: 'brongetrouw', label: 'Brongetrouwe PDF / sequence-swimlane', kort: 'Brongetrouw' },
  { id: 'interactief', label: 'Huidige interactieve swimlane', kort: 'Interactief' },
  { id: 'flowchart', label: 'Flowchart', kort: 'Flowchart' },
  { id: 'bpmn', label: 'BPMN', kort: 'BPMN' },
  { id: 'sipoc', label: 'SIPOC', kort: 'SIPOC' },
  { id: 'value-stream', label: 'Value-stream / tijdlijn', kort: 'Value-stream' },
]

const MIN_ZOOM = 0.4
const MAX_ZOOM = 2
const ZOOM_STEP = 0.1

interface SleepPanState {
  pointerId: number
  x: number
  y: number
  scrollLeft: number
  scrollTop: number
}

/**
 * Maakt de statische SVG/HTML-visualisaties met slepen verschuifbaar. Klikken
 * op een processtap blijft een selectie; slepen op het blad verplaatst alleen
 * de viewport en wijzigt nooit het procesmodel.
 */
function useSleepPan() {
  const sleep = useRef<SleepPanState | undefined>(undefined)

  const start = (event: ReactPointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const opScrollbar =
      event.clientX >= bounds.left + event.currentTarget.clientWidth ||
      event.clientY >= bounds.top + event.currentTarget.clientHeight
    if (
      event.button !== 0 ||
      !event.isPrimary ||
      opScrollbar ||
      (event.target instanceof Element &&
        Boolean(event.target.closest('button, a, input, select, textarea')))
    ) return
    sleep.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      scrollLeft: event.currentTarget.scrollLeft,
      scrollTop: event.currentTarget.scrollTop,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.currentTarget.classList.add('pv-pannend')
    event.preventDefault()
  }

  const beweeg = (event: ReactPointerEvent<HTMLDivElement>) => {
    const actief = sleep.current
    if (!actief || actief.pointerId !== event.pointerId) return
    event.currentTarget.scrollLeft = actief.scrollLeft - (event.clientX - actief.x)
    event.currentTarget.scrollTop = actief.scrollTop - (event.clientY - actief.y)
    event.preventDefault()
  }

  const stop = (event: ReactPointerEvent<HTMLDivElement>) => {
    const actief = sleep.current
    if (!actief || actief.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    event.currentTarget.classList.remove('pv-pannend')
    sleep.current = undefined
  }

  return {
    onPointerDown: start,
    onPointerMove: beweeg,
    onPointerUp: stop,
    onPointerCancel: stop,
  }
}

function begrensZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom * 100) / 100))
}

function ZoomBediening({
  zoom,
  onZoom,
  onPassend,
}: {
  zoom: number
  onZoom: (zoom: number) => void
  onPassend: () => void
}) {
  const percentage = Math.round(zoom * 100)

  return (
    <div className="pv-zoom-bediening" role="group" aria-label="Zoom procesvisualisatie">
      <button
        type="button"
        aria-label="Uitzoomen"
        title="Uitzoomen"
        disabled={zoom <= MIN_ZOOM}
        onClick={() => onZoom(begrensZoom(zoom - ZOOM_STEP))}
      >
        −
      </button>
      <output aria-label="Zoomniveau" aria-live="polite">{percentage}%</output>
      <button
        type="button"
        aria-label="Inzoomen"
        title="Inzoomen"
        disabled={zoom >= MAX_ZOOM}
        onClick={() => onZoom(begrensZoom(zoom + ZOOM_STEP))}
      >
        +
      </button>
      <button
        type="button"
        aria-label="Zoom herstellen naar 100%"
        title="Zoom herstellen naar 100%"
        disabled={Math.abs(zoom - 1) < 0.005}
        onClick={() => onZoom(1)}
      >
        Reset
      </button>
      <button
        type="button"
        aria-label="Visualisatie passend weergeven"
        title="Visualisatie passend weergeven"
        onClick={onPassend}
      >
        Passend
      </button>
    </div>
  )
}

export function ProcessVisualisatieKiezer({
  waarde,
  onWijziging,
}: {
  waarde: ProcessVisualisatieModus
  onWijziging: (modus: ProcessVisualisatieModus) => void
}) {
  return (
    <div className="pv-kiezer" role="toolbar" aria-label="Kies procesvisualisatie">
      {MODI.map((modus) => (
        <button
          key={modus.id}
          type="button"
          className={waarde === modus.id ? 'actief' : ''}
          aria-pressed={waarde === modus.id}
          title={modus.label}
          onClick={() => onWijziging(modus.id)}
        >
          {modus.kort}
        </button>
      ))}
    </div>
  )
}

export function ProcessVisualisatie({
  proces,
  modus,
  standaardModus = 'brongetrouw',
  onModusWijziging,
  onSelectStep,
  highlightLane,
  toonKiezer = true,
  className = '',
}: ProcessVisualisatieProps) {
  const [interneModus, setInterneModus] = useState<ProcessVisualisatieModus>(standaardModus)
  const [zoom, setZoom] = useState(1)
  const [fitOpdracht, setFitOpdracht] = useState(0)
  const weergaveRef = useRef<HTMLDivElement>(null)
  const actief = modus ?? interneModus
  const selecteer = onSelectStep ?? (() => undefined)

  const wijzig = (nieuw: ProcessVisualisatieModus) => {
    if (modus === undefined) setInterneModus(nieuw)
    onModusWijziging?.(nieuw)
  }

  const pasIn = () => {
    if (actief === 'interactief') {
      setFitOpdracht((waarde) => waarde + 1)
      return
    }

    const gebied = weergaveRef.current?.querySelector<HTMLElement>('[data-pv-zoomgebied]')
    if (!gebied) return
    const svg = gebied.querySelector<SVGSVGElement>('svg')
    const natuurlijkeBreedte = svg?.viewBox.baseVal.width ||
      Number(gebied.dataset.pvNatuurlijkeBreedte) ||
      gebied.scrollWidth / zoom
    if (!Number.isFinite(natuurlijkeBreedte) || natuurlijkeBreedte <= 0) return
    setZoom(begrensZoom((gebied.clientWidth - 20) / natuurlijkeBreedte))
  }

  return (
    <section className={`pv-root ${className}`.trim()}>
      <div className="pv-bovenbalk">
        {toonKiezer && <ProcessVisualisatieKiezer waarde={actief} onWijziging={wijzig} />}
        <ZoomBediening zoom={zoom} onZoom={setZoom} onPassend={pasIn} />
      </div>
      <div className={`pv-weergave pv-${actief}`} ref={weergaveRef}>
        {actief === 'brongetrouw' && (
          <BrongetrouweSequence
            proces={proces}
            onSelect={selecteer}
            highlightLane={highlightLane}
            zoom={zoom}
          />
        )}
        {actief === 'interactief' && (
          <SwimlaneView
            proces={proces}
            onSelect={selecteer}
            highlightLane={highlightLane}
            zoom={zoom}
            fitOpdracht={fitOpdracht}
            onZoomWijziging={(waarde) => setZoom(begrensZoom(waarde))}
          />
        )}
        {actief === 'flowchart' && (
          <Flowchart
            proces={proces}
            onSelect={selecteer}
            highlightLane={highlightLane}
            zoom={zoom}
          />
        )}
        {actief === 'bpmn' && (
          <Bpmn
            proces={proces}
            onSelect={selecteer}
            highlightLane={highlightLane}
            zoom={zoom}
          />
        )}
        {actief === 'sipoc' && <Sipoc proces={proces} zoom={zoom} />}
        {actief === 'value-stream' && (
          <ValueStream
            proces={proces}
            onSelect={selecteer}
            highlightLane={highlightLane}
            zoom={zoom}
          />
        )}
      </div>
    </section>
  )
}

function stappenInVolgorde(proces: Process): Step[] {
  const metSectie = proces.secties.flatMap((sectie) =>
    proces.stappen.filter((stap) => stap.sectieId === sectie.id),
  )
  const opgenomen = new Set(metSectie.map((stap) => stap.id))
  return [...metSectie, ...proces.stappen.filter((stap) => !opgenomen.has(stap.id))]
}

function laneNaam(proces: Process, laneId: string): string {
  return proces.lanes.find((lane) => lane.id === laneId)?.naam ?? laneId
}

function SvgTekst({
  x,
  y,
  tekst,
  maxTekens = 30,
  className,
  anchor = 'start',
  regelHoogte = 15,
}: {
  x: number
  y: number
  tekst: string
  maxTekens?: number
  className?: string
  anchor?: 'start' | 'middle' | 'end'
  regelHoogte?: number
}) {
  return (
    <text x={x} y={y} className={className} textAnchor={anchor}>
      {tekstregels(tekst, maxTekens).map((regel, index) => (
        <tspan key={`${regel}-${index}`} x={x} dy={index === 0 ? 0 : regelHoogte}>
          {regel}
        </tspan>
      ))}
    </text>
  )
}

function formatBronDatum(datum: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(datum)
  return match ? `${Number(match[3])}-${Number(match[2])}-${match[1]}` : datum
}

function BrongetrouweSequence({
  proces,
  onSelect,
  highlightLane,
  zoom,
}: {
  proces: Process
  onSelect: (step: Step) => void
  highlightLane?: string
  zoom: number
}) {
  const pan = useSleepPan()
  const diagram = useMemo(() => maakBrongetrouweLayout(proces), [proces])
  const stijl = useHuisstijl((state) => state.stijl)
  const laneXs = [...diagram.lanePosities.values()]
  const laneBegin = laneXs.length > 0 ? Math.min(...laneXs) : diagram.links
  const laneEinde = laneXs.length > 0 ? Math.max(...laneXs) : diagram.breedte - diagram.links
  const schaal = diagram.schaal
  const stapHalf = 9.22 * schaal
  const systeemStraal = 5.1 * schaal
  const regelHoogte = 9.6 * schaal
  const laneX = (laneId: string): number | undefined => diagram.lanePosities.get(laneId)
  const eventAfstanden = (aantal: number): number[] => {
    if (aantal <= 0) return []
    if (aantal === 1) return [20]
    if (aantal === 2) return [18, 35]
    return Array.from({ length: aantal }, (_, index) => {
      if (index === 0) return 20
      if (index === 1) return 43
      if (index === 2) return 62
      return 62 + (index - 2) * 19
    })
  }
  const bronStijl = {
    '--pv-bron-brand': `${22 * schaal}px`,
    '--pv-bron-meta': `${12 * schaal}px`,
    '--pv-bron-klein': `${6 * schaal}px`,
    '--pv-bron-lane': `${9.96 * schaal}px`,
    '--pv-bron-body': `${8.04 * schaal}px`,
    '--pv-bron-voorwaarde': `${6 * schaal}px`,
    '--pv-bron-lijn': `${0.72 * schaal}px`,
    '--pv-bron-fijn': `${0.24 * schaal}px`,
    '--pv-bron-sectie-dash': `${5.04 * schaal}px ${3.6 * schaal}px`,
    '--pv-bron-systeem-dash': `${0.72 * schaal}px ${1.44 * schaal}px`,
    '--pv-bron-fijn-dash': `${0.9 * schaal}px ${0.9 * schaal}px`,
  } as CSSProperties

  const renderGebeurtenis = (
    gebeurtenis: StepSystemEvent,
    y: number,
    sleutel: string,
  ) => {
    const x = laneX(gebeurtenis.laneId)
    if (x === undefined) return null
    const doelX = gebeurtenis.doelLaneId ? laneX(gebeurtenis.doelLaneId) : undefined
    const richting = doelX === undefined || doelX >= x ? 1 : -1
    const maxTekens =
      gebeurtenis.type === 'synchronisatie'
        ? 14
        : gebeurtenis.type === 'status'
          ? 18
          : 12
    const regels = tekstregels(gebeurtenis.activiteit, maxTekens)
    const staatAanRechterBladrand =
      doelX === undefined && Math.abs(x - laneEinde) < 0.5
    const tekstX = doelX === undefined
      ? x + (staatAanRechterBladrand ? 9.2 : 11.5) * schaal
      : x + richting * 11.5 * schaal

    return (
      <g key={sleutel} className={`pv-systeem-event pv-systeem-event-${gebeurtenis.type}`}>
        {doelX !== undefined && (
          <line
            x1={x + richting * systeemStraal}
            x2={doelX - richting * systeemStraal}
            y1={y}
            y2={y}
            className="pv-bericht pv-systeem-event-lijn"
          />
        )}
        <rect
          x={tekstX - 1.5 * schaal}
          y={y - (regels.length * regelHoogte) / 2 - 1.5 * schaal}
          width={Math.max(24, Math.max(...regels.map((regel) => regel.length)) * 4.1) * schaal}
          height={regels.length * regelHoogte + 3 * schaal}
          fill="#fff"
        />
        <circle cx={x} cy={y} r={systeemStraal} className="pv-systeemcirkel" />
        {doelX !== undefined && (
          <circle cx={doelX} cy={y} r={systeemStraal} className="pv-systeemcirkel" />
        )}
        <SvgTekst
          x={tekstX}
          y={y - ((regels.length - 1) * regelHoogte) / 2 + 2.4 * schaal}
          tekst={gebeurtenis.activiteit}
          maxTekens={maxTekens}
          anchor="start"
          className="pv-systeem-event-tekst"
          regelHoogte={regelHoogte}
        />
      </g>
    )
  }

  return (
    <div
      className="pv-scroll pv-scroll-verticaal pv-fidelity"
      role="region"
      aria-label={`Scrollbare brongetrouwe weergave van ${proces.detailproces}`}
      tabIndex={0}
      data-pv-zoomgebied
      {...pan}
    >
      <svg
        viewBox={`0 0 ${diagram.breedte} ${diagram.hoogte}`}
        width={diagram.breedte * zoom}
        height={diagram.hoogte * zoom}
        preserveAspectRatio="xMidYMin meet"
        data-layout-ratio={(diagram.breedte / diagram.hoogte).toFixed(3)}
        data-brongetrouwe-schaal={diagram.schaal.toFixed(4)}
        style={bronStijl}
        role="img"
        aria-label={`Brongetrouwe sequence-swimlane van ${proces.detailproces}`}
      >
        <defs>
          <linearGradient id={`koplijn-${proces.id}`} x1="0" x2="1">
            <stop offset="0" stopColor="#242424" />
            <stop offset="1" stopColor="#ededed" />
          </linearGradient>
          <marker id={`pijl-${proces.id}`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill="#111" />
          </marker>
        </defs>

        <rect width={diagram.breedte} height={diagram.hoogte} fill="#fff" />
        <line x1="0" x2={diagram.breedte} y1={0.36 * schaal} y2={0.36 * schaal} className="pv-pagina-rand" />
        {stijl.logoDataUrl ? <image href={stijl.logoDataUrl} x={diagram.links} y={12 * schaal}
          width={250 * schaal} height={30 * schaal} preserveAspectRatio="xMinYMid meet" /> :
          <text x={diagram.links} y={40.3 * schaal} className="pv-bedrijfsnaam" fill={stijl.primaireKleur}
            style={{ fontSize: Math.min(22.2, 350 / Math.max(1, stijl.bedrijfsnaam.length)) * schaal }}>
            {stijl.bedrijfsnaam}
          </text>}
        <rect
          x={diagram.links}
          y={45.7 * schaal}
          width={Math.min(527.24 * schaal, diagram.breedte - diagram.links * 2)}
          height={4.25 * schaal}
          fill={`url(#koplijn-${proces.id})`}
        />
        <text x={diagram.links + 4.53 * schaal} y={68.59 * schaal} className="pv-meta">
          Hoofdproces: {proces.hoofdproces}
        </text>
        <text x={diagram.links + 4.53 * schaal} y={82.99 * schaal} className="pv-meta">
          Detailproces: {proces.detailproces}
        </text>
        <text x={diagram.links + 4.53 * schaal} y={97.39 * schaal} className="pv-meta">
          Versie: {proces.versie}
        </text>
        <text x={diagram.links + 73.24 * schaal} y={97.39 * schaal} className="pv-meta-klein">
          Laatste wijziging {formatBronDatum(proces.laatsteWijziging)}
        </text>

        {proces.lanes.map((lane) => {
          const x = diagram.lanePosities.get(lane.id) ?? laneBegin
          const systeemLane = isSysteemLaneNaam(lane.naam)
          const gestippeldeLaneKop = /\berp\b/i.test(lane.naam)
          const laneRegels = tekstregels(lane.naam, 22)
          return (
            <g key={lane.id}>
              <SvgTekst
                x={x}
                y={diagram.kopHoogte - 10.9 * schaal - (laneRegels.length - 1) * 6 * schaal}
                tekst={lane.naam}
                maxTekens={22}
                anchor="middle"
                className={systeemLane ? 'pv-lane-naam pv-lane-naam-systeem' : 'pv-lane-naam'}
                regelHoogte={12 * schaal}
              />
              <line
                x1={x - diagram.laneKopBreedte / 2}
                x2={x + diagram.laneKopBreedte / 2}
                y1={diagram.kopHoogte}
                y2={diagram.kopHoogte}
                className={gestippeldeLaneKop ? 'pv-lane-kop pv-lane-kop-systeem' : 'pv-lane-kop'}
              />
              <line
                x1={x}
                x2={x}
                y1={diagram.kopHoogte}
                y2={diagram.hoogte - 15.5 * schaal}
                className="pv-lifeline"
              />
            </g>
          )
        })}

        {diagram.secties.map((sectie) => (
          <g key={`${sectie.naam}-${sectie.y}`}>
            <line
              x1={laneBegin - diagram.laneKopBreedte / 2}
              x2={Math.min(
                laneEinde,
                laneBegin - diagram.laneKopBreedte / 2 + diagram.laneBreedte * 2.13,
              )}
              y1={sectie.y}
              y2={sectie.y}
              className="pv-sectie-lijn"
            />
            <rect
              x={laneBegin - diagram.laneKopBreedte / 2 + 3 * schaal}
              y={sectie.y + 1.5 * schaal}
              width={Math.min(210, sectie.naam.length * 4.2 + 9) * schaal}
              height={12 * schaal}
              fill="#fff"
            />
            <text
              x={laneBegin - diagram.laneKopBreedte / 2 + 4 * schaal}
              y={sectie.y + 11.2 * schaal}
              className="pv-sectie-naam"
            >
              {sectie.naam}
            </text>
          </g>
        ))}

        {stappenInVolgorde(proces).map((stap) => {
          const positie = diagram.posities.get(stap.id)
          if (!positie) return null
          const semantiek = bepaalBrongetrouweStapSemantiek(stap)
          const hoofdinteractie = semantiek.hoofdinteractie
          const doelX = hoofdinteractie
            ? diagram.lanePosities.get(hoofdinteractie.doelLaneId)
            : undefined
          const systeem = isSysteemLaneNaam(laneNaam(proces, stap.laneId))
          const doelSysteem = hoofdinteractie
            ? isSysteemLaneNaam(laneNaam(proces, hoofdinteractie.doelLaneId))
            : false
          const marker = ['start', 'eind', 'subproces', 'marker'].includes(stap.type)
          const conditie = stap.type === 'beslissing' || Boolean(stap.voorwaarde)
          const afstand = doelX === undefined ? 0 : Math.abs(doelX - positie.x)
          const activiteitMax = conditie && doelX !== undefined
            ? 17
            : doelX === undefined
            ? stap.type === 'eind'
              ? 14
              : marker
                ? 18
                : 34
            : afstand <= diagram.laneBreedte * 1.1
              ? 17
              : Math.min(70, Math.max(17, Math.floor(afstand / (4.2 * schaal))))
          const activiteitRegels = tekstregels(stap.activiteit, activiteitMax)
          const activiteitNaastBron = conditie && doelX !== undefined
          const labelX = activiteitNaastBron
            ? positie.x + 13.8 * schaal
            : doelX === undefined
            ? positie.x + 13.8 * schaal
            : (positie.x + doelX) / 2
          const richting = doelX === undefined || doelX >= positie.x ? 1 : -1
          const bronStraal = systeem && !marker ? systeemStraal : stapHalf
          const doelStraal = doelSysteem ? systeemStraal : stapHalf
          const lijnStart = positie.x + richting * bronStraal
          const lijnEinde = doelX === undefined ? positie.x : doelX - richting * doelStraal
          const activiteitBreedte = (
            Math.max(10, ...activiteitRegels.map((regel) => regel.length)) * 4.2 + 5
          ) * schaal
          const activiteitHoogte = activiteitRegels.length * regelHoogte + 3 * schaal
          const voorAfstanden = eventAfstanden(semantiek.gebeurtenissenVoor.length)
          const naAfstanden = eventAfstanden(semantiek.gebeurtenissenNa.length)
          const inDiagramAnnotaties = semantiek.annotaties.filter(
            (annotatie) => annotatie.plaatsing === 'in-diagram',
          )
          const rechterAnnotaties = semantiek.annotaties.filter(
            (annotatie) => annotatie.plaatsing === 'rechts',
          )
          return (
            <g
              key={stap.id}
              className="pv-svg-stap"
              opacity={highlightLane && stap.laneId !== highlightLane ? 0.2 : 1}
              role="button"
              tabIndex={0}
              aria-label={`Stap ${stap.nummer}: ${stap.activiteit}`}
              onClick={() => onSelect(stap)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') onSelect(stap)
              }}
            >
              {semantiek.gebeurtenissenVoor.map((gebeurtenis, index) =>
                renderGebeurtenis(
                  gebeurtenis,
                  positie.y - voorAfstanden[voorAfstanden.length - 1 - index] * schaal,
                  `${stap.id}:voor:${gebeurtenis.id}`,
                ),
              )}

              {doelX !== undefined && (
                <>
                  <line
                    x1={lijnStart}
                    x2={lijnEinde}
                    y1={positie.y}
                    y2={positie.y}
                    className="pv-bericht"
                    markerEnd={hoofdinteractie?.metPijl ? `url(#pijl-${proces.id})` : undefined}
                  />
                  <rect
                    x={
                      activiteitNaastBron
                        ? labelX - 2 * schaal
                        : labelX - activiteitBreedte / 2
                    }
                    y={positie.y - activiteitHoogte / 2}
                    width={activiteitBreedte}
                    height={activiteitHoogte}
                    fill="#fff"
                  />
                  {doelSysteem ? (
                    <circle cx={doelX} cy={positie.y} r={systeemStraal} className="pv-systeemcirkel" />
                  ) : (
                    <rect
                      x={doelX - stapHalf}
                      y={positie.y - stapHalf}
                      width={stapHalf * 2}
                      height={stapHalf * 2}
                      className={
                        hoofdinteractie?.soort === 'bericht'
                          ? 'pv-stap-vierkant pv-doelsymbool pv-doelsymbool-bericht'
                          : stap.voorwaarde || stap.toelichting
                            ? 'pv-stap-vierkant pv-doelsymbool pv-doelsymbool-gevuld'
                            : 'pv-stap-vierkant pv-doelsymbool'
                      }
                    />
                  )}
                </>
              )}

              {systeem && !marker ? (
                <circle cx={positie.x} cy={positie.y} r={systeemStraal} className="pv-systeemcirkel" />
              ) : (
                <rect
                  x={positie.x - stapHalf}
                  y={positie.y - stapHalf}
                  width={stapHalf * 2}
                  height={stapHalf * 2}
                  className={marker ? 'pv-marker' : 'pv-stap-vierkant'}
                />
              )}
              {(!systeem || (doelX !== undefined && !doelSysteem)) && (
                <text
                  x={systeem && doelX !== undefined ? doelX : positie.x}
                  y={positie.y + 3 * schaal}
                  textAnchor="middle"
                  className="pv-stapnummer"
                >
                  {stap.type === 'subproces' ? stap.nummer.toLocaleLowerCase('nl') : stap.nummer}
                </text>
              )}

              {conditie && (
                <path
                  d={`M ${positie.x + richting * 9.8 * schaal} ${positie.y - 9 * schaal} L ${positie.x + richting * 28 * schaal} ${positie.y} L ${positie.x + richting * 9.8 * schaal} ${positie.y + 9 * schaal} Z`}
                  className="pv-conditiewig"
                />
              )}

              {doelX === undefined && (
                <rect
                  x={labelX - 2 * schaal}
                  y={positie.y - activiteitHoogte / 2}
                  width={activiteitBreedte}
                  height={activiteitHoogte}
                  fill="#fff"
                />
              )}
              <SvgTekst
                x={doelX === undefined ? positie.x + (conditie ? 30 : 13.8) * schaal : labelX}
                y={positie.y - ((activiteitRegels.length - 1) * regelHoogte) / 2 + 2.4 * schaal}
                tekst={stap.activiteit}
                maxTekens={activiteitMax}
                anchor={doelX === undefined || activiteitNaastBron ? 'start' : 'middle'}
                className={marker ? 'pv-activiteit pv-vet' : 'pv-activiteit'}
                regelHoogte={regelHoogte}
              />

              {stap.voorwaarde && (
                <SvgTekst
                  x={positie.x + richting * 29 * schaal}
                  y={positie.y + 14.8 * schaal}
                  tekst={
                    /^indien\b/i.test(stap.voorwaarde)
                      ? stap.voorwaarde
                      : `Indien ${stap.voorwaarde}`
                  }
                  maxTekens={28}
                  anchor={richting < 0 ? 'end' : 'start'}
                  className="pv-voorwaarde"
                  regelHoogte={7.2 * schaal}
                />
              )}

              {inDiagramAnnotaties.map((annotatie, index) => {
                const regels = tekstregels(annotatie.tekst, 58)
                const interactieNaarRechts =
                  doelX !== undefined && doelX > positie.x && !doelSysteem
                const interactieNaarLinks =
                  doelX !== undefined && doelX < positie.x && !doelSysteem
                const annotatieX = interactieNaarRechts
                  ? doelX + 23 * schaal
                  : interactieNaarLinks
                    ? positie.x - 28 * schaal
                    : diagram.annotatieX
                const annotatieAnchor = interactieNaarLinks ? 'end' : 'start'
                const basisOffsetY = stap.voorwaarde
                  ? 48
                  : interactieNaarRechts && regels.length === 1
                    ? 0
                    : 16
                const tekstY =
                  positie.y +
                  (basisOffsetY + index * (regels.length * 9.6 + 6)) * schaal
                return (
                  <g key={annotatie.id} className="pv-annotatie-groep">
                  <line
                      x1={positie.x + 43 * schaal}
                      x2={annotatieX}
                      y1={positie.y + 3 * schaal}
                      y2={tekstY - 5 * schaal}
                    className="pv-annotatie-leider"
                  />
                    <path
                      d={`M ${annotatieX} ${tekstY - 7 * schaal} v ${Math.max(12, regels.length * 9.6) * schaal}`}
                      className="pv-annotatie-haak"
                    />
                    <SvgTekst
                        x={annotatieX + 0.8 * schaal}
                        y={tekstY}
                        tekst={annotatie.tekst}
                        maxTekens={58}
                        anchor={annotatieAnchor}
                        className="pv-annotatie"
                        regelHoogte={9.6 * schaal}
                    />
                  </g>
                )
              })}

              {rechterAnnotaties.map((annotatie, index) => {
                const regels = tekstregels(annotatie.tekst, 24)
                const y = positie.y + index * (regels.length * 9.6 + 5) * schaal
                return (
                  <g key={annotatie.id}>
                      <path
                      d={`M ${diagram.systeemNotitieX - 3 * schaal} ${y - 8 * schaal} h ${8 * schaal}`}
                      className="pv-annotatie-haak"
                      />
                      <SvgTekst
                      x={diagram.systeemNotitieX}
                      y={y - ((regels.length - 1) * regelHoogte) / 2 + 2.4 * schaal}
                      tekst={annotatie.tekst}
                      maxTekens={24}
                      className={annotatie.soort === 'waarschuwing' ? 'pv-annotatie pv-waarschuwing' : 'pv-termijn-tekst'}
                      regelHoogte={regelHoogte}
                      />
                    </g>
                )
              })}

              {stap.termijn && (
                <g className="pv-termijn">
                  <path
                    d={`M ${diagram.systeemNotitieX - 3 * schaal} ${positie.y - 10 * schaal} h ${5 * schaal} v ${20 * schaal} h ${-5 * schaal}`}
                    className="pv-termijn-haak"
                  />
                  <SvgTekst
                    x={diagram.systeemNotitieX + 5 * schaal}
                    y={positie.y + 2.4 * schaal}
                    tekst={stap.termijn}
                    maxTekens={30}
                    className="pv-termijn-tekst"
                    regelHoogte={regelHoogte}
                  />
                </g>
              )}

              {semantiek.gebeurtenissenNa.map((gebeurtenis, index) =>
                renderGebeurtenis(
                  gebeurtenis,
                  positie.y + naAfstanden[index] * schaal,
                  `${stap.id}:na:${gebeurtenis.id}`,
                ),
              )}
            </g>
          )
        })}

      </svg>
    </div>
  )
}

function Flowchart({
  proces,
  onSelect,
  highlightLane,
  zoom,
}: {
  proces: Process
  onSelect: (step: Step) => void
  highlightLane?: string
  zoom: number
}) {
  const pan = useSleepPan()
  const stappen = useMemo(() => ordenStappenVoorDiagram(proces), [proces])
  const verbindingen = useMemo(() => bepaalExplicieteProcesverbindingen(proces), [proces])
  const interneVerbindingen = verbindingen.filter(
    (verbinding) => verbinding.doelType === 'stap' && verbinding.doelBestaat,
  )
  const explicieteDoelen = verbindingen.filter(
    (verbinding) => verbinding.doelType === 'proces' || !verbinding.doelBestaat,
  )
  const row = 118
  const width = 900
  const nodesHeight = Math.max(360, 90 + stappen.length * row)
  const height = nodesHeight + (explicieteDoelen.length > 0 ? 52 + explicieteDoelen.length * 24 : 0)
  const posities = new Map(stappen.map((stap, index) => [stap.id, { x: width / 2, y: 70 + index * row }]))
  const stapIndex = new Map(stappen.map((stap, index) => [stap.id, index]))
  const stapOpId = new Map(stappen.map((stap) => [stap.id, stap]))

  return (
    <div
      className="pv-scroll pv-scroll-verticaal"
      role="region"
      aria-label={`Scrollbare flowchart van ${proces.detailproces}`}
      tabIndex={0}
      data-pv-zoomgebied
      {...pan}
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width * zoom}
        height={height * zoom}
        role="img"
        aria-label={`Flowchart van ${proces.detailproces}`}
      >
        <defs>
          <marker id={`flow-pijl-${proces.id}`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill="#72727b" />
          </marker>
        </defs>
        <text x="32" y="34" className="pv-diagram-titel">{proces.detailproces} — flowchart</text>
        {stappen.flatMap((stap) => {
          const bron = posities.get(stap.id)!
          const uitgaand = interneVerbindingen.filter((verbinding) => verbinding.bronId === stap.id)
          return uitgaand.map((verbinding, routeIndex) => {
            const target = posities.get(verbinding.doelId)
            if (!target) return null
            const bronIndex = stapIndex.get(stap.id) ?? 0
            const doelIndex = stapIndex.get(verbinding.doelId) ?? 0
            const doelStap = stapOpId.get(verbinding.doelId)
            const aangrenzendVooruit = doelIndex === bronIndex + 1 && uitgaand.length === 1
            const zelflus = doelIndex === bronIndex
            const bronHalf = stap.type === 'beslissing' ? 95 : 135
            const doelHalf = doelStap?.type === 'beslissing' ? 95 : 135
            const bronHoogte = stap.type === 'beslissing' ? 42 : 34
            const doelHoogte = doelStap?.type === 'beslissing' ? 42 : 34
            const tak = routeIndex - (uitgaand.length - 1) / 2
            const zijde = tak === 0 ? (doelIndex < bronIndex ? 1 : -1) : Math.sign(tak)
            const routeX = bron.x + zijde * (190 + Math.abs(tak) * 70)
            const bronPoortY = bron.y + tak * 18
            const doelPoortY = target.y + tak * 8
            const pad = aangrenzendVooruit
              ? `M ${bron.x} ${bron.y + bronHoogte} V ${target.y - doelHoogte}`
              : zelflus
                ? `M ${bron.x + bronHalf} ${bron.y} H ${bron.x + bronHalf + 90 + routeIndex * 30} V ${bron.y + 70 + routeIndex * 18} H ${bron.x} V ${bron.y + bronHoogte}`
                : `M ${bron.x + zijde * bronHalf} ${bronPoortY} H ${routeX} V ${doelPoortY} H ${target.x + zijde * doelHalf}`
            const labelX = aangrenzendVooruit ? bron.x + 12 : routeX + zijde * 8
            const labelY = aangrenzendVooruit
              ? (bron.y + target.y) / 2 - 5
              : zelflus
                ? bron.y + 62 + routeIndex * 18
                : bronPoortY - 7
            return (
              <g
                key={`${stap.id}-${verbinding.doelId}-${verbinding.routeId ?? routeIndex}`}
                className="pv-expliciete-verbinding"
                data-source-step={verbinding.bronId}
                data-target-kind={verbinding.doelType}
                data-target-id={verbinding.doelId}
                data-route-id={verbinding.routeId}
              >
                <path d={pad} className="pv-flow-lijn" markerEnd={`url(#flow-pijl-${proces.id})`} />
                {verbinding.label && (
                  <text
                    x={labelX}
                    y={labelY}
                    textAnchor={aangrenzendVooruit ? 'start' : zijde > 0 ? 'start' : 'end'}
                    className="pv-flow-label"
                  >
                    {verbinding.label}
                  </text>
                )}
              </g>
            )
          })
        })}
        {explicieteDoelen.length > 0 && (
          <g className="pv-expliciete-doelen">
            <text x="32" y={nodesHeight + 24} className="pv-doelen-titel">
              Expliciete externe of nog ongeldige doelen
            </text>
            {explicieteDoelen.map((verbinding, index) => {
              const bron = proces.stappen.find((stap) => stap.id === verbinding.bronId)
              const soort = verbinding.doelType === 'proces' ? 'Proces' : 'Onbekende stap'
              return (
                <text
                  key={`${verbinding.bronId}-${verbinding.doelType}-${verbinding.doelId}-${verbinding.routeId ?? index}`}
                  x="32"
                  y={nodesHeight + 48 + index * 24}
                  className={verbinding.doelBestaat ? 'pv-doelregel' : 'pv-doelregel pv-doel-ongeldig'}
                  data-source-step={verbinding.bronId}
                  data-target-kind={verbinding.doelType}
                  data-target-id={verbinding.doelId}
                  data-route-id={verbinding.routeId}
                >
                  {`${bron?.nummer ?? verbinding.bronId} — ${verbinding.label ? `${verbinding.label}: ` : ''}${soort} ${verbinding.doelId}`}
                </text>
              )
            })}
          </g>
        )}
        {stappen.map((stap) => {
          const p = posities.get(stap.id)!
          const beslissing = stap.type === 'beslissing'
          const terminal = stap.type === 'start' || stap.type === 'eind'
          return (
            <g
              key={stap.id}
              className="pv-svg-stap"
              role="button"
              tabIndex={0}
              aria-label={`Stap ${stap.nummer}: ${stap.activiteit}`}
              opacity={highlightLane && stap.laneId !== highlightLane ? 0.2 : 1}
              onClick={() => onSelect(stap)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onSelect(stap)
                }
              }}
            >
              {beslissing ? (
                <path d={`M ${p.x} ${p.y - 42} L ${p.x + 95} ${p.y} L ${p.x} ${p.y + 42} L ${p.x - 95} ${p.y} Z`} className="pv-flow-node pv-flow-beslissing" />
              ) : (
                <rect x={p.x - 135} y={p.y - 34} width="270" height="68" rx={terminal ? 34 : 9} className="pv-flow-node" />
              )}
              <text x={p.x} y={p.y - 7} textAnchor="middle" className="pv-flow-nr">{stap.nummer} · {laneNaam(proces, stap.laneId)}</text>
              <SvgTekst x={p.x} y={p.y + 10} tekst={stap.activiteit} maxTekens={38} anchor="middle" className="pv-flow-tekst" />
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function Bpmn({
  proces,
  onSelect,
  highlightLane,
  zoom,
}: {
  proces: Process
  onSelect: (step: Step) => void
  highlightLane?: string
  zoom: number
}) {
  const pan = useSleepPan()
  const stappen = useMemo(() => ordenStappenVoorDiagram(proces), [proces])
  const verbindingen = useMemo(() => bepaalExplicieteProcesverbindingen(proces), [proces])
  const interneVerbindingen = verbindingen.filter(
    (verbinding) => verbinding.doelType === 'stap' && verbinding.doelBestaat,
  )
  const explicieteDoelen = verbindingen.filter(
    (verbinding) => verbinding.doelType === 'proces' || !verbinding.doelBestaat,
  )
  const laneHoogte = 126
  const stapBreedte = 178
  const links = 155
  const width = Math.max(960, links + stappen.length * stapBreedte + 90)
  const poolOnderkant = 52 + Math.max(1, proces.lanes.length) * laneHoogte
  const height = poolOnderkant + 20 + (explicieteDoelen.length > 0 ? 38 + explicieteDoelen.length * 24 : 0)
  const laneIndex = new Map(proces.lanes.map((lane, index) => [lane.id, index]))
  const posities = new Map(stappen.map((stap, index) => [
    stap.id,
    {
      x: links + 90 + index * stapBreedte,
      y: 62 + (laneIndex.get(stap.laneId) ?? 0) * laneHoogte + laneHoogte / 2,
    },
  ]))
  const stapOpId = new Map(stappen.map((stap) => [stap.id, stap]))
  const stapIndex = new Map(stappen.map((stap, index) => [stap.id, index]))

  return (
    <div
      className="pv-scroll pv-scroll-verticaal"
      role="region"
      aria-label={`Scrollbare BPMN-weergave van ${proces.detailproces}`}
      tabIndex={0}
      data-pv-zoomgebied
      {...pan}
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width * zoom}
        height={height * zoom}
        role="img"
        aria-label={`BPMN-weergave van ${proces.detailproces}`}
      >
        <defs>
          <marker id={`bpmn-pijl-${proces.id}`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill="#455164" />
          </marker>
        </defs>
        <text x="24" y="34" className="pv-diagram-titel">{proces.detailproces} — BPMN</text>
        <rect x="18" y="52" width={width - 36} height={Math.max(1, proces.lanes.length) * laneHoogte} className="pv-bpmn-pool" />
        {proces.lanes.map((lane, index) => {
          const y = 52 + index * laneHoogte
          return (
            <g key={lane.id}>
              <line x1="18" x2={width - 18} y1={y} y2={y} className="pv-bpmn-lane" />
              <SvgTekst x={87} y={y + laneHoogte / 2} tekst={lane.naam} maxTekens={20} anchor="middle" className="pv-bpmn-lane-naam" />
              <line x1={links} x2={links} y1={y} y2={y + laneHoogte} className="pv-bpmn-lane" />
            </g>
          )
        })}
        {interneVerbindingen.map((verbinding) => {
          const bron = posities.get(verbinding.bronId)
          const doel = posities.get(verbinding.doelId)
          if (!bron || !doel) return null
          const bronStap = stapOpId.get(verbinding.bronId)
          const doelStap = stapOpId.get(verbinding.doelId)
          if (!bronStap || !doelStap) return null
          const uitgaand = interneVerbindingen.filter((item) => item.bronId === verbinding.bronId)
          const routeIndex = uitgaand.indexOf(verbinding)
          const offset = uitgaand.length > 1
            ? (routeIndex - (uitgaand.length - 1) / 2) * 20
            : 0
          const richting = Math.sign(doel.x - bron.x)
          const bronY = bron.y + offset
          const doelY = doel.y + offset
          const afmetingen = (stap: Step) => {
            if (stap.type === 'start' || stap.type === 'eind') return { breedte: 27, hoogte: 27 }
            if (stap.type === 'beslissing') return { breedte: 34, hoogte: 34 }
            return { breedte: 66, hoogte: 34 }
          }
          const bronMaat = afmetingen(bronStap)
          const doelMaat = afmetingen(doelStap)
          const bronX = bron.x + (richting >= 0 ? bronMaat.breedte : -bronMaat.breedte)
          const doelX = doel.x + (richting >= 0 ? -doelMaat.breedte : doelMaat.breedte)
          const middenX = (bronX + doelX) / 2
          const bronVolgorde = stapIndex.get(verbinding.bronId) ?? 0
          const doelVolgorde = stapIndex.get(verbinding.doelId) ?? 0
          const isSprong = Math.abs(doelVolgorde - bronVolgorde) > 1
          const routeBandY = Math.max(
            58,
            Math.min(bron.y - bronMaat.hoogte, doel.y - doelMaat.hoogte) - 18 - routeIndex * 4,
          )
          const pad = richting === 0
            ? `M ${bron.x + bronMaat.breedte} ${bronY} H ${bron.x + bronMaat.breedte + 60 + routeIndex * 24} V ${bron.y + bronMaat.hoogte + 32 + routeIndex * 18} H ${bron.x} V ${bron.y + bronMaat.hoogte}`
            : isSprong
              ? `M ${bron.x} ${bron.y - bronMaat.hoogte} V ${routeBandY} H ${doel.x} V ${doel.y - doelMaat.hoogte}`
            : `M ${bronX} ${bronY} H ${middenX} V ${doelY} H ${doelX}`
          const labelX = isSprong ? (bron.x + doel.x) / 2 : middenX + 5
          const labelY = isSprong ? routeBandY - 5 : (bronY + doelY) / 2 - 5
          return (
            <g
              key={`${verbinding.bronId}-${verbinding.doelId}-${verbinding.routeId ?? routeIndex}`}
              className="pv-expliciete-verbinding"
              data-source-step={verbinding.bronId}
              data-target-kind={verbinding.doelType}
              data-target-id={verbinding.doelId}
              data-route-id={verbinding.routeId}
            >
              <path
                d={pad}
                className="pv-bpmn-flow"
                markerEnd={`url(#bpmn-pijl-${proces.id})`}
              />
              {verbinding.label && (
                <text
                  x={labelX}
                  y={labelY}
                  className="pv-bpmn-label"
                >
                  {verbinding.label}
                </text>
              )}
            </g>
          )
        })}
        {explicieteDoelen.length > 0 && (
          <g className="pv-expliciete-doelen">
            <text x="24" y={poolOnderkant + 35} className="pv-doelen-titel">
              Expliciete externe of nog ongeldige doelen
            </text>
            {explicieteDoelen.map((verbinding, index) => {
              const bron = proces.stappen.find((stap) => stap.id === verbinding.bronId)
              const soort = verbinding.doelType === 'proces' ? 'Proces' : 'Onbekende stap'
              return (
                <text
                  key={`${verbinding.bronId}-${verbinding.doelType}-${verbinding.doelId}-${verbinding.routeId ?? index}`}
                  x="24"
                  y={poolOnderkant + 59 + index * 24}
                  className={verbinding.doelBestaat ? 'pv-doelregel' : 'pv-doelregel pv-doel-ongeldig'}
                  data-source-step={verbinding.bronId}
                  data-target-kind={verbinding.doelType}
                  data-target-id={verbinding.doelId}
                  data-route-id={verbinding.routeId}
                >
                  {`${bron?.nummer ?? verbinding.bronId} — ${verbinding.label ? `${verbinding.label}: ` : ''}${soort} ${verbinding.doelId}`}
                </text>
              )
            })}
          </g>
        )}
        {stappen.map((stap) => {
          const p = posities.get(stap.id)!
          const startOfEind = stap.type === 'start' || stap.type === 'eind'
          const beslissing = stap.type === 'beslissing'
          return (
            <g
              key={stap.id}
              className="pv-svg-stap"
              role="button"
              tabIndex={0}
              aria-label={`Stap ${stap.nummer}: ${stap.activiteit}`}
              opacity={highlightLane && stap.laneId !== highlightLane ? 0.2 : 1}
              onClick={() => onSelect(stap)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onSelect(stap)
                }
              }}
            >
              {startOfEind ? (
                <circle cx={p.x} cy={p.y} r="27" className={stap.type === 'eind' ? 'pv-bpmn-event pv-bpmn-eind' : 'pv-bpmn-event'} />
              ) : beslissing ? (
                <>
                  <path d={`M ${p.x} ${p.y - 34} L ${p.x + 34} ${p.y} L ${p.x} ${p.y + 34} L ${p.x - 34} ${p.y} Z`} className="pv-bpmn-gateway" />
                  <text x={p.x} y={p.y + 7} textAnchor="middle" className="pv-bpmn-x">×</text>
                </>
              ) : (
                <rect x={p.x - 66} y={p.y - 34} width="132" height="68" rx="10" className={stap.type === 'subproces' ? 'pv-bpmn-task pv-bpmn-subproces' : 'pv-bpmn-task'} />
              )}
              <text x={p.x} y={p.y - 8} textAnchor="middle" className="pv-bpmn-nr">{stap.nummer}</text>
              <SvgTekst x={p.x} y={p.y + 9} tekst={stap.activiteit} maxTekens={20} anchor="middle" className="pv-bpmn-tekst" regelHoogte={12} />
              {stap.type === 'subproces' && <text x={p.x} y={p.y + 30} textAnchor="middle" className="pv-bpmn-plus">⊞</text>}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function uniek(waarden: Array<string | undefined>, maximum: number): string[] {
  return [...new Set(waarden.filter((waarde): waarde is string => Boolean(waarde?.trim())))]
    .slice(0, maximum)
}

function Sipoc({ proces, zoom }: { proces: Process; zoom: number }) {
  const pan = useSleepPan()
  const stappen = useMemo(() => stappenInVolgorde(proces), [proces])
  const eerste = stappen.slice(0, 3)
  const laatste = stappen.slice(-3)
  const suppliers = uniek(
    [
      ...eerste.map((stap) => laneNaam(proces, stap.laneId)),
      proces.bron?.bestand ? `Bron: ${proces.bron.bestand}` : undefined,
    ],
    5,
  )
  const inputs = uniek(
    eerste.flatMap((stap) => [
      stap.activiteit,
      ...(stap.checklist ?? []),
      stap.voorwaarde ? `Voorwaarde: ${stap.voorwaarde}` : undefined,
    ]),
    6,
  )
  const kern = stappen.filter((stap) => !['start', 'eind', 'marker'].includes(stap.type)).slice(0, 7)
  const outputs = uniek(
    laatste.flatMap((stap) => [
      stap.activiteit,
      stap.erpStatus ? `ERP-status: ${stap.erpStatus}` : undefined,
      stap.naarProces ? `Vervolg: ${stap.naarProces}` : undefined,
    ]),
    6,
  )
  const customers = uniek(
    [
      ...stappen.filter((stap) => stap.doelLaneId).map((stap) => laneNaam(proces, stap.doelLaneId!)),
      ...laatste.map((stap) => laneNaam(proces, stap.laneId)),
    ],
    5,
  )

  const kolommen = [
    { letter: 'S', titel: 'Suppliers', items: suppliers },
    { letter: 'I', titel: 'Inputs', items: inputs },
    { letter: 'P', titel: 'Process', items: kern.map((stap) => `${stap.nummer}. ${stap.activiteit}`) },
    { letter: 'O', titel: 'Outputs', items: outputs },
    { letter: 'C', titel: 'Customers', items: customers },
  ]

  return (
    <div
      className="pv-scroll pv-sipoc-scroll"
      role="region"
      aria-label={`Zoom- en scrollbare SIPOC van ${proces.detailproces}`}
      tabIndex={0}
      data-pv-zoomgebied
      {...pan}
      data-pv-natuurlijke-breedte="960"
    >
      <div className="pv-sipoc-schaal" style={{ zoom }}>
        <div className="pv-sipoc-paneel">
          <header>
            <div>
              <span className="pv-kicker">Afgeleid uit de procesbron</span>
              <h2>{proces.detailproces} — SIPOC</h2>
            </div>
            <span className="pv-versie">{proces.versie}</span>
          </header>
          <div className="pv-sipoc-grid">
            {kolommen.map((kolom) => (
              <section key={kolom.letter} className={`pv-sipoc-kolom pv-sipoc-${kolom.letter.toLowerCase()}`}>
                <h3><span>{kolom.letter}</span>{kolom.titel}</h3>
                {kolom.items.length > 0 ? (
                  <ol>{kolom.items.map((item) => <li key={item}>{item}</li>)}</ol>
                ) : (
                  <p className="pv-onbekend">Nog vast te leggen</p>
                )}
              </section>
            ))}
          </div>
          <p className="pv-uitleg">
            Deze SIPOC is automatisch afgeleid. Laat supplier-, input-, output- en customergegevens door de proceseigenaar bevestigen.
          </p>
        </div>
      </div>
    </div>
  )
}

function ValueStream({
  proces,
  onSelect,
  highlightLane,
  zoom,
}: {
  proces: Process
  onSelect: (step: Step) => void
  highlightLane?: string
  zoom: number
}) {
  const pan = useSleepPan()
  const stappen = useMemo(() => stappenInVolgorde(proces), [proces])
  const kaartBreedte = 210
  const gap = 46
  const links = 50
  const width = Math.max(960, links * 2 + stappen.length * (kaartBreedte + gap))
  const height = 380
  let wissels = 0
  stappen.forEach((stap, index) => {
    if (index > 0 && stappen[index - 1].laneId !== stap.laneId) wissels += 1
  })

  return (
    <div
      className="pv-scroll"
      role="region"
      aria-label={`Zoom- en scrollbare value-stream van ${proces.detailproces}`}
      tabIndex={0}
      data-pv-zoomgebied
      {...pan}
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width * zoom}
        height={height * zoom}
        role="img"
        aria-label={`Value-stream van ${proces.detailproces}`}
      >
        <defs>
          <marker id={`vs-pijl-${proces.id}`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill="#ea5b0c" />
          </marker>
        </defs>
        <text x={links} y="34" className="pv-diagram-titel">{proces.detailproces} — value-stream / tijdlijn</text>
        <text x={width - links} y="34" textAnchor="end" className="pv-vs-samenvatting">
          {stappen.length} stappen · {wissels} overdrachten
        </text>
        <line x1={links} x2={width - links} y1="195" y2="195" className="pv-vs-as" />
        {stappen.map((stap, index) => {
          const x = links + index * (kaartBreedte + gap)
          const boven = index % 2 === 0
          const y = boven ? 72 : 222
          const previous = stappen[index - 1]
          const handoff = previous && previous.laneId !== stap.laneId
          return (
          <g
            key={stap.id}
            className="pv-svg-stap"
            role="button"
            tabIndex={0}
            aria-label={`Stap ${stap.nummer}: ${stap.activiteit}`}
            opacity={highlightLane && stap.laneId !== highlightLane ? 0.2 : 1}
            onClick={() => onSelect(stap)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onSelect(stap)
              }
            }}
          >
              {index < stappen.length - 1 && (
                <line
                  x1={x + kaartBreedte}
                  x2={x + kaartBreedte + gap - 8}
                  y1="195"
                  y2="195"
                  className={handoff ? 'pv-vs-overdracht' : 'pv-vs-verbinding'}
                  markerEnd={`url(#vs-pijl-${proces.id})`}
                />
              )}
              <circle cx={x + kaartBreedte / 2} cy="195" r="7" className={handoff ? 'pv-vs-punt pv-vs-handoff' : 'pv-vs-punt'} />
              <line
                x1={x + kaartBreedte / 2}
                x2={x + kaartBreedte / 2}
                y1={boven ? y + 108 : 202}
                y2={boven ? 188 : y}
                className="pv-vs-leider"
              />
              <rect x={x} y={y} width={kaartBreedte} height="108" rx="9" className="pv-vs-kaart" />
              <text x={x + 12} y={y + 20} className="pv-vs-nr">{stap.nummer}</text>
              <text x={x + kaartBreedte - 12} y={y + 20} textAnchor="end" className="pv-vs-rol">{laneNaam(proces, stap.laneId)}</text>
              <SvgTekst x={x + 12} y={y + 43} tekst={stap.activiteit} maxTekens={29} className="pv-vs-tekst" regelHoogte={14} />
              <text x={x + 12} y={y + 94} className="pv-vs-tijd">
                {stap.termijn ? `Termijn: ${stap.termijn}` : 'Tijd: nog te meten'}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
