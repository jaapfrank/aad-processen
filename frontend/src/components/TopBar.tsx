import { NavLink } from 'react-router-dom'
import { Merk } from './Merk'
import { useApp, useHasRole } from '../appState'
import { useState } from 'react'
import { huidigThema, wisselThema } from '../lib/thema'
import { dataSource } from '../data'
import { leesBackendRuntime } from '../lib/beheerModel'

export function TopBar() {
  const { config, user, logout } = useApp()
  const backendRuntime = leesBackendRuntime(config)
  const developmentLogin =
    backendRuntime?.developmentLoginAvailable === true &&
    user?.bron === 'development-bypass'
  const isDemo = dataSource.runtime.gebruiktVoorbeelddata || backendRuntime?.isDemo
  const magBewerken = useHasRole('bewerken')
  const magBeheren = useHasRole('beheren')
  const [thema, setThema] = useState(huidigThema())
  return (
    <header className="topbar">
      <div className="brand">
        <Merk />
      </div>
      <div className="topbar-right">
        {(isDemo || developmentLogin) && <span
          className={`runtime-source-chip ${
            dataSource.runtime.gebruiktVoorbeelddata || backendRuntime?.isDemo ? 'mock' : 'api'
          }`}
          title={dataSource.runtime.beschrijving}
        >
          {developmentLogin ? 'Testsessie' : 'Demoomgeving'}
        </span>}
        {(magBewerken || magBeheren) && (
          <NavLink
            to="/beheer"
            end
            className={({ isActive }) => `topbar-settings${isActive ? ' active' : ''}`}
            aria-label="Instellingen en beheer"
            title="Instellingen en beheer"
          >
            <span aria-hidden="true">⚙</span>
            <span className="topbar-settings-label">Instellingen</span>
          </NavLink>
        )}
        <button
          className="btn-tekst thema-knop"
          title={thema === 'donker' ? 'Schakel naar licht' : 'Schakel naar donker'}
          aria-label="Thema wisselen"
          onClick={() => setThema(wisselThema())}
        >
          {thema === 'donker' ? '☀️' : '🌙'}
        </button>
        <span className="user">{user ? user.naam : 'Niet ingelogd'}</span>
        {user && !developmentLogin && (
          <button className="btn-tekst" title="Uitloggen" onClick={() => void logout()}>
            Uitloggen
          </button>
        )}
      </div>
    </header>
  )
}
