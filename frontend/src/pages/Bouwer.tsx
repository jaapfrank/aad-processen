import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { dataSource } from '../data'
import { controleerGezondheid } from '../lib/gezondheid'
import type { Lane, Process, ProcessSummary, Section, Step, StepType } from '../contract'
import type { ProcessMaintenanceAnalysis } from '@contract/ai-process-steward'
import type { ProcessMaintenanceRunLedgerItem } from '@contract/ai-run-history'
import { TabelView } from '../components/TabelView'
import { typeLabel } from '../lib/proces'
import {
  controleerProcesTegenKader,
  PROCES_KADERS,
  type ProcesKaderId,
} from '../lib/procesKaders'
import { usePunten } from '../store/punten'
import { useHasRole } from '../appState'
import {
  controleerBrongetrouweLayout,
  ProcessVisualisatie,
  type ProcessVisualisatieModus,
} from '../visualisaties'
import {
  changeStepTypeSafely,
  deleteStepSafely,
  ProcessDiagramEditor,
  validateEditorProcessStructure,
  type AiProcessStewardController,
  type AiProcessStewardPhase,
  type ProcessMaintenanceRunHistoryController,
  type ProcessEditorIssue,
} from '../editor'
import {
  applyProcessMaintenanceAnalysis,
  isProcessMaintenanceAnalysisStale,
  processMaintenanceSemanticFingerprint,
} from '../lib/aiProcessSteward'

// Procesbouwer: nieuwe kaarten maken of bestaande bewerken. Eén formulier-
// gedreven editor met live previews (plaat + tabel) uit hetzelfde model en
// directe procesgezondheid-feedback.

const stapTypen: StepType[] = ['actie', 'bericht', 'beslissing', 'subproces', 'start', 'eind', 'marker']

type FormulierDropDoel =
  | { type: 'stap'; stapId: string; sectieId: string; positie: 'voor' | 'na' }
  | { type: 'einde'; sectieId: string }

const standaardLanes: Lane[] = [{ id: 'uitvoerder', naam: 'Uitvoerder', kleur: '#3B82F6' }]

function leegProces(): Process {
  return {
    id: '',
    hoofdproces: '',
    detailproces: '',
    versie: 'V1.0',
    status: 'concept',
    laatsteWijziging: new Date().toISOString().slice(0, 10),
    bron: { type: 'handmatig' },
    lanes: structuredClone(standaardLanes),
    secties: [{ id: 'hoofd', naam: 'Hoofdflow' }],
    stappen: [],
  }
}

