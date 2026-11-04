import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { AppContext } from './appState'
import type { AppState } from './appState'
import { dataSource } from './data'
import { initEntra, entraLogin, entraLogout } from './entraAuth'
import type { AppConfig, User } from './contract'

/** Laadt config + ingelogde gebruiker en biedt login/logout aan (lokaal of Entra). */
export function AppProviders({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [startupError, setStartupError] = useState<string | null>(null)
  const [startupAttempt, setStartupAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    void (async () => {
      if (alive) {
        setLoading(true)
        setStartupError(null)
      }
      try {
        const c = await dataSource.getConfig()
        // In entra-modus eerst MSAL initialiseren zodat een bestaande sessie
        // stil hersteld wordt vóór de eerste /api/me-aanroep.
        if (c.authMode === 'entra' && c.entra) await initEntra(c.entra)
        let u = await dataSource.getMe()
        if (!u && c.runtime?.developmentLoginAvailable) {
          u = await dataSource.startDevelopmentSession()
        }
        if (alive) {
          setConfig(c)
          setUser(u)
          setLoading(false)
        }
      } catch {
        if (alive) {
          setStartupError(
            'De applicatieserver is niet bereikbaar. Controleer de serververbinding en probeer opnieuw.',
          )
          setLoading(false)
        }
      }
    })()
    return () => {
      alive = false
    }
  }, [startupAttempt])

  const retryStartup = useCallback(() => setStartupAttempt((attempt) => attempt + 1), [])

  const login = useCallback(
    async (gebruikersnaam: string, wachtwoord: string) => {
      if (config?.authMode === 'entra') {
        const ok = await entraLogin()
        if (!ok) return false
        const u = await dataSource.getMe()
        if (u) setUser(u)
        return Boolean(u)
      }
      const u = await dataSource.login(gebruikersnaam, wachtwoord)
      if (u) setUser(u)
      return Boolean(u)
    },
    [config],
  )

  const logout = useCallback(async () => {
    if (config?.authMode === 'entra') await entraLogout()
    else await dataSource.logout()
    setUser(null)
  }, [config])

  const value = useMemo<AppState>(
    () => ({ config, user, loading, startupError, retryStartup, login, logout }),
    [config, user, loading, startupError, retryStartup, login, logout],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}
