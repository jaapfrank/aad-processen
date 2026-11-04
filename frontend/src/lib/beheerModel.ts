export type RuntimeBron = 'api' | 'mock'

export interface RuntimeGegevensbron {
  bron: RuntimeBron
  label: string
  korteLabel: string
  beschrijving: string
  heeftBackend: boolean
  gebruiktVoorbeelddata: boolean
  selectie: 'deployment-configuratie'
}

export function beschrijfRuntime(bron: RuntimeBron): RuntimeGegevensbron {
  if (bron === 'mock') {
    return {
      bron,
      label: 'Lokale demo met mockdata',
      korteLabel: 'Lokale mockdata',
      beschrijving:
        'Expliciet gestarte ontwikkelmodus met synthetische voorbeelddata; geen klanttenant en geen backendkoppelingen.',
      heeftBackend: false,
      gebruiktVoorbeelddata: true,
      selectie: 'deployment-configuratie',
    }
  }

  return {
    bron,
    label: 'Backend-API',
    korteLabel: 'Backend-API',
    beschrijving:
      'Gegevens worden opgeslagen op de server van deze omgeving.',
    heeftBackend: true,
    gebruiktVoorbeelddata: false,
    selectie: 'deployment-configuratie',
  }
}

export interface BackendRuntime {
  environment: string
  profile: 'r0'
  tenantType: 'single-tenant'
  mode: 'standard' | 'demo'
  dataSource: 'database' | 'demo-fixtures'
  isDemo: boolean
  syntheticData: boolean
  fallbackUsed: false
  developmentLoginAvailable: boolean
}

export function leesBackendRuntime(config: unknown): BackendRuntime | null {
  if (!config || typeof config !== 'object') return null
  const runtime = (config as Record<string, unknown>).runtime
  if (!runtime || typeof runtime !== 'object') return null
  const r = runtime as Record<string, unknown>
  if (
    typeof r.environment !== 'string' ||
    r.profile !== 'r0' ||
    r.tenantType !== 'single-tenant' ||
    (r.mode !== 'standard' && r.mode !== 'demo') ||
    (r.dataSource !== 'database' && r.dataSource !== 'demo-fixtures') ||
    typeof r.isDemo !== 'boolean' ||
    typeof r.syntheticData !== 'boolean' ||
    r.fallbackUsed !== false ||
    typeof r.developmentLoginAvailable !== 'boolean'
  ) {
    return null
  }

  const consistenteDemo =
    r.isDemo === (r.mode === 'demo') &&
    r.syntheticData === (r.dataSource === 'demo-fixtures') &&
    (r.mode === 'demo') === (r.dataSource === 'demo-fixtures')
  if (!consistenteDemo) return null
  return r as unknown as BackendRuntime
}

export type AiProvider = 'azure-openai' | 'openai' | 'anthropic' | 'chatgpt'
export type AiStatusProvider = AiProvider | 'disabled' | 'invalid'
export type AiMode = 'disabled' | 'managed' | 'byo'
export type AiActivationState =
  | 'disabled'
  | 'active'
  | 'missing-credential'
  | 'invalid-configuration'
  | 'managed-unavailable'
  | 'legacy-disabled'
export type AiCredentialSource =
  | 'none'
  | 'tenant-protected'
  | 'server-configuration'
  | 'legacy-oauth'

export interface AiInstellingenSnapshot {
  provider: AiStatusProvider
  endpoint: string
  model: string
  mode: AiMode
  heeftSleutel: boolean
  geconfigureerd: boolean
  activationState: AiActivationState
  credentialSource: AiCredentialSource
  credentialFingerprint?: string
  credentialUpdatedAt?: string
  storedTenantCredentialPresent: boolean
  storedTenantCredentialProvider?: Exclude<AiProvider, 'chatgpt'>
  errorCode?: string
  legacy: boolean
  productionAllowed: boolean
  canTest: boolean
  managedAi: {
    available: boolean
    reasonCode: string
    nextStep: string
  }
  legacyOAuth: {
    available: boolean
    linked: boolean
    productionAllowed: false
  }
}

