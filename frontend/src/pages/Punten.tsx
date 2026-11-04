import { usePunten, BADGES, NIVEAUS, niveauVoor, PUNTEN } from '../store/punten'

/** "Mijn voortgang" — persoonlijke punten, niveau en badges (lokaal, geen ranglijst). */
export function Punten() {
  const { punten, routes, suggesties, gebouwd, bekeken, badges } = usePunten()
  const niveau = niveauVoor(punten)
  const volgend = NIVEAUS.find((n) => n.vanaf > punten)
  const voortgang = volgend
    ? Math.round(((punten - niveau.vanaf) / (volgend.vanaf - niveau.vanaf)) * 100)
    : 100

  return (
    <div className="punten-pagina">
      <h1>
        {niveau.icon} Mijn voortgang — {niveau.naam}
      </h1>
      <p className="muted">
        Punten verdien je door de gids écht te gebruiken: routes afronden, processen verkennen,
        suggesties doen en bouwen. Dit is persoonlijk (per browser) — geen ranglijst, gewoon je
        eigen groei.
      </p>

      <div className="punten-kop">
        <div className="punten-score">
          <span className="punten-groot">{punten}</span> punten
        </div>
        <div className="punten-niveau">
          <div className="bm-voortgang-balk" role="progressbar" aria-label="Voortgang naar volgend niveau">
            <div className="bm-voortgang-vulling" style={{ width: `${voortgang}%` }} />
          </div>
          <span className="muted">
            {volgend
              ? `Nog ${volgend.vanaf - punten} punten tot ${volgend.icon} ${volgend.naam}`
              : 'Hoogste niveau bereikt — Procesheld! 🎉'}
          </span>
        </div>
      </div>

      <div className="punten-stats">
        <div className="punten-stat"><strong>{routes}</strong><span>routes afgerond</span></div>
        <div className="punten-stat"><strong>{bekeken.length}</strong><span>processen verkend</span></div>
        <div className="punten-stat"><strong>{suggesties}</strong><span>suggesties gedaan</span></div>
        <div className="punten-stat"><strong>{gebouwd}</strong><span>processen gebouwd</span></div>
      </div>

      <h2>Badges</h2>
      <div className="badge-grid">
        {BADGES.map((b) => {
          const heeft = badges.includes(b.id)
          return (
            <div key={b.id} className={`badge-kaart${heeft ? ' verdiend' : ''}`}>
              <span className="badge-icon">{b.icon}</span>
              <strong>{b.naam}</strong>
              <span className="muted">{b.omschrijving}</span>
              {heeft && <span className="badge-vink">✓ verdiend</span>}
            </div>
          )
        })}
      </div>

      <h2>Zo verdien je punten</h2>
      <table className="werkinstructie punten-tabel">
        <tbody>
          <tr><td>▶️ Route afronden (begeleide modus)</td><td className="stap-nr">+{PUNTEN.route}</td></tr>
          <tr><td>🎓 Oefenroute afronden (trainingsmodus)</td><td className="stap-nr">+{PUNTEN['route-oefening']}</td></tr>
          <tr><td>💡 Suggestie indienen bij een stap</td><td className="stap-nr">+{PUNTEN.suggestie}</td></tr>
          <tr><td>🧭 Nieuw proces verkennen (eerste keer)</td><td className="stap-nr">+{PUNTEN['proces-bekeken']}</td></tr>
          <tr><td>🏗️ Proces bouwen of bewerken</td><td className="stap-nr">+{PUNTEN['proces-gebouwd']}</td></tr>
        </tbody>
      </table>
    </div>
  )
}
