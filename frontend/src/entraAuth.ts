import { PublicClientApplication } from '@azure/msal-browser'
import type { EntraPublicConfig } from '@contract/model'

// MSAL-login voor de gekoppelde modus (authMode=entra). De backend levert de
// publieke tenant/client-gegevens via GET /api/config (contract v1.3); na een
// geslaagde popup-login sturen we het access token als Bearer mee in elke
// API-aanroep (zie data.ts).

let msal: PublicClientApplication | null = null
let scopes: string[] = []
let accessToken: string | null = null

export async function initEntra(config: EntraPublicConfig): Promise<void> {
  if (msal) return
  scopes = [`api://${config.clientId}/.default`]
  msal = new PublicClientApplication({
    auth: {
      clientId: config.clientId,
      authority: `https://login.microsoftonline.com/${config.tenantId}`,
      redirectUri: window.location.origin,
    },
    cache: { cacheLocation: 'sessionStorage' },
  })
  await msal.initialize()
  // Stil token ophalen wanneer er al een account bekend is (sessie-herstel).
  const account = msal.getAllAccounts()[0]
  if (account) {
    try {
      const res = await msal.acquireTokenSilent({ scopes, account })
      accessToken = res.accessToken
    } catch {
      accessToken = null
    }
  }
}

/** Interactieve Microsoft-login; geeft true bij succes. */
export async function entraLogin(): Promise<boolean> {
  if (!msal) return false
  try {
    const res = await msal.loginPopup({ scopes })
    accessToken = res.accessToken
    return true
  } catch {
    return false
  }
}

export async function entraLogout(): Promise<void> {
  accessToken = null
  if (msal) await msal.logoutPopup().catch(() => undefined)
}

/** Huidig Bearer-token voor API-aanroepen (null in lokale modus). */
export const getEntraToken = () => accessToken
