import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { dataSource } from '../data'
import type { Process, ProcessSummary, Step } from '../contract'
import { begeleidePositie, begeleideStartpunten, begeleideStapProbleem, type RouteBevestiging } from '../lib/begeleideRoute'
import './begeleid.css'

function StapKaart({ proces, stap, training, onBevestig }: {
  proces: Process; stap: Step; training: boolean; onBevestig: (bevestiging: RouteBevestiging) => void
}) {
  const [afvink, setAfvink] = useState<number[]>([])
  const kopRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => { kopRef.current?.focus() }, [])
  const rol = proces.lanes.find((lane) => lane.id === stap.laneId)
  const probleem = begeleideStapProbleem(proces, stap)
  const checklistKlaar = (stap.checklist?.length ?? 0) === afvink.length
  return (
    <section className="bm-kaart" style={{ borderTopColor: rol?.kleur }} aria-labelledby="begeleid-stap-titel">
      <div className="bm-kaart-head"><span className="sl-nr" style={{ background: rol?.kleur }}>{stap.nummer}</span><span className="bm-rol">{rol?.naam ?? stap.laneId}</span></div>
      <h2 id="begeleid-stap-titel" ref={kopRef} tabIndex={-1}>{stap.activiteit}</h2>
      {stap.voorwaarde && <p className="sl-cond">Voorwaarde: {stap.voorwaarde}</p>}
      {stap.toelichting && <p>{stap.toelichting}</p>}
      {stap.opmerking && <p className="bm-opm">{stap.opmerking}</p>}
      {stap.termijn && <p><strong>Termijn:</strong> {stap.termijn}</p>}
      {stap.waarschuwing && <p className="bm-waarschuwing">{stap.waarschuwing}</p>}
      {stap.erpStatus && <p className="bm-erp">Systeemstatus: {stap.erpStatus}</p>}
      {stap.zijnotitie && <p>{stap.zijnotitie}</p>}
      {(stap.systeemGebeurtenissen?.length ?? 0) > 0 && <div><h3>Bijbehorende systeemactiviteiten</h3><ul>{stap.systeemGebeurtenissen!.map((item) => <li key={item.id}>{item.positie === 'voor' ? 'Vooraf' : 'Daarna'}: {item.activiteit}</li>)}</ul></div>}
      {(stap.fotoEisen?.length ?? 0) > 0 && <div><h3>Benodigde foto's</h3><ul>{stap.fotoEisen!.map((eis, index) => <li key={index}>{eis}</li>)}</ul></div>}
      {(stap.checklist?.length ?? 0) > 0 && (
        <fieldset className="begeleid-checklist"><legend>{training ? 'Oefen de controlepunten' : 'Controleer voor je verdergaat'}</legend>
          {stap.checklist!.map((punt, index) => <label key={index}><input type="checkbox" checked={afvink.includes(index)} onChange={(event) => setAfvink(event.target.checked ? [...afvink, index] : afvink.filter((id) => id !== index))} />{punt}</label>)}
        </fieldset>
      )}
      {stap.naarProces && stap.type === 'subproces' && <p className="bm-sub">Voer het gekoppelde proces uit volgens deze instructie:{' '}<Link to={`/proces/${encodeURIComponent(stap.naarProces)}`} target="_blank" rel="noreferrer">Open gekoppeld proces in een nieuw tabblad</Link>.</p>}
      {probleem ? (
        <div role="alert" className="begeleid-melding"><strong>De route kan hier niet verder.</strong><p>{probleem}</p><Link to={`/proces/${encodeURIComponent(proces.id)}`} target="_blank" rel="noreferrer">Bekijk het proces en meld een suggestie</Link></div>
      ) : stap.type === 'beslissing' ? (
        <fieldset className="begeleid-beslissing"><legend>Kies de route die bij jouw situatie past</legend>
          <p className="muted">Beoordeel de voorwaarden zelf. Alleen de gekozen route wordt gevolgd.</p>
          <div className="bm-ingangen">{stap.routes!.map((route) => (
            <button key={route.id} className="bm-ingang" disabled={!checklistKlaar} onClick={() => onBevestig({ stapId: stap.id, routeId: route.id })}>
              <strong>{route.label}</strong>{route.voorwaarde && <span>{route.voorwaarde}</span>}{route.standaard && <span className="muted">Overige situaties</span>}
            </button>
          ))}</div>
        </fieldset>
      ) : (
        <div className="bm-acties">
          <button className="btn-primair" disabled={!checklistKlaar} onClick={() => onBevestig({ stapId: stap.id })}>{stap.type === 'eind' ? 'Bevestig het einde van deze route' : training ? 'Stap geoefend — verder' : 'Stap uitgevoerd — verder'}</button>
          {stap.voorwaarde && stap.naarStap && stap.type !== 'eind' && <button className="btn-secundair" onClick={() => onBevestig({ stapId: stap.id, overgeslagen: true })}>Niet van toepassing — overslaan</button>}
        </div>
      )}
    </section>
  )
}

