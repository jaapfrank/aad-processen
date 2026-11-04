import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { BorgingIssue, IsoOverview, ProcessSummary, Suggestion } from '../contract'
import type {
  AssuranceFrameworkCatalog,
  AssuranceMonitoringStatus,
  AssuranceQuestionnaire,
} from '@contract/assurance'
import { dataSource } from '../data'
import { useHasRole } from '../appState'
import './BeheersingAssurance.css'

interface Beheersingsbeeld {
  processen: ProcessSummary[]
  suggesties: Suggestion[]
  iso: IsoOverview
  catalogus: AssuranceFrameworkCatalog
  monitoring: AssuranceMonitoringStatus
  vragenlijsten: AssuranceQuestionnaire[]
}

function signaalStatus(signalen: BorgingIssue[]) {
  if (signalen.some((signaal) => signaal.ernst === 'fout')) {
    return { label: 'Actie nodig', klasse: 'kritiek' }
  }
  if (signalen.length > 0) return { label: 'Opvolgen', klasse: 'aandacht' }
  return { label: 'Geen signalen', klasse: 'op-orde' }
}

/**
 * Organisatiebrede ingang voor governance, risk en compliance.
 * De pagina gebruikt alleen bestaande, autoritatieve bronnen en doet dus geen
 * uitspraak over certificering of risicoacceptatie.
 */