export interface AiInstellingenWijziging {
  provider?: AiProvider
  endpoint?: string
  model?: string
  mode?: AiMode
  /** Uitsluitend write-only in PUT; nooit onderdeel van een statusresponse. */
  apiKey?: string
}

export interface AiVerbindingstest {
  ok: true
  provider: AiProvider
  model: string
  testedAt: string
}

export type AiProductmodus =
  | 'uit'
  | 'managed-ai'
  | 'eigen-providercredential'
  | 'chatgpt-account'

export type AiBeheerstatus =
  | 'niet-geconfigureerd'
  | 'test-nodig'
  | 'verbonden'
  | 'beperkt'
  | 'uitgeschakeld'

export interface AiBeheerweergave {
  modus: AiProductmodus
  modusLabel: string
  status: AiBeheerstatus
  statusLabel: string
  toelichting: string
}

const apiProviders: ReadonlySet<string> = new Set(['azure-openai', 'openai', 'anthropic'])
const bekendeProviders: ReadonlySet<string> = new Set([
  ...apiProviders,
  'chatgpt',
  'disabled',
  'invalid',
])
const aiModes: ReadonlySet<string> = new Set(['disabled', 'managed', 'byo'])
const activationStates: ReadonlySet<string> = new Set([
  'disabled',
  'active',
  'missing-credential',
  'invalid-configuration',
  'managed-unavailable',
  'legacy-disabled',
])
const credentialSources: ReadonlySet<string> = new Set([
  'none',
  // Tijdelijk geaccepteerd bij rolling upgrades; genormaliseerd naar
  // tenant-protected zodat de UI de oude verkeerde naam nooit toont.
  'managed-protected',
  'tenant-protected',
  'server-configuration',
  'legacy-oauth',
])
const verbodenSecretVelden = [
  'apiKey',
  'api_key',
  'secret',
  'clientSecret',
  'accessToken',
  'refreshToken',
  'credential',
]

/**
 * Valideert het bestaande, beperkte backendcontract. Een secret in een GET-response
 * is een contractfout: de beheerpagina toont of bewaart dat antwoord dan niet.
 */
