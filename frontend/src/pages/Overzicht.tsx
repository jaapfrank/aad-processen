import { useEffect, useMemo, useState } from 'react'
import { dataSource } from '../data'
import { Link, useSearchParams } from 'react-router-dom'
import { useFavorieten } from '../store/favorieten'
import { useHasRole } from '../appState'
import type { ProcessSummary } from '../contract'
import { leesRecenteProcesIds } from '../lib/begeleideRoute'

export function Overzicht() {
  const [items, setItems] = useState<ProcessSummary[] | null>(null)
  const { ids: favorieten, wissel } = useFavorieten()
  const magBewerken = useHasRole('bewerken')
  const magBeheren = useHasRole('beheren')
  const magGoedkeuren = useHasRole('goedkeuren')
  const magWerkversies = magBewerken || magBeheren || magGoedkeuren
  const [parameters, setParameters] = useSearchParams()
  const werkversies = magWerkversies && parameters.get('weergave') !== 'gepubliceerd'
  const procesLink = (id: string) => `/proces/${encodeURIComponent(id)}${werkversies ? '?workspace=1' : ''}`
  const [signalen, setSignalen] = useState<number | null>(null)
  const [fout, setFout] = useState('')
  const [signaalFout, setSignaalFout] = useState(false)
  const [poging, setPoging] = useState(0)

  useEffect(() => {
    let actief = true
    void (werkversies ? dataSource.getWorkspaceProcesses() : dataSource.getProcesses()).then((processen) => {
      if (actief) setItems(processen)
    }).catch((error: unknown) => {
      if (actief) setFout(error instanceof Error ? error.message : 'Processen ophalen is mislukt.')
    })
    if (magBewerken || magBeheren) {
      void dataSource.getIsoOverview().then((overzicht) => {
        if (actief) setSignalen(overzicht.signalen.length)
      }).catch(() => { if (actief) setSignaalFout(true) })
    }
    return () => { actief = false }
  }, [poging, magBewerken, magBeheren, werkversies])

  const opnieuw = () => {
    setItems(null)
    setFout('')
    setSignalen(null)
    setSignaalFout(false)
    setPoging((waarde) => waarde + 1)
  }

  const recent = useMemo(() => {
    if (!items) return []
    const ids = leesRecenteProcesIds(() => localStorage.getItem('spg-recent'))
    return ids.map((id) => items.find((p) => p.id === id)).filter((p): p is ProcessSummary => Boolean(p))
  }, [items])

  const gesorteerd = useMemo(() => {
    if (!items) return null
    return [...items].sort((a, b) => {
      const fa = favorieten.includes(a.id) ? 0 : 1
      const fb = favorieten.includes(b.id) ? 0 : 1
      return fa - fb || a.detailproces.localeCompare(b.detailproces)
    })
  }, [items, favorieten])

  if (fout) return <div><h1>Processen</h1><p role="alert">{fout}</p><button className="btn-primair" onClick={opnieuw}>Opnieuw proberen</button></div>
  if (!gesorteerd) return <div><h1>Processen</h1><p className="muted" role="status">Processen laden…</p></div>

  return (
    <div>
      <div className="bouwer-kop"><h1>Processen</h1>{(magBewerken || magBeheren) && <Link className="btn-primair" to="/bouwer">Nieuw proces</Link>}</div>
      {magWerkversies && <div className="view-toggle" aria-label="Procesweergave">
        <button aria-pressed={werkversies} className={werkversies ? 'active' : ''} onClick={() => { if (!werkversies) { setItems(null); setFout(''); setParameters({weergave: 'werkversies'}) } }}>Werkversies</button>
        <button aria-pressed={!werkversies} className={!werkversies ? 'active' : ''} onClick={() => { if (werkversies) { setItems(null); setFout(''); setParameters({weergave: 'gepubliceerd'}) } }}>Gepubliceerd</button>
      </div>}
      {werkversies && <p className="muted">Hier staan je opgeslagen concepten en actuele werkversies. Medewerkers zien pas de goedgekeurde, gepubliceerde versie.</p>}
      {(magBewerken || magBeheren) && signalen !== null && signalen > 0 && (
        <Link to="/iso" className="review-banner">
          🛡️ {signalen} borging-signa{signalen === 1 ? 'al' : 'len'} (reviews/eigenaarschap) — bekijk ISO & audit
        </Link>
      )}
      {(magBewerken || magBeheren) && signaalFout && <p role="status">Borgingssignalen konden niet worden opgehaald. <Link to="/iso">Open Normen & audits om opnieuw te controleren.</Link></p>}
      {gesorteerd.length === 0 && <div className="empty"><h2>{werkversies ? 'Nog geen opgeslagen processen' : 'Nog geen gepubliceerde processen'}</h2><p>{werkversies ? 'Sla een proces in de editor op als concept om het hier terug te vinden.' : 'Goedgekeurde werkwijzen verschijnen hier voor medewerkers.'}</p>{(magBewerken || magBeheren) ? <p><Link to="/bouwer">Maak een proces</Link> of <Link to="/uitwisseling">importeer een bestaande werkwijze</Link>.</p> : <p>Vraag je proceseigenaar wanneer de eerste werkwijze beschikbaar is.</p>}</div>}
      <p className="muted">
        Klik een proces om de stappen en werkinstructie te bekijken; ⭐ zet favorieten bovenaan.
      </p>
      {recent.length > 0 && (
        <p className="recent-rij muted">
          🕘 Recent bekeken:{' '}
          {recent.map((p, i) => (
            <span key={p.id}>
              {i > 0 && ' · '}
              <Link to={procesLink(p.id)}>{p.detailproces}</Link>
            </span>
          ))}
        </p>
      )}
      <div className="card-grid">
        {gesorteerd.map((p) => (
          <article key={p.id} className="card">
            <div className="card-top">
              <span className="kicker">{p.hoofdproces}</span>
              <span className="card-top-rechts">
                <button
                  className={`fav-knop${favorieten.includes(p.id) ? ' aan' : ''}`}
                  aria-label={favorieten.includes(p.id) ? 'Verwijder uit favorieten' : 'Markeer als favoriet'}
                  title={favorieten.includes(p.id) ? 'Verwijder uit favorieten' : 'Markeer als favoriet'}
                  onClick={(e) => {
                    e.preventDefault()
                    wissel(p.id)
                  }}
                >
                  {favorieten.includes(p.id) ? '⭐' : '☆'}
                </button>
                <span className={`pill pill-${p.status}`}>{p.status}</span>
              </span>
            </div>
            <h3><Link to={procesLink(p.id)}>{p.detailproces}</Link></h3>
            <div className="card-meta">
              <span>{p.versie}</span>
              <span>{p.aantalStappen} stappen</span>
              {p.koppelingen.length > 0 && <span>{p.koppelingen.length} koppelingen</span>}
            </div>
            <div className="detail-tools">
              <Link to={procesLink(p.id)}>Openen</Link>
              {(magBewerken || magBeheren) && p.status !== 'gearchiveerd' && <Link className="btn-secundair" to={`/bouwer/${encodeURIComponent(p.id)}`}>Bewerken</Link>}
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
