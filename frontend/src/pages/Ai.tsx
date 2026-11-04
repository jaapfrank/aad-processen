import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { dataSource } from '../data'
import { useApp, useHasRole } from '../appState'

// AI-assistent: stelt vragen over de processen (zoeken, verbeteren,
// structureren). De backend stuurt de volledige procesinhoud als context mee
// naar de geconfigureerde provider (Azure OpenAI / OpenAI / Anthropic).

interface Bericht {
  rol: 'gebruiker' | 'ai'
  tekst: string
}

const voorbeelden = [
  'Welke stappen hebben een termijn en wat gebeurt er als die verloopt?',
  'Hoe kunnen we een proces duidelijker maken voor nieuwe medewerkers?',
  'Maak een conceptproces voor het afhandelen van zoekgeraakte pakketten.',
]

/** Maakt [[proces-id]]-verwijzingen klikbaar. */
function MetProcesLinks({ tekst }: { tekst: string }) {
  const delen = tekst.split(/(\[\[[a-z0-9-]+\]\])/g)
  return (
    <>
      {delen.map((d, i) => {
        const m = /^\[\[([a-z0-9-]+)\]\]$/.exec(d)
        return m ? (
          <Link key={i} to={`/proces/${m[1]}`}>
            {m[1]}
          </Link>
        ) : (
          <span key={i}>{d.split(/(\*\*[^*]+\*\*)/g).map((deel, n) => deel.startsWith('**') && deel.endsWith('**') ? <strong key={n}>{deel.slice(2, -2)}</strong> : deel)}</span>
        )
      })}
    </>
  )
}

export function Ai() {
  const navigate = useNavigate()
  const magBewerken = useHasRole('bewerken')
  const magBeheren = useHasRole('beheren')
  const { user } = useApp()
  const opslagSleutel = `spg-ai-gesprek:${user?.id ?? 'anoniem'}`
  const [berichten, setBerichten] = useState<Bericht[]>(() => {
    try {
      const waarde: unknown = JSON.parse(sessionStorage.getItem(opslagSleutel) ?? '[]')
      return Array.isArray(waarde) && waarde.every(b => b && ['gebruiker', 'ai'].includes(b.rol) && typeof b.tekst === 'string') ? waarde.slice(-20) : []
    } catch { return [] }
  })
  useEffect(() => {
    try { sessionStorage.setItem(opslagSleutel, JSON.stringify(berichten.slice(-20))) } catch { /* Het gesprek blijft in deze pagina beschikbaar. */ }
  }, [berichten, opslagSleutel])
  const [vraag, setVraag] = useState('')
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState('')
  const onderkant = useRef<HTMLDivElement>(null)

  const stel = async (tekst: string) => {
    const v = tekst.trim()
    if (!v || bezig) return
    setFout('')
    setBezig(true)
    setVraag('')
    setBerichten((b) => [...b, { rol: 'gebruiker', tekst: v }])
    try {
      const antwoord = await dataSource.askAi(v, berichten.slice(-20))
      setBerichten((b) => [...b, { rol: 'ai', tekst: antwoord }])
    } catch (e) {
      setBerichten(berichten)
      setVraag(v)
      setFout(e instanceof Error ? e.message : 'AI-aanroep mislukt.')
    } finally {
      setBezig(false)
      setTimeout(() => onderkant.current?.scrollIntoView({ behavior: 'smooth' }), 50)
    }
  }

  return (
    <div className="ai-pagina">
      <h1>🤖 AI-assistent</h1>
      <p className="muted">
        Bespreek processen en werk voorstellen uit. De assistent neemt de laatste tien gespreksrondes mee.
        Een antwoord is nog niet opgeslagen: maak er een bewerkbaar proces van en sla dat op als concept.
      </p>

      {berichten.length > 0 && <button className="btn-secundair" disabled={bezig} onClick={() => { setBerichten([]); setVraag(''); setFout('') }}>Nieuw gesprek</button>}
      {berichten.length === 0 && (
        <div className="ai-voorbeelden">
          {voorbeelden.map((v) => (
            <button key={v} className="ai-voorbeeld" onClick={() => void stel(v)}>
              {v}
            </button>
          ))}
        </div>
      )}

      <div className="ai-gesprek">
        {berichten.map((b, i) => {
          return (
            <div key={i} className={`ai-bericht ${b.rol}`}>
              <span className="ai-wie">{b.rol === 'gebruiker' ? '🧑' : '🤖'}</span>
              <div className="ai-tekst">
                <MetProcesLinks tekst={b.tekst} />
                {b.rol === 'ai' && (magBewerken || magBeheren) && (
                  <div className="ai-voorstel-actie">
                    <button className="btn-primair" disabled={bezig} onClick={() => navigate('/ai-diagram', { state: {
                      beschrijving: berichten.slice(0, i + 1).map(bericht => `${bericht.rol === 'ai' ? 'Voorstel (nog niet opgeslagen of vastgesteld)' : 'Gebruiker'}:\n${bericht.tekst}`).join('\n\n'),
                    } })}>Maak hier een bewerkbaar proces van</button>
                    <span className="muted">Controleer het ontwerp en sla het daarna op in de editor.</span>
                  </div>
                )}
              </div>
            </div>
          )
        })}
        {bezig && <p className="muted">🤖 denkt na…</p>}
        {fout && (
          <div className="empty">
            {fout}
            {fout.includes('niet geconfigureerd') && (
              <p className="muted">
                Open <Link to="/beheer?tab=ai">Instellingen → AI-koppeling</Link> of vraag je beheerder om de verbinding te controleren.
              </p>
            )}
          </div>
        )}
        <div ref={onderkant} />
      </div>

      <form
        className="zoek-form ai-form"
        onSubmit={(e) => {
          e.preventDefault()
          void stel(vraag)
        }}
      >
        <input
          value={vraag}
          onChange={(e) => setVraag(e.target.value)}
          aria-label="Vraag aan de AI-assistent"
          placeholder="Stel een vraag over de processen…"
          disabled={bezig}
        />
        <button type="submit" disabled={bezig || !vraag.trim()}>
          {bezig ? '…' : 'Vraag'}
        </button>
      </form>
    </div>
  )
}
