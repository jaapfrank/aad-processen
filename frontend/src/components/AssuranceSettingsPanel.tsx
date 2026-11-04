import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  AssuranceFrameworkCatalog,
  AssuranceMonitoringStatus,
  AssuranceRun,
  AssuranceSettings,
} from '@contract/assurance'
import { dataSource } from '../data'
import { AssuranceFrameworkDraftManager } from './AssuranceFrameworkDraftManager'
import './AssuranceSettingsPanel.css'

const intervalNaam: Record<number, string> = {
  24: 'Dagelijks',
  168: 'Wekelijks',
  720: 'Maandelijks',
}

function datumTijd(waarde?: string) {
  if (!waarde) return 'Nog niet uitgevoerd'
  return new Intl.DateTimeFormat('nl-NL', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(waarde))
}

function foutmelding(error: unknown) {
  return error instanceof Error ? error.message : 'De wijziging kon niet worden verwerkt.'
}

/**
 * Beheer van de organisatiebrede normscope en het minimale controleprofiel.
 * Monitoring heeft bewust geen uit-schakelaar: een organisatie kan het ritme
 * aanscherpen, maar niet onder de server-side beleidsgrens zetten.
 */
export function AssuranceSettingsPanel() {
  const [catalogus, setCatalogus] = useState<AssuranceFrameworkCatalog | null>(null)
  const [instellingen, setInstellingen] = useState<AssuranceSettings | null>(null)
  const [monitoring, setMonitoring] = useState<AssuranceMonitoringStatus | null>(null)
  const [gekozenIds, setGekozenIds] = useState<string[]>([])
  const [intervalUren, setIntervalUren] = useState<number>(168)
  const [bezig, setBezig] = useState(false)
  const [runBezig, setRunBezig] = useState(false)
  const [aiIntakeOpen, setAiIntakeOpen] = useState(false)
  const [melding, setMelding] = useState('')
  const [fout, setFout] = useState('')

  const laad = useCallback(async () => {
    try {
      const [volgendeCatalogus, volgendeInstellingen, volgendeMonitoring] =
        await Promise.all([
          dataSource.getAssuranceFrameworks(),
          dataSource.getAssuranceSettings(),
          dataSource.getAssuranceMonitoringStatus(),
        ])
      setCatalogus(volgendeCatalogus)
      setInstellingen(volgendeInstellingen)
      setMonitoring(volgendeMonitoring)
      setGekozenIds(volgendeInstellingen.actieveKaderIds)
      setIntervalUren(volgendeInstellingen.aangevraagdIntervalUren)
      setFout('')
    } catch (error) {
      setFout(foutmelding(error))
    }
  }, [])

  useEffect(() => {
    void Promise.resolve().then(laad)
  }, [laad])

  const toegestaneIntervallen = useMemo(
    () =>
      (instellingen?.toegestaneIntervalUren ?? []).filter(
        (uren) => uren <= (instellingen?.maximaalIntervalUren ?? uren),
      ),
    [instellingen],
  )

  const gewijzigd =
    !!instellingen &&
    (intervalUren !== instellingen.aangevraagdIntervalUren ||
      gekozenIds.join('|') !== instellingen.actieveKaderIds.join('|'))

  const wisselKader = (id: string) => {
    setMelding('')
    setGekozenIds((huidig) =>
      huidig.includes(id) ? huidig.filter((waarde) => waarde !== id) : [...huidig, id],
    )
  }

  const slaOp = async () => {
    if (!instellingen || gekozenIds.length === 0) {
      setFout('Kies minimaal één normenkader voor de organisatie.')
      return
    }
    setBezig(true)
    setFout('')
    setMelding('')
    try {
      const opgeslagen = await dataSource.saveAssuranceSettings({
        expectedRevision: instellingen.revision,
        actieveKaderIds: gekozenIds,
        aangevraagdIntervalUren: intervalUren as 24 | 168 | 720,
      })
      setInstellingen(opgeslagen)
      setGekozenIds(opgeslagen.actieveKaderIds)
      setIntervalUren(opgeslagen.aangevraagdIntervalUren)
      setMelding(
        'Normscope opgeslagen. Dagelijkse schermen tonen voortaan alleen deze kaders.',
      )
      setMonitoring(await dataSource.getAssuranceMonitoringStatus())
    } catch (error) {
      setFout(foutmelding(error))
    } finally {
      setBezig(false)
    }
  }

  const voerControleUit = async () => {
    setRunBezig(true)
    setFout('')
    setMelding('')
    try {
      const run = await dataSource.startAssuranceRun()
      setMelding(
        `Interne controle afgerond met ${run.findingCount} ${
          run.findingCount === 1 ? 'bevinding' : 'bevindingen'
        }.`,
      )
      setMonitoring(await dataSource.getAssuranceMonitoringStatus())
    } catch (error) {
      setFout(foutmelding(error))
    } finally {
      setRunBezig(false)
    }
  }

  if (!catalogus || !instellingen || !monitoring) {
    return (
      <section className="assurance-instellingen" aria-busy="true">
        <h2>Normscope &amp; continue controle</h2>
        {fout ? (
          <div className="callout fout" role="alert">
            <p>{fout}</p>
            <button className="btn-secundair" type="button" onClick={() => void laad()}>
              Opnieuw laden
            </button>
          </div>
        ) : (
          <p className="muted">Instellingen laden…</p>
        )}
      </section>
    )
  }

  const laatsteRun = monitoring.laatsteRun

  return (
    <section className="assurance-instellingen">
      <header className="assurance-instellingen-kop">
        <div>
          <span className="beheersing-kicker">Managementsysteem</span>
          <h2>Normscope &amp; continue controle</h2>
          <p>
            Kies wat voor deze organisatie in scope is. De rest verdwijnt uit het dagelijkse
            werkbeeld, maar blijft beschikbaar in deze catalogus.
          </p>
        </div>
        <span className="assurance-catalogus-versie">
          Catalogus {catalogus.catalogVersion}
        </span>
      </header>

      <div className="assurance-statusbalk">
        <div>
          <span>Continue controle</span>
          <strong>
            <i aria-hidden="true">●</i> Verplicht actief
          </strong>
        </div>
        <div>
          <span>Effectief ritme</span>
          <strong>
            {intervalNaam[instellingen.effectiefIntervalUren] ??
              `${instellingen.effectiefIntervalUren} uur`}
          </strong>
        </div>
        <div>
          <span>Volgende controle</span>
          <strong>{datumTijd(monitoring.volgendeRunOp)}</strong>
        </div>
        <div>
          <span>Laatste controle</span>
          <strong>{datumTijd(laatsteRun?.afgerondOp ?? laatsteRun?.gestartOp)}</strong>
        </div>
      </div>

      {monitoring.achterstallig && (
        <div className="callout waarschuwing" role="alert">
          De verplichte controle is achterstallig. Voer hem nu uit; de geplande cyclus blijft
          daarnaast actief.
        </div>
      )}

      <details
        className="assurance-ai-details"
        open={aiIntakeOpen}
        onToggle={(event) => setAiIntakeOpen(event.currentTarget.open)}
      >
        <summary>
          <span aria-hidden="true">✨</span>
          <span>
            <strong>Kader met AI voorbereiden</strong>
            <small>
              Voeg een ISO-norm, wet of ander kader als gecontroleerd concept toe
            </small>
          </span>
        </summary>
        {aiIntakeOpen && (
          <div className="assurance-ai-details-inhoud">
            <AssuranceFrameworkDraftManager onCatalogChanged={laad} />
          </div>
        )}
      </details>

      <div className="assurance-instellingen-grid">
        <div>
          <h3>1. Kaders in scope</h3>
          <p className="muted">
            Alleen geselecteerde kaders worden gebruikt door de Normcoach en de automatische
            controle.
          </p>
          <div className="assurance-kaderkeuze">
            {catalogus.kaders.map((kader) => {
              const gekozen = gekozenIds.includes(kader.id)
              return (
                <div className={`assurance-kaderkaart${gekozen ? ' gekozen' : ''}`} key={kader.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={gekozen}
                      onChange={() => wisselKader(kader.id)}
                    />
                    <span>
                      <strong>{kader.naam}</strong>
                      <small>
                        {kader.editie} · {kader.domein}
                      </small>
                      <small>
                        Bron: {kader.bronOrganisatie} · gecontroleerd{' '}
                        {new Intl.DateTimeFormat('nl-NL').format(
                          new Date(kader.bronGecontroleerdOp),
                        )}
                      </small>
                    </span>
                  </label>
                  <a
                    href={kader.bronUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Officiële bron
                  </a>
                </div>
              )
            })}
          </div>
          {gekozenIds.length === 0 && (
            <p className="veld-fout" role="alert">
              Minimaal één kader moet actief blijven.
            </p>
          )}
        </div>

        <div className="assurance-ritme">
          <h3>2. Controlefrequentie</h3>
          <p>
            Kies een strenger ritme of houd de organisatiegrens aan. Minder vaak dan de
            beleidsgrens is niet mogelijk.
          </p>
          <label>
            Gewenst controle-interval
            <select
              value={intervalUren}
              onChange={(event) => setIntervalUren(Number(event.target.value))}
            >
              {toegestaneIntervallen.map((uren) => (
                <option key={uren} value={uren}>
                  {intervalNaam[uren] ?? `Elke ${uren} uur`}
                </option>
              ))}
            </select>
          </label>
          <div className="assurance-slot">
            <span aria-hidden="true">🔒</span>
            <div>
              <strong>Ondergrens is afgedwongen</strong>
              <p>
                Monitoring kan niet worden uitgezet en het interval kan niet ruimer worden dan{' '}
                {intervalNaam[instellingen.maximaalIntervalUren] ??
                  `${instellingen.maximaalIntervalUren} uur`}.
              </p>
            </div>
          </div>

          <h3>3. Direct controleren</h3>
          <p>
            Deze interne assurancecontrole zoekt ontbrekende of onvolledige normtoetsen en
            procesborging. Dit is geen certificeringsaudit.
          </p>
          <button
            className="btn-secundair"
            type="button"
            disabled={runBezig}
            onClick={() => void voerControleUit()}
          >
            {runBezig ? 'Controle uitvoeren…' : 'Voer verplichte controle nu uit'}
          </button>
          {laatsteRun && <LaatsteRun run={laatsteRun} />}
        </div>
      </div>

      <div className="assurance-opslaan">
        <button
          className="btn-primair"
          type="button"
          disabled={bezig || !gewijzigd || gekozenIds.length === 0}
          onClick={() => void slaOp()}
        >
          {bezig ? 'Opslaan…' : 'Normscope opslaan'}
        </button>
        {melding && <span className="succes-tekst" role="status">{melding}</span>}
        {fout && <span className="veld-fout" role="alert">{fout}</span>}
      </div>

    </section>
  )
}

function LaatsteRun({ run }: { run: AssuranceRun }) {
  return (
    <div className="assurance-laatste-run">
      <span>Laatste run</span>
      <strong>
        {run.status === 'completed' ? 'Afgerond' : run.status} · {run.findingCount}{' '}
        {run.findingCount === 1 ? 'bevinding' : 'bevindingen'}
      </strong>
      <small>{datumTijd(run.afgerondOp ?? run.gestartOp)}</small>
    </div>
  )
}
