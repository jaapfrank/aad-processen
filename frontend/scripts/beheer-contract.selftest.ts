import assert from 'node:assert/strict'
import {
  beschrijfRuntime,
  bepaalAiBeheerweergave,
  leesBackendRuntime,
  parseAiInstellingenSnapshot,
} from '../src/lib/beheerModel.ts'

const opgeslagen = parseAiInstellingenSnapshot({
  provider: 'openai',
  endpoint: '',
  model: 'vastgesteld-model',
  mode: 'byo',
  heeftSleutel: true,
  geconfigureerd: true,
  activationState: 'active',
  credentialSource: 'managed-protected',
  credentialFingerprint: 'sha256:123456abcdef',
  credentialUpdatedAt: '2026-07-27T10:00:00Z',
  storedTenantCredentialPresent: true,
  storedTenantCredentialProvider: 'openai',
  legacy: false,
  productionAllowed: true,
  canTest: true,
  managedAi: {
    available: false,
    reasonCode: 'managed-ai-not-enabled',
    nextStep: 'Laat een platformbeheerder Managed AI activeren.',
  },
  legacyOAuth: { available: false, linked: false, productionAllowed: false },
})

const uitgeschakeld = parseAiInstellingenSnapshot({
  provider: 'disabled',
  endpoint: '',
  model: '',
  mode: 'disabled',
  heeftSleutel: false,
  geconfigureerd: false,
  activationState: 'disabled',
  credentialSource: 'none',
  storedTenantCredentialPresent: false,
  legacy: false,
  productionAllowed: true,
  canTest: false,
  managedAi: {
    available: false,
    reasonCode: 'managed-ai-not-enabled',
    nextStep: 'Laat een platformbeheerder Managed AI activeren.',
  },
  legacyOAuth: {
    available: false,
    linked: false,
    productionAllowed: false,
  },
})
assert.equal(
  bepaalAiBeheerweergave(uitgeschakeld).status,
  'uitgeschakeld',
  'De veilige backendstandaard provider=disabled moet als uitgeschakeld laden.',
)
const ongeldigeBackendstatus = parseAiInstellingenSnapshot({
  ...uitgeschakeld,
  provider: 'invalid',
  activationState: 'invalid-configuration',
  errorCode: 'ai-settings-unreadable',
})
assert.equal(
  ongeldigeBackendstatus.provider,
  'invalid',
  'De expliciete veilige backendstatus invalid moet parseerbaar blijven voor herstel-UX.',
)
assert.equal(
  bepaalAiBeheerweergave(ongeldigeBackendstatus).statusLabel,
  'configuratiefout',
  'Een invalid backendstatus mag niet als gewone uitgeschakelde modus worden verhuld.',
)

const chatGptNietGekoppeld = parseAiInstellingenSnapshot({
  ...uitgeschakeld,
  provider: 'chatgpt',
  model: 'gpt-5.5',
  mode: 'byo',
  activationState: 'missing-credential',
  credentialSource: 'legacy-oauth',
  legacy: true,
  productionAllowed: false,
  legacyOAuth: { available: true, linked: false, productionAllowed: false },
})
assert.equal(
  bepaalAiBeheerweergave(chatGptNietGekoppeld).modusLabel,
  'ChatGPT-account (OAuth)',
  'De lokale OAuth-route moet als eigen productmodus worden gepresenteerd.',
)
assert.equal(
  bepaalAiBeheerweergave(chatGptNietGekoppeld).statusLabel,
  'niet gekoppeld',
  'Een ontbrekende lokale OAuth-sessie moet duidelijk als niet gekoppeld worden getoond.',
)

const chatGptGekoppeld = parseAiInstellingenSnapshot({
  ...chatGptNietGekoppeld,
  heeftSleutel: true,
  geconfigureerd: true,
  activationState: 'active',
  legacyOAuth: { available: true, linked: true, productionAllowed: false },
})
assert.equal(
  bepaalAiBeheerweergave(chatGptGekoppeld).statusLabel,
  'verbonden',
  'Een door de backend bevestigde OAuth-callback moet als verbonden worden getoond.',
)

