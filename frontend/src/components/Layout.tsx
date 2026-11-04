import { Outlet } from 'react-router-dom'
import { TopBar } from './TopBar'
import { Sidebar } from './Sidebar'
import { BadgeToast } from './BadgeToast'
import { dataSource } from '../data'
import { useApp } from '../appState'
import { leesBackendRuntime } from '../lib/beheerModel'

export function Layout() {
  const { config, user } = useApp()
  const backendRuntime = leesBackendRuntime(config)
  const lokaleMock = dataSource.runtime.gebruiktVoorbeelddata
  const backendDemo = backendRuntime?.isDemo === true
  const developmentLogin =
    backendRuntime?.developmentLoginAvailable === true &&
    user?.bron === 'development-bypass'

  return (
    <div className="app">
      <a className="skip-link" href="#werkruimte">Naar inhoud</a>
      <TopBar />
      {(lokaleMock || backendDemo) && (
        <div className="runtime-demo-banner" role="status">
          <strong>
            {lokaleMock
              ? 'Lokale demo met mockdata actief.'
              : 'Geïsoleerde backenddemo met synthetische data actief.'}
          </strong>{' '}
          {lokaleMock
            ? 'Dit zijn lokale voorbeeldgegevens zonder backend of externe koppelingen.'
            : 'Dit runtimeprofiel is door deploymentconfiguratie vastgesteld.'}{' '}
          Deze modus kan niet vanuit tenantbeheer worden aangezet.
        </div>
      )}
      {developmentLogin && (
        <div className="runtime-demo-banner runtime-development-login-banner" role="status">
          <strong>Ontwikkelmodus: inloggen is tijdelijk overgeslagen.</strong>{' '}
          Je werkt via een lokale testsessie met beheerrechten. Deze mogelijkheid is niet
          beschikbaar in een productiebuild.
        </div>
      )}
      <div className="app-body">
        <Sidebar />
        <main className="main" id="werkruimte" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
      <BadgeToast />
    </div>
  )
}
