// End-to-end test tegen de echte backend (VITE_DATA_SOURCE=api):
// login-scherm → inloggen → overzicht uit API → procesdetail → uitloggen.
import { chromium } from 'playwright'
import { mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { vereisE2eAdminWachtwoord } from './e2e-credentials.mjs'

const base = process.argv[2] ?? 'http://localhost:5173'
const adminWachtwoord = vereisE2eAdminWachtwoord()
const outDir = fileURLToPath(new URL('../.shots/', import.meta.url))
const fixturePath = fileURLToPath(
  new URL('../../contract/fixtures/service-aanvraagproces.json', import.meta.url),
)
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const fouten = []
page.on('pageerror', (e) => fouten.push(e.message))

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const shot = async (naam) => {
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${outDir}${naam}.png` })
  console.log('shot:', naam)
}

await page.goto(`${base}/`)
await shot('e2e-01-login')

// Inloggen met het expliciet gebootstrapte lokale testaccount.
await page.fill('input[autocomplete="username"]', 'Admin')
await page.fill('input[type="password"]', adminWachtwoord)
await page.click('button[type="submit"]')
await page.getByText('Uitloggen', { exact: true }).waitFor({ timeout: 10000 })
await page.locator('.card-grid').waitFor({ state: 'attached' })
await page.getByText('Databron: Backenddatabase', { exact: true }).waitFor()
assert(
  (await page.getByText('Lokale demo met mockdata actief.', { exact: true }).count()) === 0,
  'De normale API-runtime toont ten onrechte de lokale demobanner.',
)
const runtimeResponse = await page.request.get(`${base}/api/config`)
assert(runtimeResponse.ok(), `Runtimeconfig ophalen faalde: ${runtimeResponse.status()}`)
const runtimeConfig = await runtimeResponse.json()
assert(
  runtimeConfig.runtime?.mode === 'standard' &&
    runtimeConfig.runtime?.dataSource === 'database' &&
    runtimeConfig.runtime?.isDemo === false &&
    runtimeConfig.runtime?.fallbackUsed === false,
  `De normale runtime is niet fail-closed standard/database: ${JSON.stringify(runtimeConfig.runtime)}`,
)
await shot('e2e-02-overzicht-uit-api')

// Standard/database mag op een schone installatie leeg zijn. Maak uitsluitend
// voor deze testrun een eigen fixture-id aan en ruim die aan het einde op.
const processenResponse = await page.request.get(`${base}/api/processes`)
assert(processenResponse.ok(), `Proceslijst ophalen faalde: ${processenResponse.status()}`)
const bestaandeProcessen = await processenResponse.json()
const bestaandReferentieproces = bestaandeProcessen.find(
  (proces) =>
    proces.id === 'service-aanvraagproces' ||
    proces.detailproces === 'Service – Aanvraagproces',
)
let processId = bestaandReferentieproces?.id
let tijdelijkProcesAangemaakt = false
if (!processId) {
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'))
  fixture.id = `e2e-api-runtime-${Date.now().toString(36)}`
  fixture.detailproces = `${fixture.detailproces} · API E2E`
  const importResponse = await page.request.post(`${base}/api/processes/import-json`, {
    data: fixture,
  })
  assert(
    importResponse.status() === 201,
    `Tijdelijk API-testproces aanmaken faalde: ${importResponse.status()} ${await importResponse.text()}`,
  )
  processId = fixture.id
  tijdelijkProcesAangemaakt = true
}
assert(processId, 'Geen proces beschikbaar voor de API-detailtest.')

// Alleen-lezen controle van de AI-instellingen in API-modus. We wijzigen de
// provider uitsluitend lokaal in het formulier en klikken nooit op Opslaan of
// OAuth, zodat deze regressietest geen externe of opgeslagen toestand wijzigt.
const aiMutaties = []
const registreerAiMutatie = (request) => {
  const pad = new URL(request.url()).pathname
  if (
    request.method() !== 'GET' &&
    (pad === '/api/admin/ai-instellingen' || pad.startsWith('/api/admin/chatgpt-oauth/'))
  ) {
    aiMutaties.push(`${request.method()} ${pad}`)
  }
}
page.on('request', registreerAiMutatie)

const ruweAiStatus = await page.evaluate(async () => {
  const response = await fetch('/api/admin/ai-instellingen')
  return { status: response.status, body: await response.json() }
})
console.log('AI-statuscontract:', JSON.stringify(ruweAiStatus))

await page.goto(`${base}/beheer?tab=ai`)
await page.getByRole('heading', { name: 'Instellingen', exact: true }).waitFor()
const aiInstellingen = page.locator('.ai-instellingen:not(.ai-vergrendeld)')
await aiInstellingen.getByRole('heading', { name: 'AI-koppeling', exact: true }).waitFor()
await aiInstellingen.getByText('Backend-API actief', { exact: true }).waitFor()
await aiInstellingen.getByText('Huidige modus', { exact: true }).waitFor()

const modusWaarden = await aiInstellingen
  .locator('input[name="ai-mode"]')
  .evaluateAll((inputs) => inputs.map((input) => input.value))
assert(
  JSON.stringify(modusWaarden) === JSON.stringify(['disabled', 'managed', 'byo']),
  `Onverwachte AI-modi: ${modusWaarden.join(', ')}`,
)
try {
  await page.waitForFunction(() => {
    const invoer = document.querySelector(
      '.ai-instellingen:not(.ai-vergrendeld) input[name="ai-mode"][value="byo"]',
    )
    return invoer instanceof HTMLInputElement && !invoer.disabled
  })
} catch {
  throw new Error(
    `AI-beheer bleef vergrendeld na laden: ${(await aiInstellingen.textContent())?.replace(/\s+/g, ' ').trim()}`,
  )
}
await aiInstellingen.locator('input[name="ai-mode"][value="byo"]').check()

const provider = aiInstellingen.getByRole('combobox', { name: 'Provider', exact: true })
const model = aiInstellingen.getByRole('textbox', { name: 'Model / deployment', exact: true })
assert(await provider.isEnabled(), 'De providerkeuze is uitgeschakeld in API-modus.')
assert(await model.isEnabled(), 'Het modelveld is uitgeschakeld in API-modus.')

const providerWaarden = await provider.locator('option').evaluateAll((opties) =>
  opties.map((optie) => optie.value),
)
assert(
  JSON.stringify(providerWaarden) ===
    JSON.stringify(['azure-openai', 'openai', 'anthropic']),
  `Onverwachte AI-providers: ${providerWaarden.join(', ')}`,
)

await provider.selectOption('openai')
const apiSleutel = aiInstellingen.locator('input[type="password"]')
await apiSleutel.waitFor()
assert(await apiSleutel.isEnabled(), 'Het OpenAI API-sleutelveld is uitgeschakeld in API-modus.')

await provider.selectOption('azure-openai')
const azureEndpoint = aiInstellingen.getByRole('textbox', { name: 'Azure-endpoint', exact: true })
await azureEndpoint.waitFor()
assert(await azureEndpoint.isEnabled(), 'Het Azure-endpointveld is uitgeschakeld in API-modus.')

assert(
  (await aiInstellingen.getByText('Lokale OAuth-aanmelding starten', { exact: true }).count()) ===
    0,
  'Legacy ChatGPT OAuth wordt zonder expliciete backendcapability toch getoond.',
)
assert(
  aiMutaties.length === 0,
  `De veilige AI-instellingencheck deed onverwacht mutaties: ${aiMutaties.join(', ')}`,
)
page.off('request', registreerAiMutatie)
console.log('AI-beheer in API-modus: modi, provideropties en write-only invoer zijn beschikbaar (geen mutaties).')

await page.goto(
  `${base}/proces/${processId}${tijdelijkProcesAangemaakt ? '?workspace=1' : ''}`,
)
await page.waitForSelector('.pv-root', { timeout: 10000 })
await shot('e2e-03-proces-uit-api')

// Sessie blijft staan na refresh (cookie spg_session)?
await page.reload()
await page.waitForSelector('.pv-root', { timeout: 10000 })
console.log('sessie na refresh: OK')

if (tijdelijkProcesAangemaakt) {
  const cleanup = await page.request.delete(`${base}/api/processes/${processId}`)
  assert(
    cleanup.ok(),
    `Tijdelijk API-testproces opruimen faalde: ${cleanup.status()} ${await cleanup.text()}`,
  )
}

await page.click('text=Uitloggen')
await page.waitForSelector('.login-kaart', { timeout: 10000 })
await shot('e2e-04-uitgelogd')

await browser.close()
if (fouten.length) {
  console.log('PAGE-ERRORS:', fouten.join(' | '))
  process.exit(1)
}
console.log('E2E KLAAR — login, data uit API, sessie en logout werken.')
