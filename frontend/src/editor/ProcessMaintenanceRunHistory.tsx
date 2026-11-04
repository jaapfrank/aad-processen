import { useMemo, useState } from 'react'
import type { ProcessMaintenanceRunLedgerItem } from '@contract/ai-run-history'
import {
  deriveProcessMaintenanceRunPresentation,
  isActionableProcessMaintenanceRun,
  type ProcessMaintenanceRunPresentation,
} from '../lib/processMaintenanceRunHistory'
import './process-maintenance-run-history.css'

export interface ProcessMaintenanceRunHistoryController {
  items: readonly ProcessMaintenanceRunLedgerItem[]
  loading?: boolean
  error?: string
  busyRunId?: string
  currentProcessRevision?: number
  /**
   * Indien gezet, krijgt uitsluitend dit reeds geopende voorstel beslisknoppen.
   * Zonder id zijn alle runs alleen-lezen; de ledger bevat geen voorstelinhoud.
   */
  activeProposalRunId?: string
  onOpen?: () => void
  onRefresh?: () => void
  onAcceptInConcept?: (
    run: ProcessMaintenanceRunLedgerItem,
  ) => void | Promise<void>
  onReject?: (
    run: ProcessMaintenanceRunLedgerItem,
    reason?: string,
  ) => void | Promise<void>
}

export interface ProcessMaintenanceRunHistoryProps {
  controller: ProcessMaintenanceRunHistoryController
  onClose?: () => void
}

const PRESENTATION_LABELS: Record<ProcessMaintenanceRunPresentation, string> = {
  bezig: 'Bezig',
  voorstel: 'Voorstel',
  vragen: 'Vragen',
  'geen-wijziging': 'Geen wijziging',
  geaccepteerd: 'Geaccepteerd',
  afgewezen: 'Afgewezen',
  mislukt: 'Mislukt',
  verouderd: 'Verouderd',
  geannuleerd: 'Geannuleerd',
}

const DATE_FORMATTER = new Intl.DateTimeFormat('nl-NL', {
  dateStyle: 'short',
  timeStyle: 'short',
})

function formatInstant(value: string): string {
  return DATE_FORMATTER.format(new Date(value))
}

function plural(count: number, singular: string, pluralValue: string): string {
  return `${count} ${count === 1 ? singular : pluralValue}`
}