function slug(tekst: string) {
  return tekst
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function StapEditor({
  proces,
  stap,
  onChange,
  onTypeChange,
  onVerwijder,
  onSchuif,
  onPakOp,
  onSleepBeweeg,
  onLaatLos,
  onVerplaatsNaarSectie,
  wordtGesleept,
  doelDropPositie,
  kanOmhoog,
  kanOmlaag,
}: {
  proces: Process
  stap: Step
  onChange: (s: Step) => void
  onTypeChange: (type: StepType) => void
  onVerwijder: () => void
  onSchuif: (richting: -1 | 1) => void
  onPakOp: (stapId: string) => void
  onSleepBeweeg: (stapId: string, clientX: number, clientY: number) => void
  onLaatLos: (
    stapId: string,
    clientX: number,
    clientY: number,
    geannuleerd?: boolean,
  ) => void
  onVerplaatsNaarSectie: (sectieId: string) => void
  wordtGesleept: boolean
  doelDropPositie?: 'voor' | 'na'
  kanOmhoog: boolean
  kanOmlaag: boolean
}) {
  const [open, setOpen] = useState(false)
  const upd = (deel: Partial<Step>) => onChange({ ...stap, ...deel })

  return (
    <div
      className={
        `be-stap${doelDropPositie ? ` drop-doel drop-${doelDropPositie}` : ''}` +
        (wordtGesleept ? ' wordt-gesleept' : '')
      }
      data-stap-id={stap.id}
      data-drop-positie={doelDropPositie}
    >
      <div
        className="be-stap-kop"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-label={`${stap.activiteit || stap.nummer || 'Stap'}. Open details.`}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
            e.preventDefault()
            setOpen(!open)
          }
        }}
        title="Klik om de stapdetails te openen"
      >
        <button
          type="button"
          className="sleep-grip"
          aria-label={`Sleep ${stap.activiteit || stap.nummer || 'stap'} naar een andere positie`}
          title="Pak op en sleep naar de bovenste of onderste helft van een andere stap"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
          onPointerDown={(event) => {
            if (event.button !== 0 || !event.isPrimary) return
            event.preventDefault()
            event.stopPropagation()
            event.currentTarget.setPointerCapture(event.pointerId)
            onPakOp(stap.id)
          }}
          onPointerMove={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
            event.preventDefault()
            onSleepBeweeg(stap.id, event.clientX, event.clientY)
          }}
          onPointerUp={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
            event.preventDefault()
            onLaatLos(stap.id, event.clientX, event.clientY)
            event.currentTarget.releasePointerCapture(event.pointerId)
          }}
          onPointerCancel={(event) => {
            onLaatLos(stap.id, event.clientX, event.clientY, true)
          }}
        >
          ⠿
        </button>
        <span className="stap-nr">{stap.nummer || '·'}</span>
        <span className="be-stap-titel">{stap.activiteit || <em className="muted">(nieuwe stap)</em>}</span>
        <span className="type-tag">{typeLabel[stap.type]}</span>
        <span className="be-stap-knoppen" onClick={(e) => e.stopPropagation()}>
          <button
            title="Omhoog"
            aria-label={`Verplaats ${stap.activiteit || stap.nummer || 'stap'} omhoog`}
            disabled={!kanOmhoog}
            onClick={() => onSchuif(-1)}
          >
            ↑
          </button>
          <button
            title="Omlaag"
            aria-label={`Verplaats ${stap.activiteit || stap.nummer || 'stap'} omlaag`}
            disabled={!kanOmlaag}
            onClick={() => onSchuif(1)}
          >
            ↓
          </button>
          <button
            title="Verwijderen"
            aria-label={`Verwijder ${stap.activiteit || stap.nummer || 'stap'}`}
            onClick={onVerwijder}
          >
            🗑
          </button>
        </span>
      </div>
      {open && (
        <div className="be-stap-form">
          <label>
            Nummer
            <input value={stap.nummer} onChange={(e) => upd({ nummer: e.target.value })} />
          </label>
          <label>
            Type
            <select value={stap.type} onChange={(e) => onTypeChange(e.target.value as StepType)}>
              {stapTypen.map((t) => (
                <option key={t} value={t}>
                  {typeLabel[t]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Verantwoordelijke (lane)
            <select value={stap.laneId} onChange={(e) => upd({ laneId: e.target.value })}>
              {proces.lanes.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.naam}
                </option>
              ))}
            </select>
          </label>
          <label>
            Sectie
            <select
              value={stap.sectieId}
              onChange={(e) => onVerplaatsNaarSectie(e.target.value)}
              aria-label={`Sectie van stap ${stap.activiteit || stap.nummer || stap.id}`}
            >
              {proces.secties.map((sectie) => (
                <option key={sectie.id} value={sectie.id}>
                  {sectie.naam}
                </option>
              ))}
            </select>
          </label>
          {stap.type === 'bericht' && (
            <label>
              Bericht naar (lane)
              <select
                value={stap.doelLaneId ?? ''}
                onChange={(e) => upd({ doelLaneId: e.target.value || undefined })}
              >
                <option value="">— kies lane —</option>
                {proces.lanes.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.naam}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="breed">
            Activiteit
            <textarea
              rows={2}
              value={stap.activiteit}
              onChange={(e) => upd({ activiteit: e.target.value })}
            />
          </label>
          <label className="breed">
            Toelichting (blauw op de plaat)
            <textarea
              rows={2}
              value={stap.toelichting ?? ''}
              onChange={(e) => upd({ toelichting: e.target.value || undefined })}
            />
          </label>
          <label className="breed">
            Opmerking (werkinstructie-tabel)
            <textarea
              rows={2}
              value={stap.opmerking ?? ''}
              onChange={(e) => upd({ opmerking: e.target.value || undefined })}
            />
          </label>
          <label>
            Zij-notitie / status
            <input
              value={stap.zijnotitie ?? ''}
              onChange={(e) => upd({ zijnotitie: e.target.value || undefined })}
            />
          </label>
          <label>
            ERP-status
            <input
              list="erp-statussen"
              value={stap.erpStatus ?? ''}
              placeholder="bv. controle"
              onChange={(e) => upd({ erpStatus: e.target.value || undefined })}
            />
          </label>
          <label>
            Voorwaarde ("Indien …")
            <input
              value={stap.voorwaarde ?? ''}
              onChange={(e) => upd({ voorwaarde: e.target.value || undefined })}
            />
          </label>
          <label>
            Waarschuwing
            <input
              value={stap.waarschuwing ?? ''}
              onChange={(e) => upd({ waarschuwing: e.target.value || undefined })}
            />
          </label>
          <label>
            Termijn
            <input
              value={stap.termijn ?? ''}
              onChange={(e) => upd({ termijn: e.target.value || undefined })}
            />
          </label>
          <label>
            Vervolgproces
            <input
              list="proces-ids"
              value={stap.naarProces ?? ''}
              placeholder="begin te typen… (bv. service-ontvangst)"
              onChange={(e) => upd({ naarProces: e.target.value || undefined })}
            />
          </label>
        </div>
      )}
    </div>
  )
}

export function Bouwer() {
  const { id } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const [zoekParameters] = useSearchParams()
  const diagramImportRef = useRef<Process | null>(
    (location.state as { diagramImportConcept?: Process } | null)?.diagramImportConcept ?? null,
  )
  const magBewerken = useHasRole('bewerken')
  const magBeheren = useHasRole('beheren')
  const magProcesWijzigen = magBewerken || magBeheren
  const [proces, setProces] = useState<Process | null>(null)
  const [summaries, setSummaries] = useState<ProcessSummary[]>([])
  const [preview, setPreview] = useState<'visualisatie' | 'tabel'>('visualisatie')
  const [visualisatie, setVisualisatie] = useState<ProcessVisualisatieModus>('brongetrouw')
  const [bouwerModus, setBouwerModus] = useState<'visueel' | 'formulieren'>('visueel')
  const [opgeslagenMomentopname, setOpgeslagenMomentopname] = useState('')
  const [melding, setMelding] = useState('')
  const [laadFout, setLaadFout] = useState('')
  const [aiFase, setAiFase] = useState<AiProcessStewardPhase>('idle')
  const [aiAnalyse, setAiAnalyse] = useState<ProcessMaintenanceAnalysis>()
  const [aiAntwoorden, setAiAntwoorden] = useState<Record<string, string>>({})
  const [aiFout, setAiFout] = useState<string>()
  const [aiBronVingerafdruk, setAiBronVingerafdruk] = useState<string>()
  const [aiHistorie, setAiHistorie] = useState<ProcessMaintenanceRunLedgerItem[]>([])
  const [aiHistorieLaden, setAiHistorieLaden] = useState(false)
  const [aiHistorieFout, setAiHistorieFout] = useState<string>()
  const [aiFeedbackRunId, setAiFeedbackRunId] = useState<string>()
  const [monitoringIssue, setMonitoringIssue] = useState<{ sleutel: string; issue?: ProcessEditorIssue }>()
  const [gesleepteStapId, setGesleepteStapId] = useState<string | null>(null)
  const [formulierDropDoel, setFormulierDropDoel] = useState<FormulierDropDoel | null>(null)
  const formulierScrollRef = useRef<HTMLDivElement>(null)
  const formulierDragScrollFrameRef = useRef<number | null>(null)

  useEffect(() => {
    void Promise.resolve().then(() => {
      setAiFase('idle')
      setAiAnalyse(undefined)
      setAiAntwoorden({})
      setAiFout(undefined)
      setAiBronVingerafdruk(undefined)
      setAiHistorie([])
      setAiHistorieLaden(false)
      setAiHistorieFout(undefined)
      setAiFeedbackRunId(undefined)
    })
  }, [id])

  useEffect(() => {
    if (!magProcesWijzigen) return
    let actief = true
    void dataSource.getWorkspaceProcesses().then((items) => { if (actief) setSummaries(items) })
      .catch(() => { if (actief) setSummaries([]) })
    const diagramImport = diagramImportRef.current
    if (diagramImport) {
      void Promise.resolve().then(() => {
        if (!actief) return
        // Pas na een actieve initialisatie consumeren: StrictMode kan het eerste effect intrekken.
        diagramImportRef.current = null
        const geladen = { ...structuredClone(diagramImport), status: 'concept' as const }
        setProces(geladen)
        setOpgeslagenMomentopname('')
        setMelding('Diagramimport geladen: ' + geladen.detailproces + ' (' + geladen.stappen.length + ' stappen). Controleer de visualisaties en gezondheid voordat je het concept opslaat.')
        navigate(location.pathname, { replace: true, state: null })
      })
      return () => { actief = false }
    }
    let voorstel: string | null = null
    try { voorstel = !id ? sessionStorage.getItem('spg-ai-voorstel') : null } catch { /* Lokale overdracht is optioneel. */ }
    if (voorstel) {
      try {
        const geladen = JSON.parse(voorstel) as Process
        void Promise.resolve().then(() => {
          if (!actief) return
          try { sessionStorage.removeItem('spg-ai-voorstel') } catch { /* Het concept blijft in de editor beschikbaar. */ }
          setProces({ ...geladen, status: 'concept' })
          setOpgeslagenMomentopname('')
          setMelding('AI-voorstel geladen: ' + geladen.detailproces + ' (' + geladen.stappen.length + ' stappen). Controleer de stappen, sla op als concept en dien daarna in ter goedkeuring.')
        })
        return () => { actief = false }
      } catch { /* Onleesbaar voorstel: begin met een leeg proces. */ }
    }
    void Promise.resolve(id ? dataSource.getWorkspaceProcess(id) : null).then((opgeslagen) => {
      if (!actief) return
      if (id && !opgeslagen) { setLaadFout('Dit proces is niet gevonden. Open een bestaande werkversie vanuit Processen.'); return }
      setLaadFout('')
      const geladen = opgeslagen ? structuredClone(opgeslagen) : { ...leegProces(), ...(id ? { id } : {}) }
      setProces(geladen)
      setOpgeslagenMomentopname(opgeslagen ? JSON.stringify(geladen) : '')
    }).catch((error: unknown) => { if (actief) setLaadFout(error instanceof Error ? error.message : 'Het proces kon niet worden geladen.') })
    return () => { actief = false }
  }, [id, location.pathname, magProcesWijzigen, navigate])

  const heeftNietOpgeslagenWijzigingen =
    Boolean(proces) && JSON.stringify(proces) !== opgeslagenMomentopname

  useEffect(() => {
    if (!heeftNietOpgeslagenWijzigingen) return
    const waarschuw = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', waarschuw)
    return () => window.removeEventListener('beforeunload', waarschuw)
  }, [heeftNietOpgeslagenWijzigingen])

  useEffect(() => () => {
    if (formulierDragScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(formulierDragScrollFrameRef.current)
    }
  }, [])

  const bekend = useMemo(
    () => new Set([...summaries.map((s) => s.id), ...(proces ? [proces.id] : [])]),
    [summaries, proces],
  )
  const gezondheid = useMemo(
    () => (proces ? controleerGezondheid(proces, bekend) : null),
    [proces, bekend],
  )
  const bronLayout = useMemo(
    () => (proces ? controleerBrongetrouweLayout(proces) : null),
    [proces],
  )
  const kaderParameter = zoekParameters.get('kader')
  const controleParameter = zoekParameters.get('controle')
  const bevindingParameter = zoekParameters.get('bevinding')
  const assuranceVraagParameter = zoekParameters.get('assuranceVraag')
  const focusStapParameter = zoekParameters.get('stap') ?? undefined
  const actiefKaderId = PROCES_KADERS.some((kader) => kader.id === kaderParameter)
    ? kaderParameter as ProcesKaderId
    : undefined
  const kaderIssues = useMemo<ProcessEditorIssue[]>(() => {
    if (!proces || !actiefKaderId) return []
    const rapport = controleerProcesTegenKader(proces, actiefKaderId)
    const controles = rapport.controles.filter(
      (controle) =>
        controle.status !== 'gevonden' &&
        (!controleParameter || controle.id === controleParameter),
    )
    return controles.flatMap((controle) => {
      const basis = {
        bron: 'kader' as const,
        kaderId: rapport.kader.id,
        kaderNaam: rapport.kader.naam,
        controleId: controle.id,
        titel: controle.titel,
        bericht: controle.bevinding,
        advies: controle.advies,
        ernst: controle.status === 'aandacht' ? 'waarschuwing' : 'info',
      }
      return controle.stapIds?.length
        ? controle.stapIds.map((stapId) => ({ ...basis, stapId }))
        : [{ ...basis }]
    })
  }, [actiefKaderId, controleParameter, proces])

  const monitoringSleutel = JSON.stringify([id, bevindingParameter])
  const vraagIssue = ((): ProcessEditorIssue | undefined => {
    if (!magProcesWijzigen || !id || bevindingParameter || !assuranceVraagParameter) return undefined
    try {
      const opgeslagen = JSON.parse(sessionStorage.getItem('spg-assurance-aanleiding') ?? 'null') as {
        procesId?: string; kaderId?: string; kaderNaam?: string; vraagId?: string; titel?: string; bericht?: string
      } | null
      if (opgeslagen?.procesId !== id || opgeslagen.vraagId !== assuranceVraagParameter ||
          typeof opgeslagen.titel !== 'string' || !opgeslagen.titel ||
          typeof opgeslagen.bericht !== 'string' || !opgeslagen.bericht) return undefined
      return {
        bron: 'kader', kaderId: typeof opgeslagen.kaderId === 'string' ? opgeslagen.kaderId : 'assurance',
        kaderNaam: typeof opgeslagen.kaderNaam === 'string' ? opgeslagen.kaderNaam : 'Normcoach',
        controleId: opgeslagen.vraagId, titel: opgeslagen.titel, bericht: opgeslagen.bericht,
        advies: 'Gebruik de AI-processteward voor een conceptvoorstel. Controleer en keur iedere wijziging daarna zelf goed.',
        ernst: 'waarschuwing',
      }
    } catch {
      // Ongeldige of niet beschikbare lokale overdracht leidt nooit tot een stille AI-actie.
      return undefined
    }
  })()
  const assuranceIssue = !magProcesWijzigen || !id ? undefined : bevindingParameter
    ? monitoringIssue?.sleutel === monitoringSleutel ? monitoringIssue.issue : undefined
    : vraagIssue

  useEffect(() => {
    if (!magProcesWijzigen || !id || !bevindingParameter) return
    let actief = true
    void dataSource.getAssuranceMonitoringStatus().then((monitoring) => {
      if (!actief) return
      const bevinding = monitoring.laatsteRun?.bevindingen.find((item) => item.id === bevindingParameter && item.procesId === id)
      setMonitoringIssue({
        sleutel: monitoringSleutel,
        issue: bevinding ? {
          bron: 'kader', kaderId: bevinding.kaderId ?? 'assurance',
          kaderNaam: bevinding.kaderId?.toUpperCase() ?? 'Continue assurance',
          controleId: bevinding.id, titel: bevinding.titel, bericht: bevinding.bericht,
          advies: 'Werk de procesborging bij, sla als concept op en laat de wijziging menselijk beoordelen voordat de bevinding wordt opgevolgd.',
          ernst: bevinding.ernst,
        } : undefined,
      })
    }).catch(() => { if (actief) setMonitoringIssue({ sleutel: monitoringSleutel }) })
    return () => { actief = false }
  }, [bevindingParameter, id, magProcesWijzigen, monitoringSleutel])

  const editorIssues = useMemo<ProcessEditorIssue[]>(
    () => [
      ...(gezondheid?.issues ?? []),
      ...kaderIssues,
      ...(assuranceIssue ? [assuranceIssue] : []),
    ],
    [assuranceIssue, gezondheid?.issues, kaderIssues],
  )
  const aiKaderAanleiding = useMemo(() => {
    const assuranceReferentie = bevindingParameter ?? assuranceVraagParameter
    if (assuranceIssue && assuranceReferentie) {
      return {
        kaderId: assuranceIssue.kaderId ?? 'assurance',
        controleId: assuranceReferentie,
        titel: `${assuranceIssue.kaderNaam ?? 'Continue assurance'}: ${
          assuranceIssue.titel ?? 'Bevinding'
        }`,
        beschrijving: [
          `Bevinding: ${assuranceIssue.bericht}`,
          assuranceIssue.advies
            ? `Aanbevolen opvolging: ${assuranceIssue.advies}`
            : undefined,
          'Dit is een procesbrede assurancebevinding. Vraag door voordat je een inhoudelijke aanname doet.',
        ]
          .filter(Boolean)
          .join('\n'),
      }
    }
    if (!actiefKaderId || !controleParameter || kaderIssues.length === 0) return undefined
    const issue = kaderIssues[0]
    const stapIds = [
      ...new Set(
        kaderIssues
          .map((kaderIssue) => kaderIssue.stapId)
          .filter((stapId): stapId is string => Boolean(stapId)),
      ),
    ]
    return {
      kaderId: actiefKaderId,
      controleId: controleParameter,
      titel: `${issue.kaderNaam}: ${issue.titel}`,
      beschrijving: [
        `Bevinding: ${issue.bericht}`,
        issue.advies ? `Aanbevolen opvolging: ${issue.advies}` : undefined,
        stapIds.length > 0
          ? `De editor koppelt deze bevinding aan stap(pen): ${stapIds.join(', ')}.`
          : 'Dit is een procesbrede of handmatig te beoordelen bevinding.',
      ].filter(Boolean).join('\n'),
    }
  }, [
    actiefKaderId,
    assuranceIssue,
    assuranceVraagParameter,
    bevindingParameter,
    controleParameter,
    kaderIssues,
  ])

  if (!magProcesWijzigen) {
    return <div className="empty">De proceseditor vereist de rol “bewerken”.</div>
  }
  if (laadFout) return <div><p role="alert">{laadFout}</p><Link to="/">Naar Processen</Link></div>
  if (!proces) return <p className="muted">Laden…</p>

  const upd = (deel: Partial<Process>) => setProces({ ...proces, ...deel })

  const updStap = (i: number, s: Step) => {
    const stappen = [...proces.stappen]
    stappen[i] = s
    upd({ stappen })
  }

  const wijzigStapType = (stapId: string, nieuwType: StepType) => {
    const eerstePoging = changeStepTypeSafely(proces, stapId, nieuwType)
    if (eerstePoging.ok) {
      setProces(eerstePoging.process)
      return
    }
    if (!eerstePoging.issues.some((issue) => issue.code === 'step-type-cleanup-required')) {
      setMelding(eerstePoging.issues.map((issue) => issue.message).join(' '))
      return
    }
    if (!window.confirm(
      `${eerstePoging.issues[0].message} Deze verborgen relaties gaan verloren. Type toch wijzigen?`,
    )) return
    const bevestigd = changeStepTypeSafely(proces, stapId, nieuwType, true)
    if (!bevestigd.ok) {
      setMelding(bevestigd.issues.map((issue) => issue.message).join(' '))
      return
    }
    setProces(bevestigd.process)
  }

  const nieuwStap = (sectieId: string) => {
    const s: Step = {
      id: crypto.randomUUID().slice(0, 8),
      nummer: String(proces.stappen.filter((x) => x.sectieId === sectieId && /^\d+$/.test(x.nummer)).length + 1),
      sectieId,
      laneId: proces.lanes[0]?.id ?? '',
      type: 'actie',
      activiteit: '',
    }
    upd({ stappen: [...proces.stappen, s] })
  }

  const schuifStap = (i: number, richting: -1 | 1) => {
    const stap = proces.stappen[i]
    if (!stap) return
    const sectieIndices = proces.stappen
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.sectieId === stap.sectieId)
      .map(({ index }) => index)
    const positie = sectieIndices.indexOf(i)
    const j = sectieIndices[positie + richting]
    if (j === undefined) return
    const stappen = [...proces.stappen]
    ;[stappen[i], stappen[j]] = [stappen[j], stappen[i]]
    upd({ stappen })
  }

  /** Drag & drop: plaats gesleepte stap rond doelId (of aan het einde van de sectie). */
  const verplaatsStap = (
    gesleeptId: string,
    doelId: string | null,
    sectieId: string,
    positie: 'voor' | 'na' = 'voor',
  ) => {
    const stappen = [...proces.stappen]
    const vanIdx = stappen.findIndex((s) => s.id === gesleeptId)
    if (vanIdx < 0) return
    if (doelId === gesleeptId) return
    const [item] = stappen.splice(vanIdx, 1)
    const doelSectie = proces.secties.find((sectie) => sectie.id === sectieId)
    if (!doelSectie) return
    const verplaatst = { ...item, sectieId }
    let doelStap: Step | undefined
    if (doelId) {
      const doelIdx = stappen.findIndex((s) => s.id === doelId)
      doelStap = doelIdx >= 0 ? stappen[doelIdx] : undefined
      stappen.splice(doelIdx < 0 ? stappen.length : doelIdx + (positie === 'na' ? 1 : 0), 0, verplaatst)
    } else {
      let laatste = -1
      stappen.forEach((s, i) => {
        if (s.sectieId === sectieId) laatste = i
      })
      if (laatste >= 0) {
        stappen.splice(laatste + 1, 0, verplaatst)
      } else {
        const doelSectieIndex = proces.secties.findIndex((sectie) => sectie.id === sectieId)
        const eersteLatereSectie = stappen.findIndex((stap) => {
          const stapSectieIndex = proces.secties.findIndex((sectie) => sectie.id === stap.sectieId)
          return stapSectieIndex > doelSectieIndex
        })
        stappen.splice(eersteLatereSectie < 0 ? stappen.length : eersteLatereSectie, 0, verplaatst)
      }
    }
    setGesleepteStapId(null)
    setFormulierDropDoel(null)
    const ongewijzigd = stappen.every(
      (stap, index) =>
        stap.id === proces.stappen[index]?.id &&
        stap.sectieId === proces.stappen[index]?.sectieId,
    )
    if (ongewijzigd) {
      setMelding(`Stap “${item.activiteit || item.nummer || item.id}” staat al op deze positie.`)
      return
    }
    upd({ stappen })
    setMelding(
      `Stap “${item.activiteit || item.nummer || item.id}” verplaatst naar “${doelSectie.naam}”` +
        (doelStap
          ? ` ${positie === 'na' ? 'na' : 'vóór'} “${doelStap.activiteit || doelStap.nummer || doelStap.id}”.`
          : ' onderaan.'),
    )
  }

  const scrollFormulierTijdensDrag = (clientY: number) => {
    const scrollgebied = formulierScrollRef.current
    if (!scrollgebied || formulierDragScrollFrameRef.current !== null) return
    const rechthoek = scrollgebied.getBoundingClientRect()
    const randzone = Math.min(72, rechthoek.height / 4)
    const afstandBoven = clientY - rechthoek.top
    const afstandOnder = rechthoek.bottom - clientY
    let stapgrootte = 0
    if (afstandBoven >= 0 && afstandBoven < randzone) {
      stapgrootte = -Math.max(12, (randzone - afstandBoven) / 2)
    } else if (afstandOnder >= 0 && afstandOnder < randzone) {
      stapgrootte = Math.max(12, (randzone - afstandOnder) / 2)
    }
    if (stapgrootte === 0) return
    formulierDragScrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollgebied.scrollBy({ top: stapgrootte })
      formulierDragScrollFrameRef.current = null
    })
  }

  const bepaalFormulierDropDoel = (
    gesleeptId: string,
    clientX: number,
    clientY: number,
  ): FormulierDropDoel | null => {
    const element = document.elementFromPoint(clientX, clientY)
    if (!(element instanceof Element)) return null

    const kaart = element.closest<HTMLElement>('.be-stap[data-stap-id]')
    const doelStapId = kaart?.dataset.stapId
    if (kaart && doelStapId && doelStapId !== gesleeptId) {
      const sectie = kaart.closest<HTMLElement>('.be-sectie[data-sectie-id]')
      const sectieId = sectie?.dataset.sectieId
      if (!sectieId) return null
      const rechthoek = kaart.getBoundingClientRect()
      return {
        type: 'stap',
        stapId: doelStapId,
        sectieId,
        positie: clientY < rechthoek.top + rechthoek.height / 2 ? 'voor' : 'na',
      }
    }

    const einde = element.closest<HTMLElement>('.be-stap-einde-dropzone[data-sectie-id]')
    const sectieId = einde?.dataset.sectieId
    return sectieId ? { type: 'einde', sectieId } : null
  }

  const beweegFormulierStap = (
    gesleeptId: string,
    clientX: number,
    clientY: number,
  ) => {
    scrollFormulierTijdensDrag(clientY)
    setFormulierDropDoel(bepaalFormulierDropDoel(gesleeptId, clientX, clientY))
  }

  const laatFormulierStapLos = (
    gesleeptId: string,
    clientX: number,
    clientY: number,
    geannuleerd = false,
  ) => {
    if (formulierDragScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(formulierDragScrollFrameRef.current)
      formulierDragScrollFrameRef.current = null
    }
    const doel = geannuleerd
      ? null
      : bepaalFormulierDropDoel(gesleeptId, clientX, clientY)
    setGesleepteStapId(null)
    setFormulierDropDoel(null)
    if (!doel) {
      setMelding(
        geannuleerd
          ? 'Stapverplaatsing geannuleerd.'
          : 'Stap niet verplaatst; laat de greep los boven of onder een andere stap.',
      )
      return
    }
    if (doel.type === 'stap') {
      verplaatsStap(gesleeptId, doel.stapId, doel.sectieId, doel.positie)
    } else {
      verplaatsStap(gesleeptId, null, doel.sectieId)
    }
  }

  const kettingAuto = () => {
    const kandidaten = proces.stappen.filter(
      (stap) => stap.type !== 'beslissing' && stap.type !== 'eind' && !(stap.routes?.length),
    )
    if (
      !window.confirm(
        `Auto-schakelen vult het directe vervolg van ${kandidaten.length} stap(pen) opnieuw in. ` +
          'Beslissingen, eindstappen en bestaande routes worden overgeslagen. Doorgaan?',
      )
    ) {
      return
    }
    const stappen = proces.stappen.map((s, i) => {
      if (s.type === 'beslissing' || s.type === 'eind' || s.routes?.length) return s
      const volgende = proces.stappen.slice(i + 1).find((x) => x.sectieId === s.sectieId)
      return { ...s, naarStap: volgende?.id }
    })
    upd({ stappen })
    setMelding('Directe vervolgen bijgewerkt; beslissingen, eindstappen en routes zijn behouden.')
  }

  const verwijderStap = (stapId: string) => {
    const inkomend = proces.stappen.reduce(
      (aantal, stap) =>
        aantal +
        Number(stap.naarStap === stapId) +
        (stap.routes?.filter((route) => route.naarStap === stapId).length ?? 0),
      0,
    )
    if (
      !window.confirm(
        inkomend > 0
          ? `Deze stap heeft ${inkomend} inkomende verbinding(en). De stap én die verwijzingen verwijderen?`
          : 'Deze stap verwijderen?',
      )
    ) {
      return
    }
    const resultaat = deleteStepSafely(proces, stapId)
    if (!resultaat.ok) {
      setMelding(resultaat.issues.map((issue) => issue.message).join(' '))
      return
    }
    setProces(resultaat.process)
  }

  const verwijderLane = (laneId: string) => {
    const gebruikt = proces.stappen.filter((stap) => stap.laneId === laneId || stap.doelLaneId === laneId)
    if (gebruikt.length > 0) {
      setMelding(
        `Rol kan niet worden verwijderd: ${gebruikt.length} stap(pen) gebruiken deze rol als verantwoordelijke of ontvanger.`,
      )
      return
    }
    if (proces.lanes.length <= 1) {
      setMelding('Een proces moet minimaal één rol houden.')
      return
    }
    upd({ lanes: proces.lanes.filter((lane) => lane.id !== laneId) })
  }

  const verwijderSectie = (sectieId: string) => {
    const gebruikt = proces.stappen.filter((stap) => stap.sectieId === sectieId)
    if (gebruikt.length > 0) {
      setMelding(`Sectie kan niet worden verwijderd: verplaats eerst ${gebruikt.length} stap(pen).`)
      return
    }
    upd({ secties: proces.secties.filter((sectie) => sectie.id !== sectieId) })
  }

  const kopieerVan = async (vanId: string) => {
    const bron = await dataSource.getWorkspaceProcess(vanId)
    if (!bron) return
    const kopie = structuredClone(bron)
    kopie.id = `${bron.id}-kopie`
    delete kopie.revision
    kopie.detailproces = `${bron.detailproces} (kopie)`
    kopie.status = 'concept'
    kopie.bron = { type: 'kopie', bestand: bron.id }
    setProces(kopie)
    setOpgeslagenMomentopname('')
  }

  const doeOpslaan = async (teBewaren: Process = proces, navigeerNaOpslaan = true) => {
    const definitiefId = teBewaren.id || slug(teBewaren.detailproces)
    if (!definitiefId || !teBewaren.detailproces) {
      setMelding('Vul minimaal een naam (detailproces) in.')
      return null
    }
    const opTeSlaan: Process = {
      ...teBewaren,
      id: definitiefId,
      status: 'concept',
      laatsteWijziging: new Date().toISOString().slice(0, 10),
    }
    if (opTeSlaan.lanes.length === 0) {
      setMelding('Een proces moet minimaal één rol hebben.')
      return null
    }
    const structuur = validateEditorProcessStructure(opTeSlaan)
    if (!structuur.ok) {
      setMelding(
        `Opslaan gepauzeerd: ${structuur.issues[0].message}` +
          (structuur.issues.length > 1 ? ` (+${structuur.issues.length - 1} aandachtspunten)` : ''),
      )
      return null
    }
    try {
      const opgeslagen = await dataSource.saveProcess(opTeSlaan)
      usePunten.getState().kenToe('proces-gebouwd')
      setMelding('Opgeslagen als concept.')
      setProces(opgeslagen)
      setOpgeslagenMomentopname(JSON.stringify(opgeslagen))
      if (navigeerNaOpslaan) navigate(`/proces/${opgeslagen.id}?workspace=1`)
      else if (!id) navigate(`/bouwer/${opgeslagen.id}`, { replace: true })
      return opgeslagen
    } catch (e) {
      setMelding(e instanceof Error ? e.message : 'Opslaan mislukt.')
      return null
    }
  }

  const vervangAiHistorieItem = (item: ProcessMaintenanceRunLedgerItem) => {
    setAiHistorie((huidig) =>
      [item, ...huidig.filter((run) => run.runId !== item.runId)]
        .sort((links, rechts) => Date.parse(rechts.gestartOp) - Date.parse(links.gestartOp))
        .slice(0, 50),
    )
  }

  const laadAiHistorie = async (processId: string = proces.id) => {
    if (!dataSource.heeftBackend || !processId) return
    setAiHistorieLaden(true)
    setAiHistorieFout(undefined)
    try {
      setAiHistorie(await dataSource.getProcessMaintenanceRuns(processId, 50))
    } catch (error) {
      setAiHistorieFout(
        error instanceof Error
          ? error.message
          : 'De AI-runhistorie kon niet worden geladen.',
      )
    } finally {
      setAiHistorieLaden(false)
    }
  }

  const voerAiOnderhoudsanalyseUit = async (
    antwoorden: Record<string, string> = {},
  ) => {
    let bronProces = proces
    if (
      heeftNietOpgeslagenWijzigingen ||
      !bronProces.id ||
      !bronProces.revision
    ) {
      setAiFase('saving')
      const opgeslagen = await doeOpslaan(bronProces, false)
      if (!opgeslagen) {
        setAiFout(
          'Sla eerst een geldige processtructuur op. De AI analyseert uitsluitend een vaste, controleerbare revisie.',
        )
        setAiFase('error')
        return
      }
      bronProces = opgeslagen
    }

    if (!bronProces.revision) {
      setAiFout('De backend heeft geen procesrevisie teruggegeven. Herlaad het proces en probeer opnieuw.')
      setAiFase('error')
      return
    }

    setAiFase('analyzing')
    setAiFout(undefined)
    setAiBronVingerafdruk(processMaintenanceSemanticFingerprint(bronProces))
    try {
      const analyse = await dataSource.analyzeProcessMaintenance(bronProces.id, {
        expectedRevision: bronProces.revision,
        doel: aiKaderAanleiding
          ? `Los de geselecteerde kaderbevinding "${aiKaderAanleiding.titel}" controleerbaar op. ` +
            'Markeer de betrokken bestaande stappen en stel uitsluitend veilige tekstverbeteringen voor. ' +
            'Vraag door wanneer procesbetekenis, bewijs of verantwoordelijkheid niet uit de bronnen volgt.'
          : 'Controleer dit proces op actuele gezondheids-, kader-, audit- en borgingsproblemen. ' +
            'Markeer de betrokken stappen en stel alleen veilige tekstverbeteringen voor.',
        aanleiding:
          aiKaderAanleiding
            ? {
                soort: 'kader',
                referentieId: aiKaderAanleiding.controleId,
                kaderId: aiKaderAanleiding.kaderId,
                titel: aiKaderAanleiding.titel,
                beschrijving: aiKaderAanleiding.beschrijving,
              }
            : {
                soort: 'handmatig',
                referentieId: null,
                kaderId: null,
                titel: 'Periodiek procesonderhoud',
                beschrijving: null,
              },
        antwoorden: Object.keys(antwoorden).length > 0 ? antwoorden : null,
      })
      setAiAnalyse(analyse)
      setAiAntwoorden(antwoorden)
      setAiFase(
        analyse.status === 'vragen'
          ? 'vragen'
          : analyse.status === 'voorstel'
            ? 'voorstel'
            : 'no-change',
      )
      setMelding(
        analyse.status === 'vragen'
          ? 'De AI heeft eerst aanvullende informatie nodig.'
          : analyse.status === 'voorstel'
            ? `AI-analyse gereed: ${analyse.issues.length} bevinding(en) en ${analyse.wijzigingen.length} wijziging(en).`
            : 'AI-analyse gereed: geen veilige wijzigingen nodig binnen de geselecteerde context.',
      )
      void laadAiHistorie(bronProces.id)
    } catch (error) {
      setAiFout(error instanceof Error ? error.message : 'De AI-analyse is mislukt.')
      setAiFase('error')
      void laadAiHistorie(bronProces.id)
    }
  }

  const accepteerAiOnderhoud = async (verwachteRunId?: string) => {
    if (
      !aiAnalyse ||
      aiAnalyse.status !== 'voorstel' ||
      aiAnalyse.wijzigingen.length === 0 ||
      !aiBronVingerafdruk ||
      (verwachteRunId && aiAnalyse.runId !== verwachteRunId)
    ) return
    if (isProcessMaintenanceAnalysisStale(proces, aiBronVingerafdruk)) {
      setAiFase('stale')
      return
    }
    const toegepast = applyProcessMaintenanceAnalysis(proces, aiAnalyse)
    if (!toegepast.ok) {
      setAiFout(toegepast.errors.join(' '))
      setAiFase('stale')
      return
    }
    setAiFase('accepting')
    setAiFeedbackRunId(aiAnalyse.runId)
    setAiFout(undefined)
    try {
      const run = await dataSource.recordProcessMaintenanceRunFeedback(
        aiAnalyse.procesId,
        aiAnalyse.runId,
        {
          beslissing: 'accepted',
          geaccepteerdeWijzigingIds: aiAnalyse.wijzigingen.map((wijziging) => wijziging.id),
        },
      )
      vervangAiHistorieItem(run)
      setProces(toegepast.process)
      setAiFase('applied')
      setMelding(
        'De acceptatie is in de AI-runhistorie vastgelegd. De tekstwijzigingen staan in de editor; controleer ze en sla daarna zelf het concept op.',
      )
    } catch (error) {
      setAiFase('voorstel')
      setMelding(
        `De wijzigingen zijn niet toegepast omdat de beslissing niet veilig kon worden vastgelegd. ${
          error instanceof Error ? error.message : 'Probeer het opnieuw.'
        }`,
      )
    } finally {
      setAiFeedbackRunId(undefined)
    }
  }

  const wijsAiOnderhoudAf = async (
    reden?: string,
    verwachteRunId?: string,
  ) => {
    if (
      !aiAnalyse ||
      aiAnalyse.status !== 'voorstel' ||
      aiAnalyse.wijzigingen.length === 0 ||
      (verwachteRunId && aiAnalyse.runId !== verwachteRunId)
    ) return
    setAiFase('accepting')
    setAiFeedbackRunId(aiAnalyse.runId)
    setAiFout(undefined)
    try {
      const run = await dataSource.recordProcessMaintenanceRunFeedback(
        aiAnalyse.procesId,
        aiAnalyse.runId,
        {
          beslissing: 'rejected',
          reden,
          geaccepteerdeWijzigingIds: [],
        },
      )
      vervangAiHistorieItem(run)
      sluitAiOnderhoud()
      setMelding('Het AI-voorstel is afgewezen en onveranderbaar in de runhistorie vastgelegd.')
    } catch (error) {
      setAiFase('voorstel')
      setMelding(
        `De afwijzing kon niet veilig worden vastgelegd. ${
          error instanceof Error ? error.message : 'Probeer het opnieuw.'
        }`,
      )
    } finally {
      setAiFeedbackRunId(undefined)
    }
  }

  const sluitAiOnderhoud = () => {
    setAiFase('idle')
    setAiAnalyse(undefined)
    setAiAntwoorden({})
    setAiFout(undefined)
    setAiBronVingerafdruk(undefined)
  }

  const aiSteward: AiProcessStewardController = {
    phase: aiFase,
    result: aiAnalyse,
    answers: aiAntwoorden,
    error: aiFout,
    analyzeLabel: heeftNietOpgeslagenWijzigingen
      ? 'Opslaan & analyseren'
      : 'Analyseer onderhoud',
    analyzeDisabled: !dataSource.heeftBackend,
    analyzeDisabledReason: dataSource.heeftBackend
      ? undefined
      : 'AI-procesonderhoud vereist de backend.',
    acceptDisabled:
      !aiAnalyse ||
      !aiBronVingerafdruk,
    onAnalyze: () => void voerAiOnderhoudsanalyseUit(),
    onAnswer: (questionId, answer) =>
      setAiAntwoorden((current) => ({ ...current, [questionId]: answer })),
    onContinue: () => void voerAiOnderhoudsanalyseUit(aiAntwoorden),
    onAccept: () => void accepteerAiOnderhoud(),
    onReject: () => void wijsAiOnderhoudAf(),
    onClose: sluitAiOnderhoud,
  }

  const aiRunHistory: ProcessMaintenanceRunHistoryController = {
    items: aiHistorie,
    loading: aiHistorieLaden,
    error: aiHistorieFout,
    busyRunId: aiFeedbackRunId,
    currentProcessRevision: proces.revision,
    activeProposalRunId:
      aiFase === 'voorstel' && aiAnalyse?.status === 'voorstel'
        ? aiAnalyse.runId
        : undefined,
    onOpen: () => void laadAiHistorie(),
    onRefresh: () => void laadAiHistorie(),
    onAcceptInConcept: async (run) => {
      await accepteerAiOnderhoud(run.runId)
    },
    onReject: async (run, reason) => {
      await wijsAiOnderhoudAf(reason, run.runId)
    },
  }

  const doeVerwijderen = async () => {
    if (!window.confirm('Dit archiveert het volledige proces en haalt een bestaande publicatie uit de procesgids. Doorgaan?')) {
      return
    }

    try {
      await dataSource.deleteProcess(proces.id)
      navigate('/')
    } catch (e) {
      setMelding(e instanceof Error ? e.message : 'Verwijderen mislukt.')
    }
  }

  const isConcept = proces.status === 'concept' && Boolean(proces.id)

  return (
    <div className="bouwer">
      {/* Autocomplete-bronnen voor de stap-editors */}
      <datalist id="proces-ids">
        {summaries.map((s) => (
          <option key={s.id} value={s.id}>
            {s.detailproces}
          </option>
        ))}
      </datalist>
      <datalist id="erp-statussen">
        {['nieuw', 'controle', 'invoer compleet', 'ontvangen', 'klaar voor afhaal', 'product terug klant', 'credit akkoord', 'VKR-order'].map(
          (s) => (
            <option key={s} value={s} />
          ),
        )}
      </datalist>

      <div className="bouwer-kop">
        <div>
          <span className="kicker">Procesbouwer</span>
          <h1>{proces.detailproces || 'Nieuw proces'}</h1>
        </div>
        <div className="detail-tools">
          <select aria-label="Bestaand proces bewerken" value={id ?? ''} onChange={(event) => {
            if (!event.target.value) return
            if (heeftNietOpgeslagenWijzigingen && (proces.detailproces || proces.stappen.length) && !window.confirm('Je hebt niet-opgeslagen wijzigingen. Toch een ander proces openen?')) return
            navigate(`/bouwer/${encodeURIComponent(event.target.value)}`)
          }}>
            <option value="">Bestaand proces bewerken…</option>
            {summaries.filter(s => s.status !== 'gearchiveerd').map(s => <option key={s.id} value={s.id}>{s.detailproces}</option>)}
          </select>
          <select
            className="rol-filter"
            value=""
            onChange={(e) => e.target.value && void kopieerVan(e.target.value)}
            title="Start vanuit een kopie van een bestaand proces"
          >
            <option value="">📑 Kopieer van…</option>
            {summaries.map((s) => (
              <option key={s.id} value={s.id}>
                {s.detailproces}
              </option>
            ))}
          </select>
          <Link className="btn-secundair" to="/ai-diagram">
            ✨ Maak met AI
          </Link>
          <label className="btn-secundair json-import" title="Proces laden uit een JSON-export">
            📂 JSON
            <input
              type="file"
              accept="application/json"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (!f) return
                void f.text().then((tekst) => {
                  try {
                    const geladen = JSON.parse(tekst) as Process
                    if (!geladen.stappen || !geladen.lanes) throw new Error('geen geldig procesbestand')
                    setProces({ ...geladen, status: 'concept' })
                    setOpgeslagenMomentopname('')
                    setMelding(`JSON geladen: ${geladen.detailproces} (${geladen.stappen.length} stappen).`)
                  } catch (err) {
                    setMelding(`JSON laden mislukt: ${err instanceof Error ? err.message : 'onbekend'}`)
                  }
                })
                e.target.value = ''
              }}
            />
          </label>
          {isConcept && magBeheren && (
            <button className="btn-secundair" onClick={() => void doeVerwijderen()}>
              🗄 Archiveer proces
            </button>
          )}
          <button className="btn-primair" onClick={() => void doeOpslaan()}>
            💾 Opslaan als concept
          </button>
        </div>
      </div>
      {melding && (
        <p className="bouwer-melding" role="status" aria-live="polite">
          {melding}
        </p>
      )}

      <details className="bouwer-hulp">
        <summary>💡 Hulp: zo bouw je een proces</summary>
        <ol>
          <li><strong>Gegevens</strong>: geef het proces een naam; het id wordt automatisch afgeleid.</li>
          <li><strong>Rollen (lanes)</strong>: wie doet mee? Elke rol wordt een kolom op de plaat, met eigen kleur.</li>
          <li><strong>Secties</strong>: optionele deelstromen (bv. "Website" en "Telefonisch").</li>
          <li><strong>Visuele editor</strong>: voeg vormen toe, sleep en vergroot ze vrij, en trek verbindingen tussen de aansluitpunten. Een beslissing vraagt altijd om een routenaam voordat de lijn wordt gemaakt.</li>
          <li><strong>Formulieren & controles</strong>: gebruik de tweede weergave voor alle detailvelden, de zes controlevisualisaties en de tabel. Pak een stap bij de greep (⠿) en zet hem vóór, na of in een andere sectie. Zonder muis kan dit met ↑/↓ en het veld <em>Sectie</em>.</li>
          <li><strong>Stap-typen</strong>: <em>Actie</em> = gewone handeling · <em>Bericht</em> = pijl naar een andere rol (kies "Bericht naar") · <em>Beslissing</em> = splitsing met "Indien …" · <em>Subproces</em> = SC-blok dat een ander proces start · <em>Einde</em> = E-blok, meestal met een vervolgproces.</li>
          <li><strong>Vervolgproces & ERP-status</strong> hebben autocomplete: begin te typen en kies uit de lijst.</li>
          <li>Let op de <strong>gezondheidsscore</strong> rechts: die vertelt wat er nog mist. Opslaan maakt een <em>concept</em>; live gaat pas na 📤 indienen en ✅ goedkeuren.</li>
        </ol>
        <p className="muted">Tip: kom je er niet uit, vraag de 🤖 AI-assistent om een conceptstructuur — die levert JSON die je hier via 📂 JSON kunt laden.</p>
      </details>

      <section className="bouwer-uitwisseling-compact" aria-labelledby="bouwer-uitwisseling-titel">
        <div>
          <strong id="bouwer-uitwisseling-titel">⇄ Importeren &amp; exporteren</strong>
          <span className="muted">
            Neem een bestaand diagram over of download dit proces.
          </span>
        </div>
        {(id || proces.revision !== undefined) && proces.id ? (
          <div className="bm-acties">
            <Link
              className="btn-secundair"
              to={`/uitwisseling?processId=${encodeURIComponent(proces.id || id || '')}&actie=importeren&formaat=drawio-xml`}
            >
              Importeren
            </Link>
            <Link
              className="btn-secundair"
              to={`/uitwisseling?processId=${encodeURIComponent(proces.id || id || '')}&actie=exporteren&formaat=drawio-xml`}
            >
              Exporteren
            </Link>
          </div>
        ) : (
          <Link className="btn-secundair" to="/uitwisseling">Importeer een bestand</Link>
        )}
      </section>

      <div className="editor-mode-switch" role="group" aria-label="Manier van bewerken">
        <button
          className={bouwerModus === 'visueel' ? 'active' : ''}
          onClick={() => setBouwerModus('visueel')}
        >
          ✦ Visuele editor
        </button>
        <button
          className={bouwerModus === 'formulieren' ? 'active' : ''}
          onClick={() => {
            if (
              heeftNietOpgeslagenWijzigingen &&
              !window.confirm(
                'De wijzigingen blijven staan, maar de undo/redo-geschiedenis van de visuele editor wordt bij deze wissel gewist. Doorgaan?',
              )
            ) return
            setBouwerModus('formulieren')
          }}
        >
          ☷ Formulieren & controles
        </button>
      </div>

      {bouwerModus === 'visueel' ? (
        <ProcessDiagramEditor
          proces={proces}
          onChange={setProces}
          onSave={async (huidig) => Boolean(await doeOpslaan(huidig, false))}
          knownProcesses={summaries}
          savedSnapshot={opgeslagenMomentopname}
          issues={editorIssues}
          score={gezondheid?.score}
          initialFocusStepId={focusStapParameter}
          aiSteward={aiSteward}
          aiRunHistory={
            dataSource.heeftBackend && proces.id
              ? aiRunHistory
              : undefined
          }
        />
      ) : (
      <div
        className="bouwer-grid"
        ref={formulierScrollRef}
        role="region"
        aria-label="Formulieren en controles"
        tabIndex={0}
      >
        <div className="bouwer-editor">
          <section className="be-blok">
            <h2>Gegevens</h2>
            <div className="be-form">
              <label>
                Hoofdproces
                <input value={proces.hoofdproces} onChange={(e) => upd({ hoofdproces: e.target.value })} />
              </label>
              <label>
                Detailproces (naam)
                <input
                  value={proces.detailproces}
                  placeholder="bv. Service – Ontvangst"
                  onChange={(e) => upd({ detailproces: e.target.value })}
                />
              </label>
              <label>
                Versie
                <input value={proces.versie} onChange={(e) => upd({ versie: e.target.value })} />
              </label>
              <label>
                Id
                <input
                  value={proces.id}
                  placeholder={slug(proces.detailproces) || 'automatisch'}
                  onChange={(e) => upd({ id: e.target.value })}
                />
              </label>
            </div>
          </section>

          <section className="be-blok">
            <h2>Rollen (lanes)</h2>
            {proces.lanes.map((l, i) => (
              <div key={l.id} className="be-rij">
                <input
                  type="color"
                  value={l.kleur}
                  onChange={(e) => {
                    const lanes = [...proces.lanes]
                    lanes[i] = { ...l, kleur: e.target.value }
                    upd({ lanes })
                  }}
                />
                <input
                  value={l.naam}
                  onChange={(e) => {
                    const lanes = [...proces.lanes]
                    lanes[i] = { ...l, naam: e.target.value }
                    upd({ lanes })
                  }}
                />
                <button
                  title="Verwijderen"
                  onClick={() => verwijderLane(l.id)}
                >
                  🗑
                </button>
              </div>
            ))}
            <button
              className="btn-secundair klein"
              onClick={() => {
                const nieuw: Lane = { id: crypto.randomUUID().slice(0, 8), naam: 'Nieuwe rol', kleur: '#10B981' }
                upd({ lanes: [...proces.lanes, nieuw] })
              }}
            >
              + Rol toevoegen
            </button>
          </section>

          <section className="be-blok">
            <h2>Secties</h2>
            {proces.secties.map((sec, i) => (
              <div key={sec.id} className="be-rij">
                <input
                  value={sec.naam}
                  onChange={(e) => {
                    const secties = [...proces.secties]
                    secties[i] = { ...sec, naam: e.target.value }
                    upd({ secties })
                  }}
                />
                <button
                  title="Verwijderen"
                  onClick={() => verwijderSectie(sec.id)}
                >
                  🗑
                </button>
              </div>
            ))}
            <button
              className="btn-secundair klein"
              onClick={() => {
                const nieuw: Section = { id: crypto.randomUUID().slice(0, 8), naam: 'Nieuwe sectie' }
                upd({ secties: [...proces.secties, nieuw] })
              }}
            >
              + Sectie toevoegen
            </button>
          </section>

          <section className="be-blok">
            <div className="be-blok-kop">
              <h2>Stappen</h2>
              <button className="btn-secundair klein" onClick={kettingAuto} title="naarStap automatisch invullen">
                🔗 Auto-schakelen
              </button>
            </div>
            {proces.secties.map((sec) => {
              const sectieStappen = proces.stappen
                .map((stap, index) => ({ stap, index }))
                .filter(({ stap }) => stap.sectieId === sec.id)

              return (
                <div
                  key={sec.id}
                  className={`be-sectie${gesleepteStapId ? ' heeft-gesleepte-stap' : ''}`}
                  data-sectie-id={sec.id}
                >
                  <h3>{sec.naam}</h3>
                  {sectieStappen.map(({ stap: s, index: i }, positie) => (
                    <StapEditor
                      key={s.id}
                      proces={proces}
                      stap={s}
                      onChange={(ns) => updStap(i, ns)}
                      onTypeChange={(type) => wijzigStapType(s.id, type)}
                      onVerwijder={() => verwijderStap(s.id)}
                      onSchuif={(r) => schuifStap(i, r)}
                      onPakOp={(stapId) => {
                        setGesleepteStapId(stapId)
                        setFormulierDropDoel(null)
                        setMelding(
                          `Stap “${s.activiteit || s.nummer || s.id}” opgepakt. ` +
                            'Laat los op de bovenste of onderste helft van een stap, of onderaan een sectie.',
                        )
                      }}
                      onSleepBeweeg={beweegFormulierStap}
                      onLaatLos={laatFormulierStapLos}
                      onVerplaatsNaarSectie={(sectieId) => {
                        if (sectieId !== s.sectieId) verplaatsStap(s.id, null, sectieId)
                      }}
                      wordtGesleept={gesleepteStapId === s.id}
                      doelDropPositie={
                        formulierDropDoel?.type === 'stap' &&
                        formulierDropDoel.stapId === s.id
                          ? formulierDropDoel.positie
                          : undefined
                      }
                      kanOmhoog={positie > 0}
                      kanOmlaag={positie < sectieStappen.length - 1}
                    />
                  ))}
                  {(() => {
                    return (
                      <div
                        className={
                          `sleep-einde be-stap-einde-dropzone` +
                          (
                            formulierDropDoel?.type === 'einde' &&
                            formulierDropDoel.sectieId === sec.id
                              ? ' drop-doel active'
                              : ''
                          ) +
                          (sectieStappen.length === 0 ? ' lege-sectie-dropzone' : '')
                        }
                        data-sectie-id={sec.id}
                        data-invoegpositie="einde"
                      >
                        <button className="btn-secundair klein" onClick={() => nieuwStap(sec.id)}>
                          + Stap in "{sec.naam}"
                        </button>
                        <span className="muted sleep-hint">
                          {gesleepteStapId
                            ? sectieStappen.length === 0
                              ? 'Zet de stap hier in deze lege sectie'
                              : 'Zet de stap hier onderaan'
                            : 'of sleep een stap hierheen'}
                        </span>
                      </div>
                    )
                  })()}
                </div>
              )
            })}
          </section>
        </div>

        <div className="bouwer-preview">
          {gezondheid && (
            <section className="be-blok">
              <div className="be-blok-kop">
                <h2>Gezondheid</h2>
                <span className={`gezond-score s${Math.floor(gezondheid.score / 25)}`}>
                  {Math.round(gezondheid.score)}
                </span>
              </div>
              {gezondheid.issues.length === 0 ? (
                <p className="muted">Geen aandachtspunten. 🎉</p>
              ) : (
                <ul className="gezond-lijst">
                  {gezondheid.issues.map((i, n) => (
                    <li key={n} className={`gi-${i.ernst}`}>
                      {i.bericht}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <section className="be-blok be-preview-blok">
            <div className="be-blok-kop">
              <h2>Live voorbeeld</h2>
              <div className="view-toggle">
                <button
                  className={preview === 'visualisatie' ? 'active' : ''}
                  onClick={() => setPreview('visualisatie')}
                >
                  🗺️ Visualisatie
                </button>
                <button className={preview === 'tabel' ? 'active' : ''} onClick={() => setPreview('tabel')}>
                  📋 Tabel
                </button>
              </div>
            </div>
            {proces.stappen.length === 0 ? (
              <div className="empty">Voeg stappen toe; de plaat en tabel tekenen zichzelf.</div>
            ) : preview === 'visualisatie' ? (
              <ProcessVisualisatie
                proces={proces}
                modus={visualisatie}
                onModusWijziging={setVisualisatie}
                onSelectStep={() => undefined}
              />
            ) : (
              <div className="be-preview-tabel">
                <TabelView proces={proces} />
              </div>
            )}
            {preview === 'visualisatie' &&
              visualisatie === 'brongetrouw' &&
              bronLayout &&
              (bronLayout.fouten.length > 0 || bronLayout.waarschuwingen.length > 0) && (
                <ul className="gezond-lijst">
                  {bronLayout.fouten.map((fout) => (
                    <li key={fout} className="gi-fout">
                      {fout}
                    </li>
                  ))}
                  {bronLayout.waarschuwingen.map((waarschuwing) => (
                    <li key={waarschuwing} className="gi-waarschuwing">
                      {waarschuwing}
                    </li>
                  ))}
                </ul>
              )}
          </section>

          <p className="muted">
            Concepten worden lokaal bewaard en verschijnen direct in <Link to="/">overzicht</Link>,{' '}
            <Link to="/atlas">atlas</Link> en <Link to="/begeleid">begeleide modus</Link>. Publicatie
            verloopt later via indienen → goedkeuren (backend).
          </p>
        </div>
      </div>
      )}
    </div>
  )
}