export function parseAiInstellingenSnapshot(waarde: unknown): AiInstellingenSnapshot {
  if (!waarde || typeof waarde !== 'object') {
    throw new Error('De backend gaf geen geldige AI-configuratie terug.')
  }

  const record = waarde as Record<string, unknown>
  const gelektVeld = verbodenSecretVelden.find(
    (veld) => Object.prototype.hasOwnProperty.call(record, veld) && record[veld] != null,
  )
  if (gelektVeld) {
    throw new Error('Onveilig AI-contract: de backend retourneerde credentialmateriaal.')
  }

  if (
    typeof record.provider !== 'string' ||
    !bekendeProviders.has(record.provider) ||
    typeof record.mode !== 'string' ||
    !aiModes.has(record.mode) ||
    typeof record.heeftSleutel !== 'boolean' ||
    typeof record.geconfigureerd !== 'boolean' ||
    typeof record.activationState !== 'string' ||
    !activationStates.has(record.activationState) ||
    typeof record.credentialSource !== 'string' ||
    !credentialSources.has(record.credentialSource) ||
    typeof record.storedTenantCredentialPresent !== 'boolean' ||
    typeof record.legacy !== 'boolean' ||
    typeof record.productionAllowed !== 'boolean' ||
    typeof record.canTest !== 'boolean'
  ) {
    throw new Error('Het AI-instellingencontract van de backend is onvolledig of onbekend.')
  }

  const endpoint =
    record.endpoint == null ? '' : typeof record.endpoint === 'string' ? record.endpoint : null
  const model = record.model == null ? '' : typeof record.model === 'string' ? record.model : null
  if (endpoint === null || model === null) {
    throw new Error('Het AI-instellingencontract bevat ongeldige veldtypen.')
  }
  const legacyOAuth = record.legacyOAuth
  const managedAi = record.managedAi
  if (
    !managedAi ||
    typeof managedAi !== 'object' ||
    typeof (managedAi as Record<string, unknown>).available !== 'boolean' ||
    typeof (managedAi as Record<string, unknown>).reasonCode !== 'string' ||
    typeof (managedAi as Record<string, unknown>).nextStep !== 'string'
  ) {
    throw new Error('Het AI-instellingencontract mist de Managed AI-capability.')
  }
  if (
    !legacyOAuth ||
    typeof legacyOAuth !== 'object' ||
    typeof (legacyOAuth as Record<string, unknown>).available !== 'boolean' ||
    typeof (legacyOAuth as Record<string, unknown>).linked !== 'boolean' ||
    (legacyOAuth as Record<string, unknown>).productionAllowed !== false
  ) {
    throw new Error('Het AI-instellingencontract mist een veilige legacy-OAuth-capability.')
  }
  if (
    record.credentialFingerprint != null &&
    (typeof record.credentialFingerprint !== 'string' ||
      !/^sha256:[a-f0-9]{12}$/i.test(record.credentialFingerprint))
  ) {
    throw new Error('Het AI-instellingencontract bevat een ongeldige credentialfingerprint.')
  }
  if (
    record.credentialUpdatedAt != null &&
    (typeof record.credentialUpdatedAt !== 'string' ||
      Number.isNaN(Date.parse(record.credentialUpdatedAt)))
  ) {
    throw new Error('Het AI-instellingencontract bevat een ongeldige rotatiedatum.')
  }
  if (record.errorCode != null && typeof record.errorCode !== 'string') {
    throw new Error('Het AI-instellingencontract bevat een ongeldige foutcode.')
  }
  if (
    record.storedTenantCredentialProvider != null &&
    (typeof record.storedTenantCredentialProvider !== 'string' ||
      !apiProviders.has(record.storedTenantCredentialProvider))
  ) {
    throw new Error('Het AI-instellingencontract bevat een ongeldige credentialproviderbinding.')
  }

  return {
    provider: record.provider as AiStatusProvider,
    endpoint,
    model,
    mode: record.mode as AiMode,
    heeftSleutel: record.heeftSleutel,
    geconfigureerd: record.geconfigureerd,
    activationState: record.activationState as AiActivationState,
    credentialSource:
      record.credentialSource === 'managed-protected'
        ? 'tenant-protected'
        : (record.credentialSource as AiCredentialSource),
    credentialFingerprint: record.credentialFingerprint as string | undefined,
    credentialUpdatedAt: record.credentialUpdatedAt as string | undefined,
    storedTenantCredentialPresent: record.storedTenantCredentialPresent,
    storedTenantCredentialProvider: record.storedTenantCredentialProvider as
      | Exclude<AiProvider, 'chatgpt'>
      | undefined,
    errorCode: record.errorCode as string | undefined,
    legacy: record.legacy,
    productionAllowed: record.productionAllowed,
    canTest: record.canTest,
    managedAi: {
      available: (managedAi as Record<string, unknown>).available as boolean,
      reasonCode: (managedAi as Record<string, unknown>).reasonCode as string,
      nextStep: (managedAi as Record<string, unknown>).nextStep as string,
    },
    legacyOAuth: {
      available: (legacyOAuth as Record<string, unknown>).available as boolean,
      linked: (legacyOAuth as Record<string, unknown>).linked as boolean,
      productionAllowed: false,
    },
  }
}

