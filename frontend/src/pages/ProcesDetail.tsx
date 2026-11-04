import { useCallback, useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { dataSource } from '../data'
import { useHasRole } from '../appState'
import type { Process, Step, SuggestionType, Version } from '../contract'
import type { DiffReport } from '@contract/model'
import { TabelView } from '../components/TabelView'
import { typeLabel, laneNaam, laneKleur } from '../lib/proces'
import { usePunten } from '../store/punten'
import {
  ProcessVisualisatie,
  type ProcessVisualisatieModus,
} from '../visualisaties'

const suggestieTypen: Array<{ id: SuggestionType; label: string }> = [
  { id: 'klopt-niet', label: 'Dit klopt niet' },
  { id: 'mist', label: 'Er mist iets' },
  { id: 'onduidelijk', label: 'Dit kan duidelijker' },
  { id: 'werkt-anders', label: 'Werkt in praktijk anders' },
]

function SuggestieVak({ proces, step }: { proces: Process; step: Step }) {
  const magSuggereren = useHasRole('suggesties')
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<SuggestionType>('klopt-niet')
  const [tekst, setTekst] = useState('')
  const [verzonden, setVerzonden] = useState(false)
  const [fout, setFout] = useState('')

  if (!magSuggereren) return null

  if (!open)
    return (
      <button className="btn-tekst suggestie-open" onClick={() => { setOpen(true); setVerzonden(false) }}>
        💬 Suggestie bij deze stap
      </button>
    )

  const verstuur = async () => {
    setFout('')
    try {
      await dataSource.postSuggestion(proces.id, step.id, type, tekst.trim())
      usePunten.getState().kenToe('suggestie')
      setTekst('')
      setVerzonden(true)
    } catch (e) {
      setFout(e instanceof Error ? e.message : 'Versturen mislukt.')
    }
  }

  return (
    <div className="suggestie-vak">
      {verzonden ? (
        <p className="muted">✓ Bedankt — je suggestie gaat naar de procesbeheerder.</p>
      ) : (
        <>
          <select value={type} onChange={(e) => setType(e.target.value as SuggestionType)}>
            {suggestieTypen.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          <textarea
            rows={3}
            placeholder="Wat moet er anders?"
            value={tekst}
            onChange={(e) => setTekst(e.target.value)}
          />
          {fout && <p className="login-fout">{fout}</p>}
          <div className="bm-acties">
            <button className="btn-primair" disabled={!tekst.trim()} onClick={() => void verstuur()}>
              Versturen
            </button>
            <button className="btn-tekst" onClick={() => setOpen(false)}>
              Annuleren
            </button>
          </div>
        </>
      )}
    </div>
  )
}

/** Workflow-acties + versiehistorie met diff (M5). */
function WorkflowBalk({ proces, onGewijzigd }: { proces: Process; onGewijzigd: () => void }) {
  const magBewerken = useHasRole('bewerken')
  const magGoedkeuren = useHasRole('goedkeuren')
  const [versies, setVersies] = useState<Version[] | null>(null)
  const [toonVersies, setToonVersies] = useState(false)
  const [diff, setDiff] = useState<DiffReport | null>(null)
  const [melding, setMelding] = useState('')
  const [workflowBezig, setWorkflowBezig] = useState(false)

  const actie = async (fn: () => Promise<Version>, tekst: string) => {
    if (workflowBezig) return
    setWorkflowBezig(true)
    setMelding('')
    try {
      await fn()
      setMelding(tekst)
      setVersies(null)
      setToonVersies(false)
      setDiff(null)
      onGewijzigd()
    } catch (e) {
      setMelding(e instanceof Error ? e.message : 'Actie mislukt.')
    } finally {
      setWorkflowBezig(false)
    }
  }

  const laadVersies = async () => {
    try {
      if (!toonVersies) setVersies(await dataSource.getVersions(proces.id))
      setToonVersies(!toonVersies)
      setDiff(null)
    } catch (error) { setMelding(error instanceof Error ? error.message : 'De versiehistorie kon niet worden geladen.') }
  }

  const laadDiff = async (van: number, naar: number) => {
    try { setDiff(await dataSource.getDiff(proces.id, van, naar)) }
    catch (error) { setMelding(error instanceof Error ? error.message : 'De vergelijking kon niet worden geladen.') }
  }

  return (
    <div className="wf-balk">
      <div className="bm-acties">
        {proces.status === 'concept' && magBewerken && (
          <button
            className="btn-secundair"
            disabled={workflowBezig}
            onClick={() => void actie(() => dataSource.submitProcess(proces.id, proces.revision), 'Ingediend ter goedkeuring.')}
          >
            📤 Indienen ter goedkeuring
          </button>
        )}
        {proces.status === 'in-review' && magGoedkeuren && (
          <>
            <button
              className="btn-primair"
              disabled={workflowBezig}
              onClick={() => void actie(() => dataSource.approveProcess(proces.id, proces.revision), 'Goedgekeurd en live gezet.')}
            >
              ✅ Goedkeuren & live zetten
            </button>
            <button
              className="btn-secundair"
              disabled={workflowBezig}
              onClick={() => {
                const reden = window.prompt('Reden voor afwijzing (optioneel):')
                if (reden === null) return
                void actie(() => dataSource.rejectProcess(proces.id, proces.revision, reden), 'Afgewezen; terug naar concept.')
              }}
            >
              ❌ Afwijzen
            </button>
          </>
        )}
        <button className="btn-tekst" onClick={() => void laadVersies()}>
          🕘 Versies {toonVersies ? '▲' : '▼'}
        </button>
        <button
          className="btn-tekst"
          title="Proces exporteren als JSON"
          onClick={() => {
            const blob = new Blob([JSON.stringify(proces, null, 2)], { type: 'application/json' })
            const a = document.createElement('a')
            a.href = URL.createObjectURL(blob)
            a.download = `${proces.id}.json`
            a.click()
            URL.revokeObjectURL(a.href)
          }}
        >
          ⬇️ JSON
        </button>
        {melding && <span className="muted">{melding}</span>}
      </div>

      {toonVersies && (
        <div className="wf-versies">
          {!versies || versies.length === 0 ? (
            <p className="muted">Geen versiehistorie beschikbaar.</p>
          ) : (
            <table className="werkinstructie">
              <thead>
                <tr>
                  <th>Versie</th>
                  <th>Status</th>
                  <th>Door</th>
                  <th>Wanneer</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {versies.map((v, i) => (
                  <tr key={v.versieNr}>
                    <td className="stap-nr">#{v.versieNr}</td>
                    <td>
                      <span className={`pill pill-${v.status}`}>{v.status}</span>
                    </td>
                    <td>{v.gewijzigdDoor}</td>
                    <td>{new Date(v.gewijzigdOp).toLocaleString('nl-NL')}</td>
                    <td>
                      {i < versies.length - 1 && (
                        <button
                          className="btn-tekst"
                          onClick={() => void laadDiff(versies[i + 1].versieNr, v.versieNr)}
                        >
                          vergelijk met vorige
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {diff && (
            <div className="wf-diff">
              <h3>
                Verschil #{diff.van} → #{diff.naar}
              </h3>
              {diff.wijzigingen.length === 0 ? (
                <p className="muted">Geen verschillen gevonden.</p>
              ) : (
                <ul className="gezond-lijst">
                  {diff.wijzigingen.map((w, n) => (
                    <li key={n} className={w.soort === 'verwijderd' ? 'gi-fout' : w.soort === 'toegevoegd' ? 'gi-info' : 'gi-waarschuwing'}>
                      <strong>{w.soort}</strong>
                      {w.stapId ? ` · stap ${w.stapId}` : ''}
                      {w.veld ? ` · ${w.veld}` : ''}
                      {w.oud !== undefined || w.nieuw !== undefined
                        ? `: ${JSON.stringify(w.oud ?? '∅')} → ${JSON.stringify(w.nieuw ?? '∅')}`
                        : ''}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function StepPanel({
  proces,
  step,
  onClose,
  suggestiesToestaan = true,
}: {
  proces: Process
  step: Step
  onClose: () => void
  suggestiesToestaan?: boolean
}) {
  return (
    <aside className="step-panel">
      <div className="panel-head">
        <span className="sl-nr" style={{ background: laneKleur(proces, step.laneId) }}>
          {step.nummer}
        </span>
        <strong>{typeLabel[step.type]}</strong>
        <button className="panel-close" onClick={onClose} aria-label="Sluiten">
          ×
        </button>
      </div>
      <dl className="panel-dl">
        <dt>Verantwoordelijke</dt>
        <dd>{laneNaam(proces, step.laneId)}</dd>
        <dt>Activiteit</dt>
        <dd>{step.activiteit}</dd>
        {step.doelLaneId && (
          <>
            <dt>Bericht naar</dt>
            <dd>{laneNaam(proces, step.doelLaneId)}</dd>
          </>
        )}
        {step.voorwaarde && (
          <>
            <dt>Voorwaarde</dt>
            <dd>Indien {step.voorwaarde}</dd>
          </>
        )}
        {step.toelichting && (
          <>
            <dt>Toelichting</dt>
            <dd>{step.toelichting}</dd>
          </>
        )}
        {step.opmerking && (
          <>
            <dt>Opmerking</dt>
            <dd>{step.opmerking}</dd>
          </>
        )}
        {step.zijnotitie && (
          <>
            <dt>Status / notitie</dt>
            <dd>{step.zijnotitie}</dd>
          </>
        )}
        {step.naarProces && (
          <>
            <dt>Vervolgproces</dt>
            <dd>
              <Link to={`/proces/${step.naarProces}`}>→ {step.naarProces}</Link>
            </dd>
          </>
        )}
      </dl>
      <div className="panel-voet">
        {suggestiesToestaan && <SuggestieVak proces={proces} step={step} />}
      </div>
    </aside>
  )
}

export function ProcesDetail() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const [proces, setProces] = useState<Process | null | undefined>(undefined)
  const [view, setView] = useState<'visualisatie' | 'tabel'>('visualisatie')
  const [visualisatie, setVisualisatie] = useState<ProcessVisualisatieModus>(() => {
    const bewaard = localStorage.getItem('spg-procesvisualisatie')
    return (
      ['brongetrouw', 'interactief', 'flowchart', 'bpmn', 'sipoc', 'value-stream'] as const
    ).includes(bewaard as ProcessVisualisatieModus)
      ? (bewaard as ProcessVisualisatieModus)
      : 'brongetrouw'
  })
  const [selected, setSelected] = useState<Step | null>(null)
  const [rol, setRol] = useState<string>('')
  const magBewerken = useHasRole('bewerken')
  const magGoedkeuren = useHasRole('goedkeuren')
  const magBeheren = useHasRole('beheren')
  const magWerkversie = magBewerken || magGoedkeuren || magBeheren
  const workspace = searchParams.get('workspace') === '1' && magWerkversie

  const laadProces = useCallback(
    (procesId: string) =>
      workspace ? dataSource.getWorkspaceProcess(procesId) : dataSource.getProcess(procesId),
    [workspace],
  )

  const herlaad = () => {
    if (id) void laadProces(id).then(setProces)
  }

  const kenToe = usePunten((s) => s.kenToe)

  useEffect(() => {
    if (id)
      void laadProces(id).then((p) => {
        setProces(p)
        setSelected(null)
        setRol('')
        if (p) {
          kenToe('proces-bekeken', p.id)
          // Houd de 5 laatst bekeken processen bij voor het overzicht.
          const recent = JSON.parse(localStorage.getItem('spg-recent') ?? '[]') as string[]
          localStorage.setItem(
            'spg-recent',
            JSON.stringify([p.id, ...recent.filter((x) => x !== p.id)].slice(0, 5)),
          )
        }
      })
  }, [id, kenToe, laadProces])

  if (proces === undefined) return <p className="muted">Laden…</p>

  if (proces === null) {
    return (
      <div>
        <p>
          <Link to="/">← Overzicht</Link>
        </p>
        <div className="empty">
          Dit proces is nog niet ingevoerd. Voer het in via de{' '}
          <Link to={`/bouwer/${id}`}>procesbouwer</Link> of importeer het later vanuit PDF.
        </div>
      </div>
    )
  }

  return (
    <div className="proces-page">
      <p>
        <Link to="/">← Overzicht</Link>
      </p>
      <header className="proces-head">
        <span className="kicker">{proces.hoofdproces}</span>
        <div className="proces-title-row">
          <h1>{proces.detailproces}</h1>
          <div className="detail-tools">
            {magWerkversie && !workspace && (
              <Link className="btn-secundair" to={`/proces/${proces.id}?workspace=1`}>
                🧰 Werkversie
              </Link>
            )}
            {workspace && (
              <Link className="btn-secundair" to={`/proces/${proces.id}`}>
                👁️ Gepubliceerde versie
              </Link>
            )}
            {(magBewerken || magBeheren) && (
              <Link className="btn-secundair" to={`/bouwer/${proces.id}`}>
                ✏️ Bewerken
              </Link>
            )}
            <select
              className="rol-filter"
              value={rol}
              onChange={(e) => setRol(e.target.value)}
              title="Mijn rol: licht alleen jouw stappen op"
            >
              <option value="">👤 Alle rollen</option>
              {proces.lanes.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.naam}
                </option>
              ))}
            </select>
            <button
              className="btn-secundair"
              title="Print of bewaar de huidige weergave als PDF"
              onClick={() => window.print()}
            >
              🖨️ Huidige weergave
            </button>
            <div className="view-toggle">
              <button
                className={view === 'visualisatie' ? 'active' : ''}
                onClick={() => setView('visualisatie')}
              >
                🗺️ Visualisatie
              </button>
              <button className={view === 'tabel' ? 'active' : ''} onClick={() => setView('tabel')}>
                📋 Tabel
              </button>
            </div>
          </div>
        </div>
        {workspace && <WorkflowBalk proces={proces} onGewijzigd={herlaad} />}
        {workspace && (
          <p className="muted">
            🧰 Je bekijkt de werkversie. Medewerkers blijven de laatst goedgekeurde publicatie zien.
          </p>
        )}
        <div className="card-meta">
          <span>{proces.versie}</span>
          <span className={`pill pill-${proces.status}`}>{proces.status}</span>
          <span>Laatste wijziging: {proces.laatsteWijziging}</span>
        </div>
      </header>

      {(magBewerken || magBeheren) && (
        <nav className="proces-uitwisseling-compact" aria-label="Proces importeren of exporteren">
          <span className="muted">⇄ Bestandsuitwisseling</span>
          <Link
            className="btn-secundair"
            to={`/uitwisseling?processId=${encodeURIComponent(proces.id)}&actie=importeren&formaat=drawio-xml`}
          >
            Importeren
          </Link>
          <Link
            className="btn-secundair"
            to={`/uitwisseling?processId=${encodeURIComponent(proces.id)}&actie=exporteren&formaat=drawio-xml`}
          >
            Exporteren
          </Link>
        </nav>
      )}

      <div className="proces-body">
        <div className="proces-main">
          {view === 'visualisatie' ? (
            <ProcessVisualisatie
              proces={proces}
              modus={visualisatie}
              onModusWijziging={(modus) => {
                setVisualisatie(modus)
                localStorage.setItem('spg-procesvisualisatie', modus)
              }}
              onSelectStep={setSelected}
              highlightLane={rol || undefined}
            />
          ) : (
            <TabelView proces={proces} onSelect={setSelected} highlightLane={rol || undefined} />
          )}
        </div>
        {selected && (
          <StepPanel
            proces={proces}
            step={selected}
            onClose={() => setSelected(null)}
            suggestiesToestaan={!workspace}
          />
        )}
      </div>

      <p className="muted">
        Alle zes visualisaties en de tabel komen uit hetzelfde datamodel; klik een stap voor de
        werkinstructie.
      </p>
    </div>
  )
}
