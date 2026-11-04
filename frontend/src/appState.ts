import { createContext, useContext } from 'react'
import type { AppConfig, User, Role } from './contract'

export interface AppState {
  config: AppConfig | null
  user: User | null
  loading: boolean
  startupError: string | null
  retryStartup: () => void
  /** Lokale inlog; geeft true bij succes. */
  login: (gebruikersnaam: string, wachtwoord: string) => Promise<boolean>
  logout: () => Promise<void>
}

export const AppContext = createContext<AppState>({
  config: null,
  user: null,
  loading: true,
  startupError: null,
  retryStartup: () => undefined,
  login: async () => false,
  logout: async () => undefined,
})

export const useApp = () => useContext(AppContext)

/** Rechten worden autoritatief op de backend afgedwongen; dit is alleen UI. */
export const useHasRole = (role: Role) => useApp().user?.rollen.includes(role) ?? false
