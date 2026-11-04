import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { dataSource } from '../data'
import type { Process, ProcessSummary } from '../contract'
import { SwimlaneView } from '../swimlane/SwimlaneView'
import { useHuisstijl } from '../lib/huisstijl'

const ROTATIE_SECONDEN = 25

/**
 * Kiosk-/TV-modus: alleen-lezen weergave die automatisch door de live
 * processen roteert — voor een scherm op de afdeling. Klik = pauze, Esc = terug.
 */
export function Kiosk() {
  const stijl = useHuisstijl((state) => state.stijl)
  const navigate = useNavigate()
  const [lijst, setLijst] = useState<ProcessSummary[]>([])
  const [index, setIndex] = useState(0)
  const [proces, setProces] = useState<Process | null>(null)
  const [pauze, setPauze] = useState(false)

  useEffect(() => {
    void dataSource.getProcesses().then((alle) => setLijst(alle.filter((p) => p.status === 'live')))
  }, [])

  useEffect(() => {
    if (lijst.length === 0) return
    void dataSource.getProcess(lijst[index % lijst.length].id).then(setProces)
  }, [lijst, index])

  useEffect(() => {
    if (pauze || lijst.length === 0) return
    const timer = setInterval(() => setIndex((i) => i + 1), ROTATIE_SECONDEN * 1000)
    return () => clearInterval(timer)
  }, [pauze, lijst.length])

  useEffect(() => {
    const opToets = (e: KeyboardEvent) => {
      if (e.key === 'Escape') navigate('/')
      if (e.key === ' ') setPauze((p) => !p)
      if (e.key === 'ArrowRight') setIndex((i) => i + 1)
    }
    window.addEventListener('keydown', opToets)
    return () => window.removeEventListener('keydown', opToets)
  }, [navigate])

  if (lijst.length === 0) return <div className="kiosk-leeg muted">Geen live processen om te tonen.</div>

  return (
    <div className="kiosk" onClick={() => setPauze((p) => !p)}>
      <header className="kiosk-kop">
        <span className="brand-mark">{stijl.bedrijfsnaam}</span>
        <h1>{proces?.detailproces ?? 'Laden…'}</h1>
        <span className="kiosk-teller">
          {pauze ? '⏸ gepauzeerd (klik om te hervatten)' : `${(index % lijst.length) + 1} / ${lijst.length}`}
        </span>
      </header>
      {proces && (
        <div className="kiosk-plaat">
          <SwimlaneView proces={proces} onSelect={() => undefined} />
        </div>
      )}
      <footer className="kiosk-voet muted">klik = pauze · spatie = pauze · → = volgende · Esc = terug</footer>
    </div>
  )
}
