import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { dataSource } from '../data'
import { useHasRole } from '../appState'
import { IsoKoppeling } from '../components/IsoKoppeling'
import { ProceskaderScan } from '../components/ProceskaderScan'
import type { IsoNorm, IsoOverview } from '../contract'

const normen: Array<{ id: IsoNorm; label: string; sub: string }> = [
  { id: 'iso27001', label: 'ISO 27001', sub: 'Informatiebeveiliging' },
  { id: 'iso9001', label: 'ISO 9001', sub: 'Kwaliteit' },
  { id: 'iso14001', label: 'ISO 14001', sub: 'Milieu' },
]

export function Iso() {
  const magBewerken = useHasRole('bewerken')
  const magBeheren = useHasRole('beheren')
  const [versie, setVersie] = useState(0)
  const [gekozenNorm, setNorm] = useState<IsoNorm>('iso9001')
  const [geladen, setGeladen] = useState<IsoOverview | null>(null)
  const [actieveKaderIds, setActieveKaderIds] = useState<string[] | null>(null)
  const [scopeFout, setScopeFout] = useState('')

  useEffect(() => {
    void dataSource
      .getAssuranceFrameworks()
      .then((catalogus) => {
        setActieveKaderIds(
          catalogus.kaders.filter((kader) => kader.actief).map((kader) => kader.id),
        )
        setScopeFout('')
      })
      .catch((error: unknown) => {
        setScopeFout(
          error instanceof Error
            ? error.message
            : 'De gekozen normscope kon niet worden geladen.',
        )
      })
  }, [])

  const zichtbareNormen = useMemo(
    () =>
      actieveKaderIds === null
        ? []
        : normen.filter((kader) => actieveKaderIds.includes(kader.id)),
    [actieveKaderIds],
  )

  const norm = zichtbareNormen.find((kader) => kader.id === gekozenNorm)?.id
    ?? zichtbareNormen[0]?.id ?? gekozenNorm

  useEffect(() => {
    void dataSource.getIsoOverview(norm).then(setGeladen)
  }, [norm, versie])

  // Toon alleen data die bij de gekozen norm hoort (voorkomt verouderde weergave).
  const overview = geladen && geladen.norm === norm ? geladen : null

  return (
    <div>
      <h1>Normen &amp; audits</h1>
      <p className="muted">
        Controleer processen, koppel normen en volg reviewdata en ontbrekend bewijs op.
      </p>
      <p>
        Liever stap voor stap toetsen? Open de{' '}
        <Link to="/normcoach">Normcoach</Link>.
      </p>
      <details className="iso-werkwijze">
        <summary>Hoe werkt auditvoorbereiding?</summary>
        <ol>
          <li>
            <strong>Scan:</strong> kies hieronder een proces en kader. Je krijgt automatisch
            gevonden signalen, aandachtspunten en controles die een mens moet beoordelen.
          </li>
          <li>
            <strong>Oplossen:</strong> open een aandachtspunt in de proceseditor, pas het proces aan
            en voer de scan opnieuw uit.
          </li>
          <li>
            <strong>Beoordelen:</strong> start voor één kader de handmatige beoordeling. Leg per
            controle de uitkomst, uitleg en bij “voldoet” een bewijsreferentie vast.
          </li>
          <li>
            <strong>Borgen:</strong> koppel onder de scan norm, clausules, eigenaar en
            reviewmomenten. Controleer daarna de auditmatrix en los borgingssignalen op.
          </li>
        </ol>
        <p>
          De auditmatrix en beoordelingen gaan over procesborging.{' '}
          {magBeheren ? (
            <>
              <Link to="/beheer?tab=audit">Beheer &gt; Audit-log</Link> is het technische logboek
              met wie welke systeemactie wanneer uitvoerde.
            </>
          ) : (
            <>
              <strong>Beheer &gt; Audit-log</strong> is een apart technisch logboek met wie welke
              systeemactie wanneer uitvoerde.
            </>
          )}{' '}
          Geen van beide verleent een certificaat.
        </p>
      </details>

      {scopeFout && <p className="pk-fout" role="alert">{scopeFout}</p>}
      {actieveKaderIds === null && !scopeFout ? (
        <p className="muted">Gekozen normscope laden…</p>
      ) : (
        <ProceskaderScan actieveKaderIds={actieveKaderIds ?? []} />
      )}

      {(magBewerken || magBeheren) && zichtbareNormen.length > 0 && (
        <IsoKoppeling
          actieveKaderIds={actieveKaderIds ?? []}
          onOpgeslagen={() => setVersie((v) => v + 1)}
        />
      )}

      <div className="iso-normen">
        {zichtbareNormen.map((n) => (
          <button
            key={n.id}
            className={`iso-norm${norm === n.id ? ' active' : ''}`}
            onClick={() => setNorm(n.id)}
          >
            <strong>{n.label}</strong>
            <span>{n.sub}</span>
          </button>
        ))}
      </div>

      {actieveKaderIds !== null && zichtbareNormen.length === 0 ? (
        <div className="empty">
          Geen van de actieve kaders gebruikt deze procesmatrix. Niet-geselecteerde ISO-kaders
          blijven verborgen; open de Normcoach voor de actieve organisatiebrede toets.
        </div>
      ) : !overview ? (
        <p className="muted">Laden…</p>
      ) : overview.rijen.length === 0 ? (
        <div className="empty">
          Nog geen processen gekoppeld aan {normen.find((n) => n.id === norm)?.label}. Koppeling van
          processen aan normen doe je hierboven bij ‘Proces aan normen koppelen’.
        </div>
      ) : (
        <>
          {overview.signalen.length > 0 && (
            <div className="iso-signalen">
              <h2>⚠️ Borging-signalen ({overview.signalen.length})</h2>
              <ul>
                {overview.signalen.map((s, i) => (
                  <li key={i} className={`gi-${s.ernst}`}>
                    <Link to={`/proces/${s.procesId}`}>{s.procesId}</Link>: {s.bericht}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <h2>Auditmatrix</h2>
          <div className="table-scroll" role="region" aria-label="Auditmatrix" tabIndex={0}><table className="werkinstructie iso-matrix">
            <thead>
              <tr>
                <th>Proces</th>
                <th>Rol</th>
                <th>Clausules</th>
                <th>Eigenaar</th>
                <th>Status</th>
                <th>Laatste review</th>
                <th>Volgende review</th>
              </tr>
            </thead>
            <tbody>
              {overview.rijen.map((r) => (
                <tr key={`${r.procesId}-${r.norm}`} className={r.borging.length ? 'iso-rij-let-op' : ''}>
                  <td>
                    <Link to={`/proces/${r.procesId}`}>{r.detailproces}</Link>
                  </td>
                  <td>
                    <span className={`pill ${r.rol === 'kern' ? 'pill-live' : 'pill-concept'}`}>{r.rol}</span>
                  </td>
                  <td>{r.clausules.join(', ') || '—'}</td>
                  <td>{r.eigenaar ?? <em className="gi-fout">ontbreekt</em>}</td>
                  <td>
                    <span className={`pill pill-${r.status}`}>{r.status}</span>
                  </td>
                  <td>{r.laatsteReview ?? '—'}</td>
                  <td>{r.volgendeReview ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table></div>

          <p className="muted">
            Gegenereerd op {new Date(overview.gegenereerdOp).toLocaleString('nl-NL')} · hoofdprocessen
            in scope: {overview.hoofdprocessen.join(', ') || '—'}
          </p>
          {dataSource.heeftBackend && (
            <a className="btn-secundair" href={dataSource.isoExportUrl(norm)} download>
              📄 Audit-export downloaden (bewijslast)
            </a>
          )}
        </>
      )}
    </div>
  )
}