export function Beheersing() {
  const magBewerken = useHasRole('bewerken')
  const magGoedkeuren = useHasRole('goedkeuren')
  const magBeheren = useHasRole('beheren')
  const magReviewen = magBewerken || magGoedkeuren || magBeheren
  const [beeld, setBeeld] = useState<Beheersingsbeeld | null>(null)
  const [fout, setFout] = useState('')
  const [runBezig, setRunBezig] = useState(false)
  const [runMelding, setRunMelding] = useState('')

  useEffect(() => {
    let actief = true
    void Promise.all([
      magReviewen
        ? dataSource.getWorkspaceProcesses()
        : dataSource.getProcesses(),
      dataSource.getSuggestions('open').catch(() => []),
      dataSource.getIsoOverview(),
      dataSource.getAssuranceFrameworks(),
      dataSource.getAssuranceMonitoringStatus(),
      magReviewen
        ? dataSource.getAssuranceQuestionnaires(undefined, 100)
        : Promise.resolve<AssuranceQuestionnaire[]>([]),
    ])
      .then(([processen, suggesties, iso, catalogus, monitoring, vragenlijsten]) => {
        if (!actief) return
        const actieveKaderIds = new Set(
          catalogus.kaders.filter((kader) => kader.actief).map((kader) => kader.id),
        )
        const isoRijen = iso.rijen.filter((rij) => actieveKaderIds.has(rij.norm))
        const isoInScope: IsoOverview = {
          ...iso,
          hoofdprocessen: [
            ...new Set(isoRijen.map((rij) => rij.hoofdproces)),
          ].sort((a, b) => a.localeCompare(b, 'nl-NL')),
          rijen: isoRijen,
          signalen: iso.signalen.filter(
            (signaal) => !signaal.norm || actieveKaderIds.has(signaal.norm),
          ),
        }
        setBeeld({
          processen,
          suggesties,
          iso: isoInScope,
          catalogus,
          monitoring,
          vragenlijsten,
        })
        setFout('')
      })
      .catch((error: unknown) => {
        if (!actief) return
        setFout(
          error instanceof Error
            ? error.message
            : 'Het beheersingsbeeld kon niet worden geladen.',
        )
      })
    return () => {
      actief = false
    }
  }, [magReviewen])

  const statistiek = useMemo(() => {
    if (!beeld) return null
    const gekozenNormen = beeld.catalogus.kaders.filter((kader) => kader.actief)
    const gekoppeldeProcessen = new Set(beeld.iso.rijen.map((rij) => rij.procesId))
    const kritiekeSignalen = beeld.iso.signalen.filter(
      (signaal) => signaal.ernst === 'fout',
    )
    const verlopenReviews = beeld.iso.signalen.filter(
      (signaal) => signaal.signaal === 'review-verlopen',
    )
    const zonderEigenaar = beeld.iso.signalen.filter(
      (signaal) => signaal.signaal === 'geen-eigenaar',
    )
    const liveProcessen = beeld.processen.filter((proces) => proces.status === 'live')
    const laatsteRun = beeld.monitoring.laatsteRun
    const assuranceKritiek =
      laatsteRun?.bevindingen.filter((bevinding) => bevinding.ernst === 'fout') ?? []
    const openToetsen = beeld.vragenlijsten.filter((vragenlijst) => vragenlijst.status === 'open')
    return {
      gekozenNormen,
      gekoppeldeProcessen,
      kritiekeSignalen,
      verlopenReviews,
      zonderEigenaar,
      liveProcessen,
      laatsteRun,
      assuranceKritiek,
      openToetsen,
      signaalStatus: signaalStatus(beeld.iso.signalen),
    }
  }, [beeld])

  if (fout) {
    return (
      <section className="beheersing-fout" role="alert">
        <h1>Organisatiebeheersing</h1>
        <p>{fout}</p>
        <button className="btn-secundair" type="button" onClick={() => window.location.reload()}>
          Opnieuw laden
        </button>
      </section>
    )
  }

  if (!beeld || !statistiek) return <p className="muted">Beheersingsbeeld laden…</p>

  const normTekst =
    statistiek.gekozenNormen.length > 0
      ? statistiek.gekozenNormen.map((kader) => kader.naam).join(', ')
      : 'Nog geen organisatiebrede normscope gekozen'

  const voerControleUit = async () => {
    setRunBezig(true)
    setRunMelding('')
    try {
      const run = await dataSource.startAssuranceRun()
      const monitoring = await dataSource.getAssuranceMonitoringStatus()
      setBeeld((huidig) => (huidig ? { ...huidig, monitoring } : huidig))
      setRunMelding(
        `Controle afgerond: ${run.findingCount} ${
          run.findingCount === 1 ? 'bevinding' : 'bevindingen'
        }.`,
      )
    } catch (error) {
      setRunMelding(
        error instanceof Error ? error.message : 'De controle kon niet worden uitgevoerd.',
      )
    } finally {
      setRunBezig(false)
    }
  }

  return (
    <div className="beheersing-page">
      <header className="beheersing-hero">
        <div>
          <span className="beheersing-kicker">Organisatiebeheersing</span>
          <h1>Beheersing</h1>
          <p>
            Bekijk wat aandacht vraagt en volg controles en verbeteringen op.
          </p>
        </div>
        <div className="beheersing-hero-acties">
          {magReviewen ? (
            <Link className="btn-primair" to="/normcoach">
              Start normtoets
            </Link>
          ) : (
            <Link className="btn-primair" to="/iso">
              Bekijk borgingssignalen
            </Link>
          )}
          {magBeheren && (
            <Link className="btn-secundair" to="/beheer?tab=normen">
              Normenkader instellen
            </Link>
          )}
        </div>
      </header>

      {(statistiek.kritiekeSignalen.length + statistiek.assuranceKritiek.length > 0 ||
        beeld.monitoring.achterstallig) && (
        <Link
          className="beheersing-prioriteit"
          to={magReviewen ? '/normcoach' : '/iso'}
        >
          <span aria-hidden="true">!</span>
          <strong>
            {statistiek.kritiekeSignalen.length + statistiek.assuranceKritiek.length} kritiek
            {statistiek.kritiekeSignalen.length + statistiek.assuranceKritiek.length === 1
              ? ' beheersingssignaal'
              : 'e beheersingssignalen'}
          </strong>
          <small>Bekijk de oorzaak, bepaal een maatregel en leg de opvolging vast.</small>
          <b aria-hidden="true">→</b>
        </Link>
      )}

      <section className="beheersing-assurance" aria-labelledby="assurance-actueel-titel">
        <div className="beheersing-sectiekop">
          <div>
            <h2 id="assurance-actueel-titel">Geplande controles</h2>
            <p className="muted">
              Op basis van jullie normen, toetsen en procesafspraken.
            </p>
          </div>
          {magReviewen && (
            <button
              className="btn-secundair"
              type="button"
              disabled={runBezig}
              onClick={() => void voerControleUit()}
            >
              {runBezig ? 'Controleren…' : 'Controle nu uitvoeren'}
            </button>
          )}
        </div>
        <div className="beheersing-assurance-meta">
          <span className={`beheersing-status ${beeld.monitoring.achterstallig ? 'kritiek' : 'op-orde'}`}>
            {beeld.monitoring.achterstallig ? 'Achterstallig' : 'Planning actief'}
          </span>
          <span>
            Elke {beeld.monitoring.effectiefIntervalUren} uur · volgende run{' '}
            {new Intl.DateTimeFormat('nl-NL', {
              dateStyle: 'medium',
              timeStyle: 'short',
            }).format(new Date(beeld.monitoring.volgendeRunOp))}
          </span>
          {runMelding && <strong role="status">{runMelding}</strong>}
        </div>
        {statistiek.laatsteRun ? (
          <>
            <div className="beheersing-run-kop">
              <strong>
                Laatste controle · {statistiek.laatsteRun.findingCount}{' '}
                {statistiek.laatsteRun.findingCount === 1 ? 'bevinding' : 'bevindingen'}
              </strong>
              <span>
                {new Intl.DateTimeFormat('nl-NL', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                }).format(
                  new Date(
                    statistiek.laatsteRun.afgerondOp ??
                      statistiek.laatsteRun.gestartOp,
                  ),
                )}
              </span>
            </div>
            {statistiek.laatsteRun.bevindingen.length === 0 ? (
              <p className="beheersing-geen-bevindingen">
                Geen aandachtspunten gevonden in deze controle. Beoordeel ook de werking in de praktijk.
              </p>
            ) : (
              <ul className="beheersing-bevindingen">
                {statistiek.laatsteRun.bevindingen.slice(0, 8).map((bevinding) => (
                  <li key={bevinding.id} className={`ernst-${bevinding.ernst}`}>
                    <span aria-hidden="true">
                      {bevinding.ernst === 'fout' ? '!' : bevinding.ernst === 'waarschuwing' ? '△' : 'i'}
                    </span>
                    <div>
                      <strong>{bevinding.titel}</strong>
                      <p>{bevinding.bericht}</p>
                    </div>
                    {bevinding.procesId && (magBewerken || magBeheren) ? (
                      <Link
                        to={`/bouwer/${encodeURIComponent(bevinding.procesId)}?${new URLSearchParams({
                          bevinding: bevinding.id,
                          ...(bevinding.kaderId ? { kader: bevinding.kaderId } : {}),
                        }).toString()}`}
                      >
                        Markeer in editor →
                      </Link>
                    ) : bevinding.procesId ? (
                      <Link to={`/proces/${encodeURIComponent(bevinding.procesId)}`}>
                        Bekijk processignaal →
                      </Link>
                    ) : magReviewen ? (
                      <Link to="/normcoach">Open in Normcoach →</Link>
                    ) : (
                      <span>Organisatiebreed signaal</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="beheersing-geen-bevindingen">
            Er is nog geen controle uitgevoerd. De achtergrondcontrole start automatisch; je kunt
            hem hierboven ook direct afdwingen.
          </p>
        )}
        <p className="beheersing-assurance-grens">
          Deze controle levert interne readinessbevindingen op. Alleen een bevoegde mens beslist
          over toepasselijkheid, maatregel, effectiviteit en sluiting.
        </p>
      </section>

      <section aria-labelledby="beheersingsbeeld-titel">
        <div className="beheersing-sectiekop">
          <div>
            <h2 id="beheersingsbeeld-titel">Actueel beheersingsbeeld</h2>
            <p className="muted">Gebaseerd op de huidige normkoppelingen en procesgegevens.</p>
          </div>
          <span className={`beheersing-status ${statistiek.signaalStatus.klasse}`}>
            {statistiek.signaalStatus.label}
          </span>
        </div>
        <div className="beheersing-kpis">
          <article>
            <strong>{statistiek.gekozenNormen.length}</strong>
            <span>kaders in organisatiescope</span>
            <small>{normTekst}</small>
          </article>
          <article>
            <strong>{statistiek.laatsteRun?.findingCount ?? '—'}</strong>
            <span>bevindingen laatste controle</span>
            <small>
              {beeld.monitoring.achterstallig
                ? 'Controle is achterstallig'
                : `Volgende: ${new Intl.DateTimeFormat('nl-NL').format(
                    new Date(beeld.monitoring.volgendeRunOp),
                  )}`}
            </small>
          </article>
          <article>
            <strong>{statistiek.openToetsen.length}</strong>
            <span>lopende normtoetsen</span>
            <small>{statistiek.gekoppeldeProcessen.size} processen met normkoppeling</small>
          </article>
          <article>
            <strong>{beeld.suggesties.length}</strong>
            <span>open verbetervoorstellen</span>
            <small>{statistiek.liveProcessen.length} live processen</small>
          </article>
        </div>
      </section>

      <section aria-labelledby="domeinen-titel">
        <div className="beheersing-sectiekop">
          <div>
            <h2 id="domeinen-titel">Domeinen</h2>
            <p className="muted">
              Processen zijn één onderdeel van het totale managementsysteem.
            </p>
          </div>
        </div>
        <div className="beheersing-domeinen">
          <article className="beheersing-domein">
            <div className="beheersing-domein-kop">
              <span className="beheersing-domein-icon" aria-hidden="true">
                ◎
              </span>
              <span className="beheersing-status neutraal">
                {statistiek.gekozenNormen.length || 'Inrichten'}
              </span>
            </div>
            <h3>Normen &amp; verplichtingen</h3>
            <p>
              Bepaal welke normen in scope zijn en houd alleen relevante eisen en controles
              zichtbaar.
            </p>
            <div className="beheersing-domein-acties">
              {magReviewen ? (
                <Link to="/normcoach">Normcoach openen</Link>
              ) : (
                <Link to="/iso">Normoverzicht openen</Link>
              )}
              {magBeheren && (
                <Link to="/beheer?tab=normen">Scope instellen</Link>
              )}
            </div>
          </article>

          <article className="beheersing-domein">
            <div className="beheersing-domein-kop">
              <span className="beheersing-domein-icon" aria-hidden="true">
                △
              </span>
              <span
                className={`beheersing-status ${
                  statistiek.kritiekeSignalen.length ? 'kritiek' : 'op-orde'
                }`}
              >
                {statistiek.kritiekeSignalen.length} kritiek
              </span>
            </div>
            <h3>Risico’s &amp; maatregelen</h3>
            <p>
              Gebruik norm- en borgingssignalen als concrete aanleiding voor een maatregel. Dit is
              nog geen formeel risicoregister of risicoacceptatie.
            </p>
            <div className="beheersing-domein-acties">
              <Link to="/iso">Signalen beoordelen</Link>
            </div>
          </article>

          <article className="beheersing-domein">
            <div className="beheersing-domein-kop">
              <span className="beheersing-domein-icon" aria-hidden="true">
                ✓
              </span>
              <span className="beheersing-status neutraal">
                {statistiek.openToetsen.length} lopend
              </span>
            </div>
            <h3>Audits &amp; bewijs</h3>
            <p>
              Toets controles, leg de menselijke beoordeling vast en verzamel herleidbaar bewijs
              voor de gekozen scope.
            </p>
            <div className="beheersing-domein-acties">
              {magReviewen && <Link to="/normcoach">Begeleide toets openen</Link>}
              <Link to="/iso#auditmatrix">Procesmatrix openen</Link>
              {magBeheren && <Link to="/beheer?tab=audit">Technisch auditlog</Link>}
            </div>
          </article>

          <article className="beheersing-domein">
            <div className="beheersing-domein-kop">
              <span className="beheersing-domein-icon" aria-hidden="true">
                ↻
              </span>
              <span
                className={`beheersing-status ${
                  beeld.monitoring.achterstallig ? 'kritiek' : 'op-orde'
                }`}
              >
                {beeld.monitoring.achterstallig ? 'Achterstallig' : 'Controle actief'}
              </span>
            </div>
            <h3>Borging &amp; opvolging</h3>
            <p>
              Maak eigenaarschap, reviewritme en open verbeteringen zichtbaar zodat beheersing
              blijft leven.
            </p>
            <div className="beheersing-domein-acties">
              <Link to="/dashboard">Werkvoorraad bekijken</Link>
              {magBeheren && (
                <Link to="/beheer?tab=normen">Controlecyclus instellen</Link>
              )}
            </div>
          </article>

          <article className="beheersing-domein">
            <div className="beheersing-domein-kop">
              <span className="beheersing-domein-icon" aria-hidden="true">
                ▤
              </span>
              <span className="beheersing-status neutraal">
                {beeld.processen.length} processen
              </span>
            </div>
            <h3>Processen &amp; werkwijzen</h3>
            <p>
              Verbind beleid en controles met de dagelijkse uitvoering en houd werkwijzen
              aantoonbaar actueel.
            </p>
            <div className="beheersing-domein-acties">
              <Link to="/">Processen openen</Link>
              {magBewerken && <Link to="/bouwer">Proces aanpassen</Link>}
            </div>
          </article>
        </div>
      </section>

      <section className="beheersing-cyclus" aria-labelledby="controlecyclus-titel">
        <div className="beheersing-cyclus-intro">
          <span className="beheersing-kicker">Continue beheersing</span>
          <h2 id="controlecyclus-titel">Van normkeuze naar aantoonbare werking</h2>
          <p>
            De gekozen normscope stuurt wat gecontroleerd wordt. Een hogere controlefrequentie mag
            altijd; de ingestelde ondergrens voorkomt dat controles ongemerkt minder vaak
            plaatsvinden.
          </p>
        </div>
        <ol>
          <li>
            <span>1</span>
            <div>
              <strong>Kies de scope</strong>
              <small>Normen, toepasselijkheid en minimale controlefrequentie.</small>
            </div>
          </li>
          <li>
            <span>2</span>
            <div>
              <strong>Beantwoord &amp; toets</strong>
              <small>Vragen, bewijs en afwijkingen per eis of controle.</small>
            </div>
          </li>
          <li>
            <span>3</span>
            <div>
              <strong>Verbeter de uitvoering</strong>
              <small>Maatregelen vertalen naar eigenaarschap en proceswijzigingen.</small>
            </div>
          </li>
          <li>
            <span>4</span>
            <div>
              <strong>Controleer opnieuw</strong>
              <small>Nieuwe wijzigingen en verlopen bewijs blijven zichtbaar.</small>
            </div>
          </li>
        </ol>
        {magReviewen && (
          <Link className="btn-secundair" to="/normcoach">
            Normcoach starten
          </Link>
        )}
        {magBeheren && (
          <Link className="btn-secundair" to="/beheer?tab=normen">
            Controleprofiel beheren
          </Link>
        )}
      </section>
    </div>
  )
}
