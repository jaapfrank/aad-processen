// End-to-end smoke voor de organisatiebrede assuranceketen.
// Gebruik: node scripts/e2e-assurance.mjs [baseUrl]
import { chromium } from 'playwright'

const base = process.argv[2] ?? 'http://127.0.0.1:4173'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const browserFouten = []

page.on('pageerror', (error) => browserFouten.push(`pageerror: ${error.message}`))
page.on('console', (message) => {
  const tekst = message.text()
  const verwachteOntwikkelsessieBootstrap =
    tekst.includes('status of 401') && tekst.includes('Unauthorized')
  if (message.type() === 'error' && !verwachteOntwikkelsessieBootstrap) {
    browserFouten.push(`console: ${tekst}`)
  }
})
page.on('response', (response) => {
  if (response.status() >= 500) {
    browserFouten.push(`${response.status()} ${response.request().method()} ${response.url()}`)
  }
})

try {
  await page.goto(new URL('/beheersing', base).toString(), { waitUntil: 'networkidle' })
  await page
    .getByRole('heading', { name: 'Grip op normen, risico’s, audits en uitvoering' })
    .waitFor()
  await page
    .getByText('Ontwikkelmodus: inloggen is tijdelijk overgeslagen.', { exact: true })
    .waitFor()
  await page.getByRole('heading', { name: 'Verplichte interne controle' }).waitFor()
  await page.getByText('Planning actief', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Controle nu uitvoeren' }).waitFor()
  await page.getByText('Sturing', { exact: true }).waitFor()
  await page.getByText('Normen & borging', { exact: true }).waitFor()
  await page.getByText('Processen & uitvoering', { exact: true }).waitFor()
  await page.screenshot({
    path: '/tmp/service-procesgids-beheersing-smoke.png',
    fullPage: true,
  })

  const editorLinks = page.getByRole('link', { name: 'Markeer in editor →' })
  if ((await editorLinks.count()) > 0) {
    await editorLinks.first().click()
    await page.waitForURL('**/bouwer/**')
    await page
      .getByRole('region', { name: 'ISO- en kaderbevindingen' })
      .waitFor({ timeout: 15_000 })
    const procesbevindingen = page.locator('details.pe-process-findings')
    await procesbevindingen.waitFor()
    await procesbevindingen.locator('summary').click()
    await procesbevindingen.getByText(/Proceseigenaar ontbreekt|Procesreview ontbreekt/).waitFor()
  }

  await page.goto(new URL('/beheer?tab=normen', base).toString(), {
    waitUntil: 'networkidle',
  })
  await page.getByRole('heading', { name: 'Normscope & continue controle' }).waitFor()
  await page.getByText(/Verplicht actief/).waitFor()

  const kaderkaarten = page.locator('.assurance-kaderkaart')
  const gekozenKaders = page.locator('.assurance-kaderkaart.gekozen')
  assert((await kaderkaarten.count()) >= 8, 'De verwachte basiscatalogus ontbreekt.')
  assert((await gekozenKaders.count()) >= 1, 'Er is geen actief normenkader.')

  const intervalOpties = await page
    .getByLabel('Gewenst controle-interval')
    .locator('option')
    .evaluateAll((options) => options.map((option) => Number(option.value)))
  assert(
    intervalOpties.length > 0 && intervalOpties.every((uren) => uren <= 720),
    'De UI laat een interval ruimer dan de verplichte bovengrens toe.',
  )

  const aiDetails = page.locator('details.assurance-ai-details')
  assert(
    !(await aiDetails.evaluate((element) => element.open)),
    'De AI-intake hoort standaard gesloten te zijn.',
  )
  await page.screenshot({
    path: '/tmp/service-procesgids-normscope-smoke.png',
    fullPage: true,
  })

  const aantalActieveKaders = await gekozenKaders.count()
  await page.goto(new URL('/normcoach', base).toString(), { waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: 'Normcoach', exact: true }).waitFor()
  await page.getByRole('heading', { name: 'Interne assurance, geen certificering' }).waitFor()
  assert(
    (await page.locator('.nc-kaderkaart').count()) === aantalActieveKaders,
    'De Normcoach toont niet exact de actieve normscope.',
  )
  await page.screenshot({
    path: '/tmp/service-procesgids-normcoach-smoke.png',
    fullPage: true,
  })

  assert(
    browserFouten.length === 0,
    `Browser- of serverfouten gevonden:\n${browserFouten.join('\n')}`,
  )
} finally {
  await browser.close()
}

console.log(
  '✔ Assurance: beheersingshub, normscope, verplichte controle, Normcoach en editor-markering zijn correct.',
)
