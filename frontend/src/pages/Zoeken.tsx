import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { dataSource } from '../data'
import type { Process, ProcessSummary, Step } from '../contract'

/** Markeert de zoekterm in een tekstfragment. */
function Markeer({ tekst, term }: { tekst: string; term: string }) {
  if (!term) return <>{tekst}</>
  const delen = tekst.split(new RegExp('(' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\interface Treffer {') + ')', 'ig'))
  return (
    <>
      {delen.map((d, i) => (d.toLowerCase() === term.toLowerCase() ? <mark key={i}>{d}</mark> : <span key={i}>{d}</span>))}
    </>
  )
}

interface Treffer {
  proces: ProcessSummary
  stap?: Step
  veld?: string
  tekst?: string
}

function zoekInStap(s: Step, q: string): { veld: string; tekst: string } | null {
  const velden: Array<[string, string | undefined]> = [
    ['Activiteit', s.activiteit],
    ['Toelichting', s.toelichting],
    ['Opmerking', s.opmerking],
    ['Notitie', s.zijnotitie],
    ['Voorwaarde', s.voorwaarde],
    ['ERP-status', s.erpStatus],
  ]
  for (const [veld, tekst] of velden)
    if (tekst && tekst.toLowerCase().includes(q)) return { veld, tekst }
  return null
}

export function Zoeken() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const [invoer, setInvoer] = useState(q)
  const [summaries, setSummaries] = useState<ProcessSummary[]>([])
  const [vol, setVol] = useState<Map<string, Process>>(new Map())

  useEffect(() => {
    void (async () => {
      const all = await dataSource.getProcesses()
      setSummaries(all)
      const volle = new Map<string, Process>()
      for (const p of all) {
        const f = await dataSource.getProcess(p.id)
        if (f) volle.set(p.id, f)
      }
      setVol(volle)
    })()
  }, [])

  const treffers = useMemo<Treffer[]>(() => {
    const term = q.trim().toLowerCase()
    if (term.length < 2) return []
    const res: Treffer[] = []
    for (const s of summaries) {
      if (s.detailproces.toLowerCase().includes(term) || s.hoofdproces.toLowerCase().includes(term))
        res.push({ proces: s })
      const f = vol.get(s.id)
      if (f)
        for (const stap of f.stappen) {
          const hit = zoekInStap(stap, term)
          if (hit) res.push({ proces: s, stap, veld: hit.veld, tekst: hit.tekst })
        }
    }
    return res
  }, [q, summaries, vol])

  return (
    <div>
      <h1>Zoeken</h1>
      <form
        className="zoek-form"
        onSubmit={(e) => {
          e.preventDefault()
          setParams(invoer.trim() ? { q: invoer.trim() } : {})
        }}
      >
        <input
          autoFocus
          value={invoer}
          onChange={(e) => setInvoer(e.target.value)}
          placeholder="Zoek op stap, rol of trefwoord… (RMA, WKOA, SK, courantheid, …)"
        />
        <button type="submit">Zoek</button>
      </form>

      {q.trim().length < 2 ? (
        <p className="muted">Typ minimaal 2 tekens en druk op Enter.</p>
      ) : treffers.length === 0 ? (
        <div className="empty">Geen resultaten voor "{q}".</div>
      ) : (
        <ul className="zoek-resultaten">
          {treffers.map((t, i) => (
            <li key={i}>
              <Link to={`/proces/${t.proces.id}`} className="zoek-treffer">
                <span className="kicker">{t.proces.detailproces}</span>
                {t.stap ? (
                  <>
                    <strong>
                      Stap {t.stap.nummer} — {t.stap.activiteit}
                    </strong>
                    <span className="muted">
                      {t.veld}: <Markeer tekst={t.tekst ?? ''} term={q.trim()} />
                    </span>
                  </>
                ) : (
                  <strong>Procesnaam komt overeen</strong>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
