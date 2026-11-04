import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { dataSource } from '../data'
import { useHasRole } from '../appState'
import type { ProcessSummary, Suggestion } from '../contract'
import type { BorgingIssue } from '@contract/iso'
import './Dashboard.css'

interface Stand {
  verversing: number
  processen?: ProcessSummary[]
  suggesties?: Suggestion[]
  signalen?: BorgingIssue[]
  fouten: string[]
}

export function Dashboard() {
  const magBewerken = useHasRole('bewerken')
  const magBeheren = useHasRole('beheren')
  const magGoedkeuren = useHasRole('goedkeuren')
  const magWijzigen = magBewerken || magBeheren
  const magReviewen = magWijzigen || magGoedkeuren
  const [stand, setStand] = useState<Stand>()
  const [verversing, setVerversing] = useState(0)

  useEffect(() => {
    if (!magReviewen) return
    let actief = true
    void Promise.allSettled([
      dataSource.getWorkspaceProcesses(),
      magWijzigen ? dataSource.getSuggestions('open') : Promise.resolve<Suggestion[]>([]),
      dataSource.getIsoOverview(),
    ]).then(([processen, suggesties, iso]) => {
      if (!actief) return
      setStand({
        verversing,
        processen: processen.status === 'fulfilled' ? processen.value.filter((p) => p.status !== 'gearchiveerd') : undefined,
        suggesties: suggesties.status === 'fulfilled' ? suggesties.value : undefined,
        signalen: iso.status === 'fulfilled' ? iso.value.signalen : undefined,
        fouten: [
          processen.status === 'rejected' ? 'De processen konden niet worden geladen.' : '',
          suggesties.status === 'rejected' ? 'Feedback kon niet worden geladen.' : '',
          iso.status === 'rejected' ? 'Borgingssignalen konden niet worden geladen.' : '',
        ].filter(Boolean),
      })
    })
    return () => { actief = false }
  }, [magReviewen, magWijzigen, verversing])

  if (!magReviewen) return <section className="empty"><h1>Je processen</h1><p>Vind de actuele werkwijze of doorloop een proces stap voor stap.</p><Link className="btn-primair" to="/">Bekijk processen</Link> <Link className="btn-secundair" to="/begeleid">Start begeleiding</Link></section>
  const geladen = stand?.verversing === verversing ? stand : undefined
  const reviews = geladen?.processen?.filter((p) => p.status === 'in-review')
  const concepten = geladen?.processen?.filter((p) => p.status === 'concept')
  const procesNaam = (id: string) => geladen?.processen?.find((p) => p.id === id)?.detailproces ?? id
  const prioriteiten = geladen?.signalen ? [...geladen.signalen].sort((a, b) => Number(b.ernst === 'fout') - Number(a.ernst === 'fout')) : undefined
  const procesLijst = (items: ProcessSummary[] | undefined, leeg: string) => items === undefined ? <p className="muted">Nog geen gegevens beschikbaar.</p>
    : !items.length ? <p className="muted">{leeg}</p> : <ul className="dash-lijst">{items.slice(0, 8).map((proces) => <li key={proces.id}>
      <Link to={'/proces/' + encodeURIComponent(proces.id) + '?workspace=1'}>{proces.detailproces}</Link>
      <span className="muted">{proces.hoofdproces} · {proces.laatsteWijziging}</span>
    </li>)}</ul>

  return <div className="dashboard werkplek">
    <header className="werkplek-kop"><div><span className="kicker">Procesbeheer</span><h1>Wat vraagt je aandacht?</h1><p className="muted">Maak werkwijzen bruikbaar voor collega's en volg wijzigingen, feedback en auditvoorbereiding op.</p></div>
      <button className="btn-secundair" disabled={!geladen} onClick={() => setVerversing((v) => v + 1)}>Verversen</button>
    </header>
    {magWijzigen && <section className="werkplek-acties" aria-label="Proces toevoegen">
      <Link to="/ai-diagram"><span aria-hidden="true">✦</span><h2>Van tekst naar proces</h2><p>Gebruik een bestaande beschrijving. AI helpt de stappen, rollen en ontbrekende informatie uitwerken.</p></Link>
      <Link to="/uitwisseling"><span aria-hidden="true">⇄</span><h2>Neem bestaand werk over</h2><p>Neem een Visio-diagram over, of importeer uit PDF, draw.io, Lucidchart of een tabel. Controleer het resultaat in de editor.</p></Link>
      <Link to="/bouwer"><span aria-hidden="true">＋</span><h2>Ontwerp een proces</h2><p>Leg samen de stappen en beslissingen vast. Diagram en werkinstructie blijven bij elkaar.</p></Link>
    </section>}
    {!geladen && <p role="status">Werkvoorraad laden…</p>}
    {geladen?.fouten.length ? <aside className="werkplek-waarschuwing" role="alert">{geladen.fouten.join(' ')} Ontbrekende gegevens tellen niet als nul. Gebruik Verversen om opnieuw te proberen.</aside> : null}
    {geladen?.processen?.length === 0 && <section className="be-blok"><h2>Begin met één herkenbaar proces</h2><p>Voeg een werkwijze toe, stel een eigenaar en reviewdatum in, laat de inhoud controleren en publiceer. Collega's kunnen de geldige versie vervolgens raadplegen en feedback geven.</p><Link to="/normcoach">Bepaal ook welke normvragen voor jullie organisatie relevant zijn →</Link></section>}
    <section className="werkplek-tellers" aria-label="Werkvoorraad">
      <div><strong>{reviews?.length ?? '—'}</strong><span>klaar voor beoordeling</span></div>
      <div><strong>{concepten?.length ?? '—'}</strong><span>concepten in bewerking</span></div>
      {magWijzigen && <div><strong>{geladen?.suggesties?.length ?? '—'}</strong><span>open feedbackmeldingen</span></div>}
      <div><strong>{geladen?.signalen?.length ?? '—'}</strong><span>borgingssignalen</span></div>
    </section>
    <div className="werkplek-kolommen">
      <section className="be-blok"><h2>{magGoedkeuren ? 'Beoordeel ingediende wijzigingen' : 'Wacht op beoordeling'}</h2><p className="muted">Open de versie en controleer de inhoud voordat deze beschikbaar komt voor medewerkers.</p>{procesLijst(reviews, 'Er staan geen processen klaar voor beoordeling.')}</section>
      <section className="be-blok"><h2>Werk verder aan concepten</h2>{procesLijst(concepten, 'Er staan geen open concepten.')}</section>
      <section className="be-blok"><h2>Bereid audits voor</h2><p className="muted">Begin bij ontbrekend eigenaarschap en verlopen reviews. Een leeg overzicht is geen certificeringsbesluit.</p>
        {prioriteiten === undefined ? <p>Signalen nog niet beschikbaar.</p> : prioriteiten.length === 0 ? <p>De huidige controles melden geen borgingssignalen.</p> : <ul className="dash-lijst">{prioriteiten.slice(0, 8).map((signaal, i) => <li key={signaal.procesId + '-' + signaal.signaal + '-' + i}>
          <Link to={'/proces/' + encodeURIComponent(signaal.procesId) + '?workspace=1'}>{procesNaam(signaal.procesId)}</Link><span>{signaal.bericht}</span>
        </li>)}</ul>}
        <div className="detail-tools"><Link className="btn-secundair" to="/normcoach">Open normtoets</Link><Link className="btn-tekst" to="/iso">Bekijk auditmatrix en export</Link></div>
      </section>
      {magWijzigen && <section className="be-blok"><h2>Gebruik feedback van collega's</h2>
        {geladen?.suggesties === undefined ? <p>Feedback nog niet beschikbaar.</p> : !geladen.suggesties.length ? <p>Er zijn geen open feedbackmeldingen.</p> : <ul className="dash-lijst">{[...geladen.suggesties].sort((a, b) => a.aangemaaktOp.localeCompare(b.aangemaaktOp)).slice(0, 8).map((suggestie) => <li key={suggestie.id}>
          <Link to={'/proces/' + encodeURIComponent(suggestie.procesId) + '?workspace=1'}>{procesNaam(suggestie.procesId)}</Link><span>{suggestie.tekst}</span><small className="muted">{suggestie.doorGebruiker} · {suggestie.aangemaaktOp.slice(0, 10)}</small>
        </li>)}</ul>}
        <Link className="btn-tekst" to="/beheer">Beoordeel en verwerk feedback →</Link>
      </section>}
    </div>
  </div>
}
