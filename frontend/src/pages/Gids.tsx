import { Link } from 'react-router-dom'
import { useApp } from '../appState'

/** Korte gebruikersgids in de app: modi, rollen, navigatie, bouwer, import. */
export function Gids() {
  const { config, user } = useApp()

  return (
    <div className="gids">
      <h1>Gebruikersgids</h1>
      <p className="muted">
        De Service Procesgids maakt de serviceprocessen interactief: snel de juiste stap vinden,
        processen bekijken als plaat én tabel, en nieuwe processen bouwen of importeren.
      </p>

      <section className="be-blok">
        <h2>🚀 Snel beginnen</h2>
        <ul className="gids-lijst">
          <li>
            <strong>"Wat moet ik nu doen met deze retour?"</strong> → open de{' '}
            <Link to="/begeleid">Begeleide modus</Link>, kies je situatie en volg het pad stap voor
            stap. Aan het einde krijg je een overdrachtstekst voor ticket/mail/ERP.
          </li>
          <li>
            Proces bekijken → <Link to="/">Overzicht</Link> of de <Link to="/atlas">Atlas</Link>{' '}
            (de hele keten met koppelingen). Schakel per proces tussen <em>🗺️ Plaat</em> en{' '}
            <em>📋 Tabel</em>; klik een stap voor de werkinstructie.
          </li>
          <li>
            Iets niet kunnen vinden → <Link to="/zoeken">Zoeken</Link> op trefwoord (RMA, WKOA, SK,
            courantheid, …).
          </li>
          <li>
            Klopt iets niet? Gebruik <strong>💬 Suggestie bij deze stap</strong> in het
            stap-detailpaneel; je suggestie gaat naar de procesbeheerder.
          </li>
        </ul>
      </section>

      <section className="be-blok">
        <h2>👤 Rollen</h2>
        <p className="muted">
          Wat je kunt hangt af van je rol{user ? ` (jij hebt: ${user.rollen.join(', ')})` : ''}.
          Rechten worden altijd door de server afgedwongen.
        </p>
        <table className="werkinstructie">
          <tbody>
            <tr><td className="stap-nr">kijken</td><td>Processen bekijken, zoeken, routes volgen.</td></tr>
            <tr><td className="stap-nr">suggesties</td><td>Per stap melden wat beter kan.</td></tr>
            <tr><td className="stap-nr">bewerken</td><td>Processen maken/wijzigen (concept), PDF importeren, suggesties afhandelen.</td></tr>
            <tr><td className="stap-nr">goedkeuren</td><td>Conceptversies beoordelen en live zetten (of afwijzen).</td></tr>
            <tr><td className="stap-nr">beheren</td><td>Gebruikers en rechten beheren, processen archiveren.</td></tr>
          </tbody>
        </table>
      </section>

      <section className="be-blok">
        <h2>✏️ Processen maken & wijzigen</h2>
        <ul className="gids-lijst">
          <li>
            De <Link to="/bouwer">Procesbouwer</Link> werkt met stapkaarten: kies rollen (lanes),
            secties en stappen; de <strong>plaat en tabel tekenen zichzelf</strong> (live voorbeeld).
          </li>
          <li>Sleep stappen (⠿) om te herordenen of naar een andere sectie te verplaatsen; 🔗 Auto-schakelen verbindt stappen automatisch.</li>
          <li>
            Gebruik <strong>− / + / Reset / Passend</strong> om in alle zes weergaven en in de
            vrije editor te zoomen; ingezoomde platen blijven binnen het witte vlak verschuifbaar.
          </li>
          <li>
            Op <Link to="/uitwisseling">Import &amp; export</Link> staan PDF, draw.io, Microsoft
            Visio en Lucidchart bij elkaar. Kies eerst importeren of exporteren en daarna het
            formaat; elke diagramimport krijgt een review en wordt nooit direct opgeslagen.
          </li>
          <li>De <strong>gezondheidsscore</strong> markeert wat ontbreekt (eigenaar, vervolg, ERP-status, …).</li>
          <li>
            Wijzigingen worden een <em>concept</em>; via <strong>📤 Indienen</strong> →{' '}
            <strong>✅ Goedkeuren</strong> wordt een versie live. Niets gaat live zonder goedkeuring.
          </li>
          <li>
            Bestaande PDF&apos;s? Kies <Link to="/uitwisseling?actie=importeren&formaat=pdf">PDF op
            Import &amp; export</Link>: uploaden, herkende stapkaarten controleren (zekerheid per
            stap) en vastleggen als concept. De oude <Link to="/import">PDF-link</Link> blijft
            werken.
          </li>
        </ul>
      </section>

      <section className="be-blok">
        <h2>🛡️ ISO & audit</h2>
        <p className="muted">
          <Link to="/iso">ISO & audit</Link> controleert alle werkprocessen op modelleerbare
          signalen uit ISO 9001, 27001, 14001, 45001, 22301 en BPMN 2.0. Per proces zie je
          aandachtspunten, handmatig te bevestigen bewijs en de officiële bron. Voor 27001, 9001
          en 14001 leg je daarnaast eigenaar, clausulekoppeling en reviewritme vast in de
          auditmatrix.
        </p>
      </section>

      <section className="be-blok">
        <h2>🏅 Punten & badges</h2>
        <p className="muted">
          Gebruik van de gids levert punten en badges op (routes afronden, processen verkennen,
          suggesties doen, bouwen) — zie <Link to="/punten">Mijn voortgang</Link>. Persoonlijk per
          browser; geen ranglijst. De <Link to="/ai">🤖 AI-assistent</Link> beantwoordt vragen over
          de processen en doet verbetervoorstellen; de <Link to="/kiosk">📺 Kiosk</Link> toont de
          processen roterend op een afdelingsscherm. Redacteuren zien in het <Link to="/dashboard">📊 Dashboard</Link> de
          werkvoorraad en borging; via Beheer koppel je Business Central, AD/Entra en de AI-provider.
        </p>
      </section>

      <section className="be-blok">
        <h2>❓ Veelgestelde vragen</h2>
        <table className="werkinstructie">
          <tbody>
            <tr><td className="stap-nr">Ik weet niet welk proces ik nodig heb</td><td>Start de <Link to="/begeleid">Begeleide modus</Link> — die brengt je er met een paar vragen naartoe. Of vraag het de <Link to="/ai">🤖 AI-assistent</Link>.</td></tr>
            <tr><td className="stap-nr">Er klopt iets niet in een proces</td><td>Open de stap en klik <strong>💬 Suggestie bij deze stap</strong> — de beheerder pakt het op en jij verdient punten.</td></tr>
            <tr><td className="stap-nr">Mijn wijziging is niet zichtbaar</td><td>Wijzigingen zijn eerst een <em>concept</em>; pas na 📤 indienen en ✅ goedkeuren staat de nieuwe versie live.</td></tr>
            <tr><td className="stap-nr">Ik kan niet inloggen</td><td>Vraag een beheerder je wachtwoord te resetten (Beheer → Gebruikers), of gebruik je Microsoft-account als AD/Entra gekoppeld is.</td></tr>
            <tr><td className="stap-nr">Hoe installeer ik dit ergens anders?</td><td>Zie <code>HANDLEIDING.md</code> in het pakket: zip uitpakken en <code>installeer.bat</code> dubbelklikken; collega's gebruiken daarna alleen de browser.</td></tr>
            <tr><td className="stap-nr">Waar zijn de back-ups?</td><td>Automatisch volgens schema in <code>App_Data/backups</code> (en optioneel een netwerkpad/OneDrive-map) — zie Beheer → 💾 Back-ups.</td></tr>
          </tbody>
        </table>
      </section>

      <section className="be-blok">
        <h2>⚙️ Modi</h2>
        <p className="muted">
          De app draait {config?.authMode === 'entra' ? 'gekoppeld (inloggen met je Microsoft-account)' : 'zelfstandig (lokale inlog)'}{' '}
          met {config?.storage === 'db' ? 'centrale database' : 'lokale opslag'}. Dezelfde functies werken in beide
          modi; alleen inlog en opslag verschillen.
        </p>
      </section>
    </div>
  )
}
