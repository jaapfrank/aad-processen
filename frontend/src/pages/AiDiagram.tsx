import { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { dataSource } from '../data'
import { useHasRole } from '../appState'
import { TabelView } from '../components/TabelView'
import { buildAiIntakePrompt, parseAiIntakeResponse } from '../lib/aiIntake'
import type { Step } from '../contract'
import {
  ProcessVisualisatie,
  type ProcessVisualisatieModus,
} from '../visualisaties'
import {
  buildAiDiagramPrompt,
  emptyDiagramCompleteness,
  getCompletenessQuestions,
  handoffAiDiagram,
  isCompletenessReady,
  mergeCompleteness,
  parseAiDiagramResponse,
  validateAiDiagram,
  type AiDiagramResult,
  type DiagramCompleteness,
  type DiagramCompletenessKey,
} from '../lib/aiDiagram'

type Phase = 'beschrijven' | 'herkennen' | 'verduidelijken' | 'analyseren' | 'preview'

const START_TEXT = 'Noem wie het werk doet, wat het proces start en wanneer het klaar is. Vermeld ook beslissingen en uitzonderingen.'

export function AiDiagram() {
  const navigate = useNavigate()
  const magBewerken = useHasRole('bewerken')
  const magBeheren = useHasRole('beheren')
  const location = useLocation()
  const [description, setDescription] = useState(() => typeof location.state?.beschrijving === 'string' ? location.state.beschrijving : '')
  const [answers, setAnswers] = useState<DiagramCompleteness>(emptyDiagramCompleteness)
  const [phase, setPhase] = useState<Phase>('beschrijven')
  const [result, setResult] = useState<AiDiagramResult | null>(null)
  const [followUpNote, setFollowUpNote] = useState('')
  const [uncertaintyAnswers, setUncertaintyAnswers] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [selectedStep, setSelectedStep] = useState<Step | null>(null)
  const [previewMode, setPreviewMode] = useState<'visualisatie' | 'tabel'>('visualisatie')
  const [visualisatie, setVisualisatie] = useState<ProcessVisualisatieModus>('brongetrouw')
  const [accepted, setAccepted] = useState(false)
  const [intakeMelding, setIntakeMelding] = useState('')
  const bezig = phase === 'analyseren' || phase === 'herkennen'

  const questions = useMemo(
    () => getCompletenessQuestions(description, answers),
    [description, answers],
  )
  const validation = useMemo(() => (result ? validateAiDiagram(result) : null), [result])
  const completeness = useMemo(() => mergeCompleteness(description, answers), [description, answers])

  const updateAnswer = (key: DiagramCompletenessKey, value: string) => {
    setAnswers((current) => ({ ...current, [key]: value }))
  }

  const checkCompleteness = async () => {
    setError('')
    if (!description.trim()) {
      setError('Beschrijf eerst het proces.')
      return
    }
    if (!questions.length) { void analyse(); return }
    setPhase('herkennen')
    setIntakeMelding('')
    try {
      const response = await dataSource.askAi(buildAiIntakePrompt(description))
      const gevonden = parseAiIntakeResponse(response, description)
      setAnswers((bestaand) => Object.fromEntries(Object.entries(gevonden).map(([key, value]) => [key, bestaand[key as DiagramCompletenessKey] || value])) as unknown as DiagramCompleteness)
      setIntakeMelding('Informatie uit je tekst is alvast ingevuld. Controleer de velden en vul aan wat nog ontbreekt.')
    } catch {
      setIntakeMelding('Automatisch herkennen is niet gelukt. Je tekst is behouden; vul de ontbrekende informatie hieronder zelf aan.')
    }
    setPhase('verduidelijken')
  }

  const analyse = async (revisionNote?: string) => {
    if (!isCompletenessReady(description, answers)) {
      setPhase('verduidelijken')
      setError('Beantwoord eerst alle structurele vragen. Schrijf “geen” als er geen beslissingen zijn.')
      return
    }
    setError('')
    setAccepted(false)
    setPhase('analyseren')
    try {
      const prompt = buildAiDiagramPrompt(description, answers, result ?? undefined, revisionNote)
      const response = await dataSource.askAi(prompt)
      const parsed = parseAiDiagramResponse(response)
      setResult(parsed)
      setUncertaintyAnswers(
        Object.fromEntries(
          parsed.uncertainties
            .filter((uncertainty) => uncertainty.blocking)
            .map((uncertainty) => [uncertainty.id, '']),
        ),
      )
      setSelectedStep(null)
      setFollowUpNote('')
      setPhase('preview')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Het diagram kon niet worden geanalyseerd.')
      setPhase(result ? 'preview' : 'verduidelijken')
    }
  }

  const transferToBuilder = () => {
    if (!result || !validation || validation.blockers.length) return
    if (!accepted) {
      setError('Bevestig eerst dat je rollen, volgorde en beslisroutes in de preview hebt gecontroleerd.')
      return
    }
    try {
      handoffAiDiagram(result)
      navigate('/bouwer')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Overdracht naar de bouwer is geblokkeerd.')
    }
  }

  if (!magBewerken && !magBeheren) {
    return (
      <div className="empty">
        De AI-procesontwerper is alleen beschikbaar voor procesredacteuren. Er wordt via deze pagina
        nooit rechtstreeks gepubliceerd.
      </div>
    )
  }

  const blockingUncertainties = result?.uncertainties.filter((item) => item.blocking) ?? []
  const uncertaintiesAnswered =
    blockingUncertainties.length > 0 &&
    blockingUncertainties.every((item) => uncertaintyAnswers[item.id]?.trim())

  return (
    <div className="ai-diagram-pagina">
      <div className="bouwer-kop">
        <div>
          <span className="kicker">AI-procesontwerp</span>
          <h1>Maak een proces van je beschrijving</h1>
          <p className="muted">
            Beschrijf jullie werkwijze. AI helpt je er een bewerkbaar proces van te maken.
          </p>
        </div>
      </div>

      <section className="be-blok">
        <h2>1. Beschrijf het proces</h2>
        <details className="ui-help"><summary>Wat zet ik in de beschrijving?</summary><p>{START_TEXT}</p></details>
        <label className="ai-tekstbestand">Of kies een tekstbestand (.txt, .md)
          <input type="file" accept=".txt,.md,text/plain,text/markdown" disabled={bezig} onChange={(event) => {
            const bestand = event.target.files?.[0]
            event.target.value = ''
            if (!bestand) return
            if (bestand.size > 100_000) { setError('Kies een tekstbestand van maximaal 100 KB.'); return }
            void bestand.text().then((tekst) => {
              setDescription(tekst); setAnswers(emptyDiagramCompleteness()); setResult(null); setAccepted(false); setPhase('beschrijven'); setError(''); setIntakeMelding('')
            }).catch(() => setError('Het tekstbestand kon niet worden geopend.'))
          }} />
        </label>
        <textarea
          rows={9}
          value={description}
          disabled={bezig}
          aria-label="Procesbeschrijving"
          maxLength={50000}
          placeholder="Bijvoorbeeld: zodra een medewerker een wijzigingsverzoek indient, beoordeelt de proceseigenaar de impact. Bij goedkeuring plant de beheerder de uitvoering. Bij afwijzing krijgt de medewerker een toelichting…"
          onChange={(event) => {
            setDescription(event.target.value)
            setAnswers(emptyDiagramCompleteness())
            setResult(null)
            setAccepted(false)
            setPhase('beschrijven')
            setIntakeMelding('')
          }}
          style={{ width: '100%' }}
        />
        <div className="detail-tools">
          <button className="btn-primair" disabled={bezig || !description.trim()} onClick={() => void checkCompleteness()}>
                {phase === 'herkennen' ? 'Informatie herkennen…' : 'Analyseer mijn beschrijving'}
          </button>
        </div>
      </section>
      {intakeMelding && <p role="status">{intakeMelding}</p>}
      {phase === 'herkennen' && <p role="status">De AI zoekt de procesnaam, rollen, start, afronding en beslissingen in je beschrijving…</p>}

      {(phase === 'verduidelijken' || (phase === 'analyseren' && !result)) && (
        <section className="be-blok">
          <h2>2. Controleer en vul aan</h2>
          <p className="muted">
            Alleen ontbrekende informatie wordt gevraagd. Rollen, routes en standaardkeuzes worden
            nooit stilzwijgend ingevuld.
          </p>
          {getCompletenessQuestions(description, emptyDiagramCompleteness()).map((question) => (
            <label key={question.id} className="breed" style={{ display: 'block', marginBottom: '1rem' }}>
              <strong>{question.question}</strong>
              <span className="muted" style={{ display: 'block' }}>{question.reason}</span>
              <textarea
                rows={2}
                value={answers[question.id]}
                disabled={phase === 'analyseren'}
                placeholder={question.placeholder}
                onChange={(event) => updateAnswer(question.id, event.target.value)}
                style={{ width: '100%' }}
              />
            </label>
          ))}
          <div className="detail-tools">
            <button
              className="btn-primair"
              disabled={phase === 'analyseren' || !isCompletenessReady(description, answers)}
              onClick={() => void analyse()}
            >
              {phase === 'analyseren' ? 'AI analyseert…' : 'Maak diagram-preview'}
            </button>
          </div>
        </section>
      )}

      {phase === 'analyseren' && (
        <section className="be-blok">
          <h2>AI analyseert…</h2>
          <p className="muted">Daarna controleren we of de stappen, routes en verwijzingen op elkaar aansluiten.</p>
        </section>
      )}

      {error && <div className="empty" role="alert">{error}</div>}

      {result && validation && (
        <>
          <section className="be-blok">
            <div className="be-blok-kop">
              <h2>3. Validatie</h2>
              <span className={`gezond-score s${validation.blockers.length ? 0 : 4}`}>
                {validation.blockers.length ? `${validation.blockers.length} blokkers` : 'Valide'}
              </span>
            </div>
            {validation.blockers.length > 0 && (
              <>
                <h3>Moet eerst worden opgelost</h3>
                <ul className="gezond-lijst">
                  {validation.blockers.map((item, index) => (
                    <li key={`${item.code}-${item.stepId ?? index}`} className="gi-fout">
                      {item.message}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {validation.warnings.length > 0 && (
              <>
                <h3>Zichtbare aannames en waarschuwingen</h3>
                <ul className="gezond-lijst">
                  {validation.warnings.map((item, index) => (
                    <li key={`${item.code}-${item.stepId ?? index}`} className="gi-waarschuwing">
                      {item.message}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {!validation.blockers.length && !validation.warnings.length && (
              <p className="muted">De stappen, rollen en routes sluiten op elkaar aan. Controleer ook of het voorstel overeenkomt met jullie werkwijze.</p>
            )}
          </section>

          {blockingUncertainties.length > 0 && (
            <section className="be-blok">
              <h2>3a. Beantwoord de open vragen</h2>
              <p className="muted">
                De AI mag deze punten niet zelf invullen. Elk antwoord wordt opnieuw door de
                processtructuur verwerkt en gecontroleerd.
              </p>
              {blockingUncertainties.map((uncertainty) => (
                <label
                  key={uncertainty.id}
                  className="breed"
                  style={{ display: 'block', marginBottom: '1rem' }}
                >
                  <strong>{uncertainty.question}</strong>
                  <span className="muted" style={{ display: 'block' }}>
                    Betreft: {uncertainty.field}
                  </span>
                  <textarea
                    rows={2}
                    value={uncertaintyAnswers[uncertainty.id] ?? ''}
                    disabled={phase === 'analyseren'}
                    onChange={(event) =>
                      setUncertaintyAnswers((current) => ({
                        ...current,
                        [uncertainty.id]: event.target.value,
                      }))
                    }
                    style={{ width: '100%' }}
                  />
                </label>
              ))}
              <button
                className="btn-primair"
                disabled={!uncertaintiesAnswered || phase === 'analyseren'}
                onClick={() =>
                  void analyse(
                    blockingUncertainties
                      .map(
                        (uncertainty) =>
                          `Vraag: ${uncertainty.question}\nBevestigd antwoord: ${uncertaintyAnswers[
                            uncertainty.id
                          ].trim()}`,
                      )
                      .join('\n\n'),
                  )
                }
              >
                Verwerk antwoorden en valideer opnieuw
              </button>
            </section>
          )}

          <section className="be-blok">
            <div className="be-blok-kop">
              <h2>4. Preview</h2>
              <div className="view-toggle">
                <button
                  className={previewMode === 'visualisatie' ? 'active' : ''}
                  onClick={() => setPreviewMode('visualisatie')}
                >
                  Visualisatie
                </button>
                <button
                  className={previewMode === 'tabel' ? 'active' : ''}
                  onClick={() => setPreviewMode('tabel')}
                >
                  Tabel
                </button>
              </div>
            </div>
            <p>
              <strong>{result.process.detailproces}</strong> · doel: {completeness.doel}
            </p>
            {previewMode === 'visualisatie' ? (
              <ProcessVisualisatie
                proces={result.process}
                modus={visualisatie}
                onModusWijziging={setVisualisatie}
                onSelectStep={setSelectedStep}
              />
            ) : (
              <TabelView proces={result.process} onSelect={setSelectedStep} />
            )}
            {selectedStep && (
              <div className="be-blok">
                <span className="kicker">Geselecteerde stap {selectedStep.nummer}</span>
                <h3>{selectedStep.activiteit}</h3>
                <p className="muted">
                  Lane: {result.process.lanes.find((lane) => lane.id === selectedStep.laneId)?.naam}
                  {selectedStep.voorwaarde ? ` · Voorwaarde: ${selectedStep.voorwaarde}` : ''}
                </p>
              </div>
            )}
          </section>

          <section className="be-blok">
            <h2>5. Gericht verbeteren</h2>
            <p className="muted">
              Beschrijf alleen wat moet veranderen. Bij heranalyse moeten bestaande ids, routes en
              verwijzingen behouden blijven tenzij jouw notitie ze expliciet wijzigt.
            </p>
            <textarea
              rows={3}
              value={followUpNote}
              disabled={phase === 'analyseren'}
              placeholder="Bijvoorbeeld: De beslissing over schade heeft twee routes: ja naar schade registreren, nee naar product testen."
              onChange={(event) => setFollowUpNote(event.target.value)}
              style={{ width: '100%' }}
            />
            <button
              className="btn-secundair"
              disabled={phase === 'analyseren' || !followUpNote.trim()}
              onClick={() => void analyse(followUpNote)}
            >
              Heranalyseer met deze notitie
            </button>
          </section>

          <section className="be-blok">
            <h2>6. Menselijke acceptatie</h2>
            {validation.blockers.length ? (
              <p className="muted">
                Overdracht is geblokkeerd. Los de structurele aandachtspunten op via een gerichte
                vervolgvraag.
              </p>
            ) : (
              <>
                <label className="rol-optie">
                  <input
                    type="checkbox"
                    checked={accepted}
                    onChange={(event) => setAccepted(event.target.checked)}
                  />
                  Ik heb rollen, volgorde, start, einde en beslisroutes in deze preview gecontroleerd.
                </label>
                <p className="muted">
                  Overdragen plaatst alleen een tijdelijk concept in sessionStorage. In de bouwer
                  moet je daarna nog afzonderlijk op “Opslaan als concept” klikken.
                </p>
                <button className="btn-primair" disabled={!accepted} onClick={transferToBuilder}>
                  Accepteren voor procesbouwer
                </button>
              </>
            )}
          </section>
        </>
      )}
    </div>
  )
}