function RouteLoop({ proces, startId, training, onStop }: {
  proces: Process; startId: string; training: boolean; onStop: () => void
}) {
  const [historie, setHistorie] = useState<RouteBevestiging[]>([])
  const [kopieMelding, setKopieMelding] = useState('')
  const positie = begeleidePositie(proces, startId, historie)
  const afgerond = positie.soort === 'klaar' || positie.soort === 'overdracht'
  const bevestig = (keuze: RouteBevestiging) => { setHistorie([...historie, keuze]); setKopieMelding('') }
  const regels = historie.map((keuze, index) => {
    const stap = proces.stappen.find((item) => item.id === keuze.stapId)!
    const route = stap.routes?.find((item) => item.id === keuze.routeId)
    return `${index + 1}. ${stap.activiteit} — ${keuze.overgeslagen ? 'niet van toepassing' : route ? `keuze: ${route.label}` : training ? 'geoefend' : 'door gebruiker bevestigd'}`
  })
  const overdracht = [
    training ? 'OEFENING — geen uitgevoerde werkzaamheden' : 'Persoonlijke routenotitie — geen formeel uitvoerings- of auditbewijs',
    `${proces.detailproces} · ${proces.versie} · gewijzigd op ${proces.laatsteWijziging}`,
    afgerond ? positie.soort === 'overdracht' ? 'Overdracht naar een ander proces; dat vervolg is nog niet bevestigd.' : 'Het gekozen pad is afgerond.' : 'Route nog niet afgerond.',
    '', ...regels, ...(positie.soort === 'overdracht' ? ['', `Vervolgproces: ${positie.procesId}`] : []),
  ].join('\n')
  return (
    <div className="bm-loop">
      <p className="begeleid-context"><strong>{proces.detailproces}</strong> · {proces.versie} · {historie.length} {historie.length === 1 ? 'stap' : 'stappen'} bevestigd</p>
      <p className={training ? 'bm-training' : 'begeleid-lokaal'}>{training ? 'Oefenmodus. ' : ''}Voortgang blijft alleen op deze geopende pagina. Bij sluiten of vernieuwen begin je opnieuw.</p>
      {positie.soort === 'stap' && <StapKaart key={`${positie.stap.id}:${historie.length}`} proces={proces} stap={positie.stap} training={training} onBevestig={bevestig} />}
      {positie.soort === 'geblokkeerd' && <p role="alert" className="begeleid-melding">{positie.melding}</p>}
      {afgerond && (
        <section className="bm-klaar">
          <h2>{positie.soort === 'overdracht' ? 'Overdracht naar het vervolgproces' : training ? 'Oefenroute afgerond' : 'Gekozen route afgerond'}</h2>
          {positie.soort === 'overdracht' && <p>De werkzaamheden in het vervolgproces moet je nog uitvoeren.</p>}
          <label htmlFor="begeleid-overdracht">Routenotitie</label>
          <textarea id="begeleid-overdracht" className="bm-overdracht" readOnly value={overdracht} rows={Math.min(16, regels.length + 6)} />
          <p className="muted">Deze notitie is een persoonlijke samenvatting. De bevestigingen zijn niet als organisatiebewijs opgeslagen.</p>
          <div className="bm-acties">
            <button className="btn-primair" onClick={async () => {
              try { await navigator.clipboard.writeText(overdracht); setKopieMelding('Routenotitie gekopieerd.') }
              catch { setKopieMelding('Automatisch kopiëren is niet beschikbaar. Selecteer en kopieer de tekst hierboven.') }
            }}>Kopieer routenotitie</button>
            {positie.soort === 'overdracht' && <Link className="btn-secundair" target="_blank" rel="noreferrer" to={`/proces/${encodeURIComponent(positie.procesId)}`}>Open vervolgproces</Link>}
          </div>
          {kopieMelding && <p role="status">{kopieMelding}</p>}
        </section>
      )}
      {historie.length > 0 && <details className="begeleid-historie"><summary>Gevolgde route ({historie.length} {historie.length === 1 ? 'stap' : 'stappen'})</summary><ol>{regels.map((regel, index) => <li key={index}>{regel.replace(/^\d+\. /, '')}</li>)}</ol></details>}
      <div className="bm-acties">
        {historie.length > 0 && <button className="btn-secundair" onClick={() => { setHistorie(historie.slice(0, -1)); setKopieMelding('') }}>Vorige bevestiging terugnemen</button>}
        <button className="btn-tekst" onClick={() => {
          if (afgerond || historie.length === 0 || window.confirm('Stoppen wist de voortgang van deze route. Doorgaan?')) onStop()
        }}>{afgerond ? 'Een andere route starten' : 'Route stoppen'}</button>
      </div>
    </div>
  )
}