/** Vertaalt de autoritatieve backendstatus naar begrijpelijke beheerstatus. */
export function bepaalAiBeheerweergave(
  instellingen: AiInstellingenSnapshot | null,
  verbindingstest?: AiVerbindingstest | null,
): AiBeheerweergave {
  if (!instellingen) {
    return {
      modus: 'eigen-providercredential',
      modusLabel: 'Eigen providercredential',
      status: 'niet-geconfigureerd',
      statusLabel: 'niet geconfigureerd',
      toelichting: 'Er is nog geen betrouwbare configuratiestatus geladen.',
    }
  }

  if (
    instellingen.provider === 'invalid' ||
    instellingen.activationState === 'invalid-configuration'
  ) {
    return {
      modus: 'eigen-providercredential',
      modusLabel: 'Configuratie herstellen',
      status: 'niet-geconfigureerd',
      statusLabel: 'configuratiefout',
      toelichting: instellingen.errorCode
        ? `De backend blokkeert AI fail-closed (${instellingen.errorCode}). Herstel de opgeslagen configuratie.`
        : 'De backend blokkeert een ongeldige AI-configuratie fail-closed.',
    }
  }

  if (instellingen.mode === 'disabled') {
    return {
      modus: 'uit',
      modusLabel: 'Uit',
      status: 'uitgeschakeld',
      statusLabel: 'uitgeschakeld',
      toelichting: 'De persistente AI-kill-switch staat uit; AI-aanroepen worden geweigerd.',
    }
  }

  if (instellingen.provider === 'chatgpt' || instellingen.legacy) {
    const testPast =
      verbindingstest?.ok === true &&
      verbindingstest.provider === 'chatgpt' &&
      verbindingstest.model === instellingen.model
    return {
      modus: 'chatgpt-account',
      modusLabel: 'ChatGPT-account (OAuth)',
      status: instellingen.legacyOAuth.linked ? 'verbonden' : 'niet-geconfigureerd',
      statusLabel: instellingen.legacyOAuth.linked ? 'verbonden' : 'niet gekoppeld',
      toelichting: instellingen.legacyOAuth.linked
        ? testPast
          ? `Het lokale ChatGPT-account en de modelaanroep zijn getest op ${new Date(verbindingstest.testedAt).toLocaleString('nl-NL')}.`
          : 'Het ChatGPT-account is lokaal gekoppeld. Voer desgewenst de verbindingstest uit om ook een modelaanroep te controleren.'
        : instellingen.legacyOAuth.available
          ? 'Er is nog geen ChatGPT-account gekoppeld. Kies “Inloggen met ChatGPT” om de lokale OAuth-aanmelding te starten.'
          : 'ChatGPT-accountkoppeling is in deze omgeving niet beschikbaar.',
    }
  }

  const modus =
    instellingen.mode === 'managed'
      ? { id: 'managed-ai' as const, label: 'Managed AI' }
      : { id: 'eigen-providercredential' as const, label: 'Eigen providercredential' }
  if (instellingen.activationState !== 'active' || !instellingen.geconfigureerd) {
    return {
      modus: modus.id,
      modusLabel: modus.label,
      status: 'niet-geconfigureerd',
      statusLabel: 'niet geconfigureerd',
      toelichting:
        instellingen.mode === 'managed' && !instellingen.managedAi.available
          ? instellingen.managedAi.nextStep
          : instellingen.errorCode
            ? `De configuratie is fail-closed geblokkeerd (${instellingen.errorCode}).`
            : 'Provider, model of credential is nog niet volledig en geldig opgeslagen.',
    }
  }

  const testPast =
    verbindingstest?.ok === true &&
    verbindingstest.provider === instellingen.provider &&
    verbindingstest.model === instellingen.model
  return {
    modus: modus.id,
    modusLabel: modus.label,
    status: testPast ? 'verbonden' : 'test-nodig',
    statusLabel: testPast ? 'verbonden' : 'test nodig',
    toelichting: testPast
      ? `De server-side verbindingstest slaagde op ${new Date(verbindingstest.testedAt).toLocaleString('nl-NL')}.`
      : 'De configuratie is actief, maar is in deze beheersessie nog niet server-side getest.',
  }
}

export function parseAiVerbindingstest(waarde: unknown): AiVerbindingstest {
  if (!waarde || typeof waarde !== 'object') {
    throw new Error('De backend gaf geen geldige verbindingstest terug.')
  }
  const record = waarde as Record<string, unknown>
  if (
    record.ok !== true ||
    typeof record.provider !== 'string' ||
    record.provider === 'disabled' ||
    !bekendeProviders.has(record.provider) ||
    typeof record.model !== 'string' ||
    typeof record.testedAt !== 'string' ||
    Number.isNaN(Date.parse(record.testedAt))
  ) {
    throw new Error('Het resultaat van de AI-verbindingstest is onvolledig.')
  }
  return record as unknown as AiVerbindingstest
}

export function isApiProvider(provider: AiProvider): provider is Exclude<AiProvider, 'chatgpt'> {
  return apiProviders.has(provider)
}
