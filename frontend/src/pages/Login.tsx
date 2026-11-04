import { useState } from 'react'
import { Merk } from '../components/Merk'
import { useApp } from '../appState'

/** Inlogscherm voor de zelfstandige (lokale) modus; Entra/MSAL volgt later. */
export function Login() {
  const { config, login } = useApp()
  const [gebruikersnaam, setGebruikersnaam] = useState('')
  const [wachtwoord, setWachtwoord] = useState('')
  const [fout, setFout] = useState('')
  const [bezig, setBezig] = useState(false)

  const doeLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setBezig(true)
    setFout('')
    const ok = await login(gebruikersnaam, wachtwoord)
    setBezig(false)
    if (!ok) setFout('Inloggen mislukt. Controleer gebruikersnaam en wachtwoord.')
  }

  // Gekoppelde modus: één knop — inloggen met het Microsoft-bedrijfsaccount.
  if (config?.authMode === 'entra') {
    return (
      <div className="login-scherm">
        <div className="login-kaart">
          <div className="brand login-brand">
            <Merk />
          </div>
          <p className="muted">Log in met je Microsoft-bedrijfsaccount.</p>
          {fout && <p className="login-fout">{fout}</p>}
          <button
            className="btn-primair"
            disabled={bezig || !config.entra}
            onClick={async () => {
              setBezig(true)
              setFout('')
              const ok = await login('', '')
              setBezig(false)
              if (!ok) setFout('Microsoft-login mislukt of geannuleerd.')
            }}
          >
            {bezig ? 'Bezig…' : ' Inloggen met Microsoft'}
          </button>
          {!config.entra && (
            <p className="muted login-entra">
              Entra is nog niet geconfigureerd (TenantId/ClientId ontbreken in de serverinstellingen).
            </p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="login-scherm">
      <form className="login-kaart" onSubmit={doeLogin}>
        <div className="brand login-brand">
          <Merk />
        </div>
        <p className="muted">Log in om de processen te bekijken.</p>
        <label>
          Gebruikersnaam
          <input
            autoFocus
            autoComplete="username"
            value={gebruikersnaam}
            onChange={(e) => setGebruikersnaam(e.target.value)}
          />
        </label>
        <label>
          Wachtwoord
          <input
            type="password"
            autoComplete="current-password"
            value={wachtwoord}
            onChange={(e) => setWachtwoord(e.target.value)}
          />
        </label>
        {fout && <p className="login-fout">{fout}</p>}
        <button className="btn-primair" type="submit" disabled={bezig || !gebruikersnaam || !wachtwoord}>
          {bezig ? 'Bezig…' : 'Inloggen'}
        </button>
      </form>
    </div>
  )
}
