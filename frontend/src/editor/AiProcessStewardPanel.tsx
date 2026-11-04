import type {
  ProcessMaintenanceAnalysis,
  ProcessMaintenanceIssue,
} from '@contract/ai-process-steward'
import { sourcesFor } from '../lib/aiProcessSteward'
import './AiProcessStewardPanel.css'

export type AiProcessStewardPhase =
  | 'idle'
  | 'saving'
  | 'analyzing'
  | 'vragen'
  | 'voorstel'
  | 'no-change'
  | 'accepting'
  | 'applied'
  | 'error'
  | 'stale'

/** UI-grens tussen editor en pagina-/API-orchestratie. */
export interface AiProcessStewardController {
  phase: AiProcessStewardPhase
  result?: ProcessMaintenanceAnalysis
  answers?: Readonly<Record<string, string>>
  error?: string
  staleReason?: string
  analyzeLabel?: string
  analyzeDisabled?: boolean
  analyzeDisabledReason?: string
  acceptDisabled?: boolean
  onAnalyze: () => void
  onAnswer?: (questionId: string, answer: string) => void
  onContinue?: () => void
  onAccept?: () => void
  onReject?: () => void
  onClose?: () => void
  onSelectIssue?: (issueId: string) => void
}

interface AiProcessStewardPanelProps {
  controller: AiProcessStewardController
  onFocusStep: (stepId: string, issue: ProcessMaintenanceIssue) => void
}

const veldLabels: Record<string, string> = {
  activiteit: 'Activiteit',
  toelichting: 'Toelichting',
  opmerking: 'Opmerking',
  zijnotitie: 'Zij-notitie',
  voorwaarde: 'Voorwaarde',
  erpStatus: 'ERP-status',
  termijn: 'Termijn',
  waarschuwing: 'Waarschuwing',
}

function formatValue(value: string | null): string {
  return value === null || value === '' ? '— leeg —' : value
}

function phaseTitle(phase: AiProcessStewardPhase): string {
  switch (phase) {
    case 'saving': return 'Concept voorbereiden…'
    case 'analyzing': return 'Procesonderhoud analyseren…'
    case 'vragen': return 'Aanvullende informatie nodig'
    case 'voorstel': return 'Controleerbaar onderhoudsvoorstel'
    case 'no-change': return 'Analyse afgerond'
    case 'accepting': return 'Menselijke beslissing vastleggen…'
    case 'applied': return 'Voorstel als concept verwerkt'
    case 'error': return 'Analyse niet gelukt'
    case 'stale': return 'Voorstel is verouderd'
    default: return 'AI Process Steward'
  }
}