assert.equal(
  bepaalAiBeheerweergave(opgeslagen).status,
  'test-nodig',
  'Een opgeslagen configuratie mag zonder server-side test nooit "verbonden" worden.',
)
assert.equal(
  bepaalAiBeheerweergave(opgeslagen).statusLabel,
  'test nodig',
  'De beheerstatus moet het ontbrekende testbewijs zichtbaar maken.',
)
assert.equal(
  bepaalAiBeheerweergave(opgeslagen, {
    ok: true,
    provider: 'openai',
    model: 'vastgesteld-model',
    testedAt: '2026-07-27T10:05:00Z',
  }).status,
  'verbonden',
  'Alleen een passende, geslaagde server-side test mag “verbonden” opleveren.',
)
assert.equal(
  Object.prototype.hasOwnProperty.call(opgeslagen, 'apiKey'),
  false,
  'Een genormaliseerde GET-status mag geen credential bevatten.',
)
assert.equal(
  opgeslagen.credentialSource,
  'tenant-protected',
  'De oude rolling-upgrade bronnaam moet naar tenant-protected normaliseren.',
)

assert.throws(
  () =>
    parseAiInstellingenSnapshot({
      provider: 'openai',
      endpoint: '',
      model: 'vastgesteld-model',
      mode: 'byo',
      heeftSleutel: true,
      geconfigureerd: true,
      activationState: 'active',
      credentialSource: 'managed-protected',
      storedTenantCredentialPresent: true,
      storedTenantCredentialProvider: 'openai',
      legacy: false,
      productionAllowed: true,
      canTest: true,
      managedAi: {
        available: false,
        reasonCode: 'managed-ai-not-enabled',
        nextStep: 'Laat een platformbeheerder Managed AI activeren.',
      },
      legacyOAuth: { available: false, linked: false, productionAllowed: false },
      apiKey: 'mag-nooit-terugkomen',
    }),
  /Onveilig AI-contract/,
  'Credentialmateriaal in een GET-response moet fail-closed worden geweigerd.',
)

assert.throws(
  () =>
    parseAiInstellingenSnapshot({
      provider: 'onbekende-provider',
      endpoint: '',
      model: '',
      mode: 'disabled',
      heeftSleutel: false,
      geconfigureerd: false,
      activationState: 'disabled',
      credentialSource: 'none',
      storedTenantCredentialPresent: false,
      legacy: false,
      productionAllowed: true,
      canTest: false,
      managedAi: {
        available: false,
        reasonCode: 'managed-ai-not-enabled',
        nextStep: 'Laat een platformbeheerder Managed AI activeren.',
      },
      legacyOAuth: { available: false, linked: false, productionAllowed: false },
    }),
  /onvolledig of onbekend/,
  'Een onbekende provider mag niet stil als geldige configuratie worden getoond.',
)

const mockRuntime = beschrijfRuntime('mock')
assert.equal(mockRuntime.gebruiktVoorbeelddata, true)
assert.equal(mockRuntime.heeftBackend, false)
assert.equal(mockRuntime.selectie, 'deployment-configuratie')

const apiRuntime = beschrijfRuntime('api')
assert.equal(apiRuntime.gebruiktVoorbeelddata, false)
assert.equal(apiRuntime.heeftBackend, true)

const backendDemo = leesBackendRuntime({
  runtime: {
    environment: 'Development',
    profile: 'r0',
    tenantType: 'single-tenant',
    mode: 'demo',
    dataSource: 'demo-fixtures',
    isDemo: true,
    syntheticData: true,
    fallbackUsed: false,
  },
})
assert.equal(backendDemo?.isDemo, true)
assert.equal(
  leesBackendRuntime({
    runtime: {
      environment: 'Production',
      profile: 'r0',
      tenantType: 'single-tenant',
      mode: 'standard',
      dataSource: 'demo-fixtures',
      isDemo: false,
      syntheticData: true,
      fallbackUsed: false,
    },
  }),
  null,
  'Een inconsistent runtimeprofiel moet fail-closed als onbekend gelden.',
)

console.log(
  '✔ Beheercontract: runtime is expliciet, alleen een server-test geeft “verbonden” en GET-secrets worden geweigerd.',
)