export function Begeleid() {
  const [lijst, setLijst] = useState<{ items: ProcessSummary[]; laden: boolean; fout: string }>({ items: [], laden: true, fout: '' })
  const [poging, setPoging] = useState(0)
  const [zoekterm, setZoekterm] = useState('')
  const [training, setTraining] = useState(false)
  const [proces, setProces] = useState<Process | null>(null)
  const [startId, setStartId] = useState<string | null>(null)
  const [procesLaden, setProcesLaden] = useState<string | null>(null)
  const [procesFout, setProcesFout] = useState('')
  const laadVerzoek = useRef(0)
  useEffect(() => {
    let actief = true
    void dataSource.getProcesses().then((items) => {
      if (actief) setLijst({ items: items.filter((item) => item.status === 'live'), laden: false, fout: '' })
    }).catch((error: unknown) => {
      if (actief) setLijst({ items: [], laden: false, fout: error instanceof Error ? error.message : 'Processen ophalen is mislukt.' })
    })
    return () => { actief = false }
  }, [poging])
  useEffect(() => () => { laadVerzoek.current += 1 }, [])
  const processen = useMemo(() => {
    const zoek = zoekterm.trim().toLocaleLowerCase()
    return lijst.items.filter((item) => `${item.hoofdproces} ${item.detailproces}`.toLocaleLowerCase().includes(zoek))
      .sort((a, b) => a.hoofdproces.localeCompare(b.hoofdproces) || a.detailproces.localeCompare(b.detailproces))
  }, [lijst.items, zoekterm])
  const kiesProces = async (id: string) => {
    const verzoek = ++laadVerzoek.current
    setProcesLaden(id)
    setProcesFout('')
    try {
      const geladen = await dataSource.getProcess(id)
      if (verzoek !== laadVerzoek.current) return
      if (!geladen || geladen.status !== 'live') throw new Error('Dit proces is niet meer gepubliceerd. Vernieuw de lijst en kies een beschikbaar proces.')
      setProces(geladen)
      const starts = begeleideStartpunten(geladen)
      setStartId(starts.length === 1 ? starts[0].id : null)
    } catch (error: unknown) {
      if (verzoek === laadVerzoek.current) setProcesFout(error instanceof Error ? error.message : 'Proces openen is mislukt. Probeer het opnieuw.')
    } finally { if (verzoek === laadVerzoek.current) setProcesLaden(null) }
  }
  const ververs = () => { setLijst({ items: [], laden: true, fout: '' }); setProcesFout(''); setPoging((waarde) => waarde + 1) }
  const stop = () => { setProces(null); setStartId(null) }
  const starts = proces ? begeleideStartpunten(proces) : []
  return (
    <div className="bm-page">
      <h1>Begeleide uitvoering</h1>
      {!proces && <>
        <p className="muted">Kies een gepubliceerde werkwijze. Volg de stappen en kies bij iedere beslissing het passende vervolg.</p>
        <div className="begeleid-selectie">
          <label>Zoek een proces<input type="search" value={zoekterm} onChange={(event) => setZoekterm(event.target.value)} placeholder="Procesnaam of hoofdproces" /></label>
          <label className="rol-optie"><input type="checkbox" checked={training} onChange={(event) => setTraining(event.target.checked)} /> Oefenmodus</label>
          <button className="btn-secundair" disabled={lijst.laden || Boolean(procesLaden)} onClick={ververs}>Vernieuw processen</button>
        </div>
        {lijst.laden && <p role="status">Gepubliceerde processen laden…</p>}
        {lijst.fout && <div role="alert" className="begeleid-melding"><p>{lijst.fout}</p><button className="btn-secundair" onClick={ververs}>Opnieuw proberen</button></div>}
        {procesFout && <p role="alert" className="begeleid-melding">{procesFout}</p>}
        {procesLaden && <p role="status">Proces openen…</p>}
        {!lijst.laden && !lijst.fout && lijst.items.length === 0 && <div className="empty"><h2>Nog geen gepubliceerde processen</h2><p>Na goedkeuring en publicatie verschijnt een proces hier voor begeleide uitvoering.</p><Link to="/">Naar het processenoverzicht</Link></div>}
        {!lijst.laden && lijst.items.length > 0 && processen.length === 0 && <p role="status">Geen processen gevonden. Probeer een andere zoekterm.</p>}
        <div className="bm-ingangen">{processen.map((item) => <button key={item.id} className="bm-ingang" disabled={Boolean(procesLaden)} onClick={() => void kiesProces(item.id)}><span className="kicker">{item.hoofdproces}</span><strong>{item.detailproces}</strong><span className="muted">{item.versie} · {item.aantalStappen} stappen in het proces</span></button>)}</div>
      </>}
      {proces && !startId && <>
        <h2>{proces.detailproces}</h2>
        {starts.length === 0 ? <div className="begeleid-melding" role="alert"><p>Dit proces heeft geen herkenbaar startpunt. Laat de proceseigenaar een startstap en de verbindingen vastleggen.</p><Link to={`/proces/${encodeURIComponent(proces.id)}`}>Bekijk het proces</Link></div> : <>
          <p>Kies het startpunt dat bij jouw situatie past. De andere routes worden niet automatisch meegenomen.</p>
          <div className="bm-ingangen">{starts.map((stap) => <button key={stap.id} className="bm-ingang" onClick={() => setStartId(stap.id)}><strong>{stap.activiteit}</strong><span className="muted">{proces.secties.find((sectie) => sectie.id === stap.sectieId)?.naam ?? 'Hoofdroute'}</span></button>)}</div>
        </>}
        <button className="btn-tekst" onClick={stop}>Ander proces kiezen</button>
      </>}
      {proces && startId && <RouteLoop key={`${proces.id}:${proces.versie}:${startId}`} proces={proces} startId={startId} training={training} onStop={stop} />}
    </div>
  )
}