export function AiProcessStewardPanel({
  controller,
  onFocusStep,
}: AiProcessStewardPanelProps) {
  if (controller.phase === 'idle') return null
  const result = controller.result
  const questions = result?.status === 'vragen' ? result.vragen : []
  const answers = controller.answers ?? {}
  const allAnswered =
    questions.length > 0 &&
    questions.every((question) => Boolean(answers[question.id]?.trim()))
  const busy =
    controller.phase === 'saving' ||
    controller.phase === 'analyzing' ||
    controller.phase === 'accepting'

  return (
    <section
      className={`ai-steward-panel ai-steward-${controller.phase}`}
      aria-label="AI Process Steward"
      aria-busy={busy}
    >
      <header className="ai-steward-header">
        <div>
          <span className="ai-steward-kicker">AI Process Steward</span>
          <h2>{phaseTitle(controller.phase)}</h2>
        </div>
        {controller.onClose && !busy && (
          <button
            type="button"
            className="ai-steward-close"
            aria-label="AI Process Steward sluiten"
            onClick={controller.onClose}
          >
            ×
          </button>
        )}
      </header>

      {(controller.phase === 'saving' || controller.phase === 'analyzing') && (
        <p className="ai-steward-progress" role="status">
          De opgeslagen procesrevisie, gezondheidsproblemen, kaders en open
          suggesties worden gecontroleerd.
        </p>
      )}

      {result?.samenvatting && !busy && (
        <p className="ai-steward-intro">{result.samenvatting}</p>
      )}

      {controller.phase === 'vragen' && questions.length > 0 && (
        <>
          <p className="ai-steward-intro">
            Deze antwoorden veranderen de procesbetekenis. De AI raadt ze daarom
            niet en gaat pas verder nadat jij ze hebt ingevuld.
          </p>
          <div className="ai-steward-questions">
            {questions.map((question) => (
              <label key={question.id}>
                <strong>{question.vraag}</strong>
                <span>{question.waarom}</span>
                {question.stapId && (
                  <button
                    type="button"
                    className="ai-steward-inline-link"
                    onClick={() =>
                      onFocusStep(question.stapId!, {
                        id: `question:${question.id}`,
                        stapId: question.stapId,
                        categorie: 'onduidelijkheid',
                        ernst: 'info',
                        titel: question.vraag,
                        bevinding: question.vraag,
                        uitleg: question.waarom,
                        bronIds: question.bronIds,
                      })
                    }
                  >
                    Toon betreffende stap
                  </button>
                )}
                <textarea
                  rows={2}
                  value={answers[question.id] ?? ''}
                  disabled={busy}
                  onChange={(event) =>
                    controller.onAnswer?.(question.id, event.target.value)
                  }
                />
              </label>
            ))}
          </div>
          <div className="ai-steward-actions">
            <button
              type="button"
              className="ai-steward-primary"
              disabled={!allAnswered || !controller.onContinue}
              onClick={controller.onContinue}
            >
              Antwoorden verwerken
            </button>
          </div>
        </>
      )}

      {controller.phase === 'voorstel' && result?.status === 'voorstel' && (
        <>
          <div className="ai-steward-summary">
            <strong>
              {result.issues.length} aandachtspunt(en) · {result.wijzigingen.length}{' '}
              tekstwijziging(en)
            </strong>
            <span>
              Processtructuur en handmatige posities blijven exact behouden.
            </span>
          </div>

          {result.issues.length > 0 && (
            <div className="ai-steward-issues" aria-label="AI-onderhoudssignalen">
              {result.issues.map((issue) => (
                <article
                  key={issue.id}
                  className={`ai-steward-issue ai-steward-severity-${issue.ernst}`}
                >
                  <div>
                    <strong>{issue.titel}</strong>
                    <span>{issue.bevinding}</span>
                    <span>{issue.uitleg}</span>
                  </div>
                  {issue.stapId && (
                    <button
                      type="button"
                      onClick={() => {
                        controller.onSelectIssue?.(issue.id)
                        onFocusStep(issue.stapId!, issue)
                      }}
                    >
                      Toon stap
                    </button>
                  )}
                  {sourcesFor(result, issue.bronIds).length > 0 && (
                    <ul className="ai-steward-citations" aria-label="Gebruikte bronnen">
                      {sourcesFor(result, issue.bronIds).map((source) => (
                        <li key={source.id}>{source.label}</li>
                      ))}
                    </ul>
                  )}
                </article>
              ))}
            </div>
          )}

          {result.wijzigingen.length > 0 && (
            <div className="ai-steward-diff" aria-label="Voorgestelde wijzigingen">
              <h3>Wijzigingsvoorstel</h3>
              {result.wijzigingen.map((change) => {
                const issue: ProcessMaintenanceIssue = {
                  id: `change:${change.id}`,
                  stapId: change.stapId,
                  categorie: 'consistentie',
                  ernst: 'info',
                  titel: change.reden,
                  bevinding: change.reden,
                  uitleg: change.reden,
                  bronIds: change.bronIds,
                }
                return (
                  <article key={change.id} className="ai-steward-change change-update">
                    <header>
                      <strong>{veldLabels[change.veld] ?? change.veld}</strong>
                      <button
                        type="button"
                        onClick={() => onFocusStep(change.stapId, issue)}
                      >
                        Toon stap
                      </button>
                    </header>
                    <p>{change.reden}</p>
                    <div className="ai-steward-before-after">
                      <div>
                        <span>Huidig</span>
                        <pre>{formatValue(change.oudeWaarde)}</pre>
                      </div>
                      <div>
                        <span>Voorgesteld</span>
                        <pre>{formatValue(change.nieuweWaarde)}</pre>
                      </div>
                    </div>
                  </article>
                )
              })}
            </div>
          )}

          <div className="ai-steward-actions">
            {result.wijzigingen.length > 0 && (
              <button
                type="button"
                className="ai-steward-primary"
                disabled={controller.acceptDisabled || !controller.onAccept}
                onClick={controller.onAccept}
              >
                Zet wijzigingen in concept
              </button>
            )}
            {result.wijzigingen.length > 0 && controller.onReject && (
              <button type="button" onClick={controller.onReject}>
                Voorstel afwijzen
              </button>
            )}
            {result.wijzigingen.length === 0 && controller.onClose && (
              <button type="button" onClick={controller.onClose}>
                Signalen sluiten
              </button>
            )}
          </div>
        </>
      )}

      {controller.phase === 'no-change' && (
        <p className="ai-steward-message ai-steward-success" role="status">
          Er zijn binnen de geselecteerde context geen veilige wijzigingen nodig.
        </p>
      )}

      {controller.phase === 'stale' && (
        <>
          <p className="ai-steward-message ai-steward-warning" role="alert">
            {controller.staleReason ??
              'De procesinhoud is na de analyse gewijzigd. Analyseer opnieuw om overschrijven te voorkomen.'}
          </p>
          <div className="ai-steward-actions">
            <button
              type="button"
              className="ai-steward-primary"
              disabled={controller.analyzeDisabled}
              onClick={controller.onAnalyze}
            >
              Opnieuw analyseren
            </button>
          </div>
        </>
      )}

      {controller.phase === 'error' && (
        <>
          <p className="ai-steward-message ai-steward-error" role="alert">
            {controller.error ?? 'De onderhoudsanalyse kon niet veilig worden verwerkt.'}
          </p>
          <div className="ai-steward-actions">
            <button
              type="button"
              disabled={controller.analyzeDisabled}
              onClick={controller.onAnalyze}
            >
              Opnieuw proberen
            </button>
          </div>
        </>
      )}

      {controller.phase === 'applied' && (
        <p className="ai-steward-message ai-steward-success" role="status">
          De tekstwijzigingen staan in de editor als niet-opgeslagen concept.
          Publicatie vereist nog steeds de normale review en goedkeuring.
        </p>
      )}
    </section>
  )
}