export function ProcessMaintenanceRunHistory({
  controller,
  onClose,
}: ProcessMaintenanceRunHistoryProps) {
  const [rejectRunId, setRejectRunId] = useState<string>()
  const [rejectReason, setRejectReason] = useState('')
  const sortedItems = useMemo(
    () => [...controller.items].sort(
      (left, right) => Date.parse(right.gestartOp) - Date.parse(left.gestartOp),
    ),
    [controller.items],
  )
  const activeProposalCount = useMemo(
    () => controller.items.filter((item) =>
      item.runId === controller.activeProposalRunId &&
      isActionableProcessMaintenanceRun(item, controller.currentProcessRevision)
    ).length,
    [
      controller.activeProposalRunId,
      controller.currentProcessRevision,
      controller.items,
    ],
  )

  const closeReject = () => {
    setRejectRunId(undefined)
    setRejectReason('')
  }

  return (
    <section className="pmrh-panel" aria-labelledby="pmrh-title">
      <header className="pmrh-header">
        <div>
          <h2 id="pmrh-title">AI-runhistorie</h2>
          <p>
            {plural(controller.items.length, 'run', 'runs')}
            {activeProposalCount > 0 && ' · 1 actief voorstel'}
          </p>
        </div>
        <div className="pmrh-header-actions">
          {controller.onRefresh && (
            <button
              type="button"
              disabled={controller.loading}
              onClick={controller.onRefresh}
            >
              Vernieuwen
            </button>
          )}
          {onClose && (
            <button type="button" aria-label="AI-runhistorie sluiten" onClick={onClose}>
              Sluiten
            </button>
          )}
        </div>
      </header>

      {controller.error && (
        <div className="pmrh-message pmrh-error" role="alert">
          <strong>Historie kon niet worden geladen.</strong>
          <span>{controller.error}</span>
        </div>
      )}
      {controller.loading && controller.items.length === 0 && (
        <div className="pmrh-message" role="status">AI-runhistorie laden…</div>
      )}
      {!controller.loading && !controller.error && controller.items.length === 0 && (
        <div className="pmrh-message">
          <strong>Nog geen AI-runs</strong>
          <span>Een onderhoudsanalyse verschijnt hier na de eerste run.</span>
        </div>
      )}

      {sortedItems.length > 0 && (
        <ol className="pmrh-list" aria-label="Eerdere AI-onderhoudsruns">
          {sortedItems.map((item) => {
            const presentation = deriveProcessMaintenanceRunPresentation(item)
            const actionable = isActionableProcessMaintenanceRun(
              item,
              controller.currentProcessRevision,
            )
            const isActiveProposal = controller.activeProposalRunId === item.runId
            const mayDecide = actionable && isActiveProposal
            const revisionMismatch =
              controller.currentProcessRevision !== undefined &&
              controller.currentProcessRevision !== item.processRevision
            const busy = controller.busyRunId === item.runId
            const rejecting = rejectRunId === item.runId

            return (
              <li className="pmrh-run" key={item.runId}>
                <div className="pmrh-run-main">
                  <span className={`pmrh-status pmrh-status-${presentation}`}>
                    {PRESENTATION_LABELS[presentation]}
                  </span>
                  <div className="pmrh-run-title">
                    <strong>{formatInstant(item.gestartOp)}</strong>
                    <span>
                      Revisie {item.processRevision} · door {item.gestartDoor}
                    </span>
                  </div>
                  <div className="pmrh-counts" aria-label="Resultaattellingen">
                    <span>{plural(item.vraagAantal, 'vraag', 'vragen')}</span>
                    <span>{plural(item.issueAantal, 'signaal', 'signalen')}</span>
                    <span>{plural(item.wijzigingAantal, 'wijziging', 'wijzigingen')}</span>
                  </div>
                </div>

                <div className="pmrh-run-meta">
                  <span>
                    {item.provider ?? 'Provider nog niet bepaald'}
                    {item.model ? ` · ${item.model}` : ''}
                  </span>
                  <span title={item.runId}>Run {item.runId.slice(0, 12)}</span>
                  {item.duurMs !== undefined && <span>{item.duurMs} ms</span>}
                  {item.foutcode && <span>Foutcode {item.foutcode}</span>}
                </div>

                {revisionMismatch && presentation === 'voorstel' && (
                  <p className="pmrh-revision-warning">
                    Dit voorstel hoort bij revisie {item.processRevision}; de werkversie is
                    revisie {controller.currentProcessRevision}. Het kan niet direct worden
                    toegepast.
                  </p>
                )}

                {item.feedback && (
                  <div className="pmrh-feedback">
                    <strong>
                      {item.feedback.beslissing === 'accepted'
                        ? 'In concept geaccepteerd'
                        : 'Afgewezen'}
                    </strong>
                    <span>
                      door {item.feedback.doorGebruiker} · {formatInstant(item.feedback.op)}
                    </span>
                    {item.feedback.beslissing === 'accepted' && (
                      <span>
                        {plural(
                          item.feedback.geaccepteerdeWijzigingIds.length,
                          'wijziging',
                          'wijzigingen',
                        )} vastgelegd
                      </span>
                    )}
                    {item.feedback.reden && <p>{item.feedback.reden}</p>}
                  </div>
                )}

                {actionable && !isActiveProposal && (
                  <p className="pmrh-history-boundary">
                    Alleen auditmetadata is bewaard. Een historisch voorstel kan daarom
                    niet opnieuw worden toegepast.
                  </p>
                )}

                {mayDecide && !rejecting && (
                  <div className="pmrh-actions">
                    {controller.onAcceptInConcept && (
                      <button
                        type="button"
                        className="pmrh-accept"
                        disabled={busy}
                        onClick={() => void controller.onAcceptInConcept?.(item)}
                      >
                        {busy
                          ? 'Beslissing vastleggen…'
                          : `Accepteer ${plural(
                              item.wijzigingAantal,
                              'wijziging',
                              'wijzigingen',
                            )} in concept`}
                      </button>
                    )}
                    {controller.onReject && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setRejectRunId(item.runId)
                          setRejectReason('')
                        }}
                      >
                        Afwijzen
                      </button>
                    )}
                  </div>
                )}

                {mayDecide && rejecting && (
                  <form
                    className="pmrh-reject-form"
                    onSubmit={(event) => {
                      event.preventDefault()
                      const reason = rejectReason.trim() || undefined
                      void controller.onReject?.(item, reason)
                    }}
                  >
                    <label htmlFor={`pmrh-reason-${item.runId}`}>
                      Reden voor afwijzing <span>(optioneel, geen persoonsgegevens)</span>
                    </label>
                    <textarea
                      id={`pmrh-reason-${item.runId}`}
                      value={rejectReason}
                      maxLength={160}
                      rows={2}
                      autoFocus
                      disabled={busy}
                      onChange={(event) => setRejectReason(event.target.value)}
                    />
                    <div>
                      <span>{rejectReason.length}/160</span>
                      <button type="button" disabled={busy} onClick={closeReject}>
                        Annuleren
                      </button>
                      <button type="submit" className="pmrh-reject" disabled={busy}>
                        {busy ? 'Vastleggen…' : 'Afwijzing vastleggen'}
                      </button>
                    </div>
                  </form>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
