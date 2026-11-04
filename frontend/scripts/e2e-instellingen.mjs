// Gerichte regressietest voor de centrale instellingen-ingang.
// Gebruik: node scripts/e2e-instellingen.mjs [baseUrl]
import { existsSync } from 'node:fs'
import { chromium } from 'playwright'

const base = process.argv[2] ?? 'http://127.0.0.1:4174'
const windowsChrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const executablePath = existsSync(windowsChrome) ? windowsChrome : undefined

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function wachtOpActieveTab(locator) {
  const element = await locator.elementHandle()
  if (!element) throw new Error('Beheertab kon niet worden gevonden.')
  await page.waitForFunction(
    (tab) => tab instanceof HTMLElement && tab.classList.contains('active'),
    element,
  )
}

const browser = await chromium.launch({ executablePath })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const beheerApiAanroepen = []
page.on('request', (request) => {
  if (new URL(request.url()).pathname.startsWith('/api/admin/')) {
    beheerApiAanroepen.push(`${request.method()} ${new URL(request.url()).pathname}`)
  }
})

await page.goto(base)
await page.getByText('Lokale demo met mockdata actief.', { exact: true }).waitFor()
await page.getByText('Demoomgeving', { exact: true }).waitFor()
const instellingen = page.getByRole('link', { name: 'Instellingen en beheer' })
await instellingen.waitFor()
assert(
  new URL(await instellingen.getAttribute('href'), base).pathname === '/beheer',
  'De centrale instellingenknop verwijst niet naar /beheer.',
)

await instellingen.click()
await page.waitForURL('**/beheer')
await page.getByRole('heading', { name: 'Instellingen', exact: true }).waitFor()
assert(
  (await instellingen.getAttribute('class'))?.split(/\s+/).includes('active'),
  'De instellingenknop toont geen actieve staat op /beheer.',
)
assert(
  (await instellingen.getAttribute('aria-current')) === 'page',
  'De actieve instellingenknop mist aria-current="page".',
)

// Deze regressietest draait expliciet tegen de lokale mockmodus. De runtimebron
// staat standaard open, is alleen-lezen en bevat geen tenant-schakelaar.
const runtimeTab = page.getByRole('button', { name: 'Omgeving', exact: true })
await runtimeTab.waitFor()
assert(
  (await runtimeTab.getAttribute('class'))?.split(/\s+/).includes('active'),
  'Runtime is niet de standaard beheer-tab.',
)
const runtimeBeheer = page.locator('.runtime-beheer')
await runtimeBeheer
  .getByRole('heading', { name: 'Omgeving', exact: true })
  .waitFor()
await runtimeBeheer.getByText('Lokale demo met mockdata actief', { exact: true }).waitFor()
await runtimeBeheer.getByText('Geen tenant-schakelaar', { exact: true }).waitFor()
assert(
  (await runtimeBeheer.locator('input, select, textarea').count()) === 0,
  'De alleen-lezen runtimekaart bevat toch een gegevensbronschakelaar.',
)

// Een redacteur zonder beheerrol ziet waar AI wordt beheerd, inclusief een
// concrete uitleg waarom de configuratie vergrendeld is.
const aiTab = page.getByRole('button', { name: '🤖 AI-koppeling 🔒', exact: true })
await aiTab.waitFor()
await aiTab.click()
await page.waitForURL('**/beheer?tab=ai')
await wachtOpActieveTab(aiTab)
assert(
  (await aiTab.getAttribute('class'))?.split(/\s+/).includes('active'),
  'De vergrendelde AI-koppeling wordt niet actief na selectie.',
)

const vergrendeldeAi = page.locator('.ai-instellingen.ai-vergrendeld')
await vergrendeldeAi.getByRole('heading', { name: '🔒 AI-providerbeheer', exact: true }).waitFor()
await vergrendeldeAi.getByText('is de rol beheren vereist', { exact: false }).waitFor()
await vergrendeldeAi.getByText('Lokale demo met mockdata actief', { exact: true }).waitFor()
await vergrendeldeAi
  .getByText('In deze lokale mockmodus zijn externe koppelingen niet beschikbaar.', {
    exact: true,
  })
  .waitFor()
assert(
  (await vergrendeldeAi.locator('input, select, textarea, button').count()) === 0,
  'Een niet-beheerder kan toch AI-configuratiecontrols bedienen.',
)
assert(
  (await vergrendeldeAi.getByText(/Opslaan|OAuth-aanmelding starten/).count()) === 0,
  'Een niet-beheerder ziet een uitvoerbare opslag- of OAuth-actie.',
)

// Suggestiebeheer blijft voor de redacteur bereikbaar en schrijft de actieve
// tab naar de URL, zodat terug/vooruit en deelbare beheerlinks voorspelbaar zijn.
await page.getByRole('button', { name: '💬 Suggesties', exact: true }).click()
await page.waitForURL('**/beheer?tab=suggesties')
await page.locator('.rol-filter').waitFor()

// Een directe query-deeplink moet de AI-uitleg opnieuw openen, ook na een
// volledige navigatie (dus niet alleen na lokale React-state).
await page.goto(new URL('/beheer?tab=ai', base).toString())
await page.getByRole('heading', { name: 'Instellingen', exact: true }).waitFor()
await vergrendeldeAi.getByRole('heading', { name: '🔒 AI-providerbeheer', exact: true }).waitFor()
await wachtOpActieveTab(aiTab)
assert(
  (await aiTab.getAttribute('class'))?.split(/\s+/).includes('active'),
  'De deeplink /beheer?tab=ai activeert de AI-tab niet.',
)
assert(
  beheerApiAanroepen.length === 0,
  `Mockmodus deed onverwacht beheer-API-aanroepen: ${beheerApiAanroepen.join(', ')}`,
)

await page.setViewportSize({ width: 600, height: 800 })
const compact = await instellingen.boundingBox()
assert(
  compact && compact.width >= 40 && compact.height >= 40,
  `De compacte instellingenknop is te klein (${compact ? `${compact.width}×${compact.height}` : 'geen afmetingen'}).`,
)
assert(await instellingen.isVisible(), 'De instellingenknop verdwijnt op een smal scherm.')

await browser.close()
console.log(
  '✔ Instellingen: expliciete lokale mockbron, read-only runtime, vergrendeld AI-beheer, deeplinks, a11y en responsive gedrag zijn correct.',
)
