// Gerichte regressietest voor de centrale, toegankelijke import/exportwerkstroom.
// Gebruik: node scripts/e2e-uitwisseling.mjs [baseUrl]
import { existsSync } from 'node:fs'
import { chromium } from 'playwright'

const base = process.argv[2] ?? 'http://127.0.0.1:4174'
const windowsChrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const executablePath = existsSync(windowsChrome) ? windowsChrome : undefined

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const browser = await chromium.launch({ executablePath })
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
const pageErrors = []
page.on('pageerror', (error) => pageErrors.push(error.message))

try {
  await page.goto(
    `${base}/uitwisseling?processId=service-aanvraagproces&actie=importeren&formaat=drawio-xml`,
  )
  await page.getByRole('heading', { name: 'Import & export', exact: true }).waitFor()

  assert(
    (await page.locator('input[name="uitwisseling-actie"]').count()) === 2,
    'De keuze tussen importeren en exporteren is niet als radiogroep beschikbaar.',
  )
  assert(
    (await page.locator('.ux-formaten button').count()) === 5,
    'Visio, PDF, draw.io, Lucidchart en tabel staan niet alle vijf in de formaatskeuze.',
  )
  await page.getByRole('button', { name: /^PDF/ }).click()
  await page.waitForURL(/formaat=pdf/)
  assert(
    new URL(page.url()).searchParams.has('processId') === false,
    'De PDF-keuze houdt ten onrechte een bestaand doelproces vast.',
  )
  await page
    .getByText('Je PDF wordt een nieuw concept.', { exact: true })
    .waitFor()
  await page.getByText('PDF-import vereist de backend.', { exact: false }).waitFor()

  await page.locator('input[name="uitwisseling-actie"]').nth(1).click()
  await page.waitForURL(/actie=exporteren/)
  await page.waitForFunction(
    () => document.querySelectorAll('input[name="uitwisseling-actie"]')[1]?.checked === true,
  )
  assert(
    await page.locator('input[name="uitwisseling-actie"]').nth(1).isChecked(),
    'De exportkeuze is na URL-navigatie niet actief.',
  )
  assert(
    new URL(page.url()).searchParams.has('processId') === false,
    'De eerder verwijderde PDF-doelkeuze kwam bij exporteren onverwacht terug.',
  )
  assert(
    await page.getByRole('button', { name: /^PDF/ }).isDisabled(),
    'PDF wordt ten onrechte als bewerkbare export aangeboden.',
  )
  const procesSelect = page.getByRole('combobox', { name: 'Proces', exact: true })
  await procesSelect.waitFor()
  await procesSelect.selectOption('service-aanvraagproces')
  await page.waitForURL(/processId=service-aanvraagproces/)
  await page.waitForFunction(
    () =>
      document.querySelector('.ux-proceskeuze select')?.value ===
      'service-aanvraagproces',
  )
  assert(
    (await procesSelect.inputValue()) === 'service-aanvraagproces',
    'Het gekozen exportproces is niet geselecteerd gebleven.',
  )
  await page.getByRole('button', { name: /Exporteer \.drawio/ }).waitFor()
  assert(
    (await page.locator('.dx-formaat').count()) === 1,
    'De uitvoerstap toont meer formaten dan de gekozen adapter.',
  )

  await page.getByRole('button', { name: /^Lucidchart/ }).click()
  const lucidExport = page.getByRole('button', { name: /Exporteer \.lucid/ })
  await lucidExport.waitFor()
  assert(await lucidExport.isDisabled(), 'Lucid-export is in lokale mockmodus toch actief.')

  await page.goto(`${base}/uitwisseling?actie=importeren&formaat=drawio-xml`)
  await page.setInputFiles('input[accept*=".drawio"]', {
    name: 'ongeldig.drawio',
    mimeType: 'application/xml',
    buffer: Buffer.from('dit is geen XML'),
  })
  const importAlert = page.locator('.dx-melding[role="alert"], .dx-review-status[role="alert"]').first()
  await importAlert.waitFor()
  assert(
    await importAlert.evaluate((element) => {
      const review = element.closest('.dx-rapport')
      return document.activeElement === element || document.activeElement === review
    }),
    'Een importfout verplaatst de focus niet naar de fout of importreview.',
  )

  await page.goto(`${base}/proces/service-aanvraagproces`)
  await page.locator('.proces-uitwisseling-compact').waitFor()
  assert(
    (await page.locator('details.dx-paneel').count()) === 0,
    'ProcesDetail toont nog het grote diagramuitwisselingsblok.',
  )
  const detailExport = page
    .locator('.proces-uitwisseling-compact')
    .getByRole('link', { name: 'Exporteren', exact: true })
  assert(
    (await detailExport.getAttribute('href'))?.includes(
      'processId=service-aanvraagproces&actie=exporteren',
    ),
    'De compacte ProcesDetail-link behoudt het processId niet.',
  )

  await page.goto(`${base}/bouwer/service-aanvraagproces`)
  await page.locator('.bouwer-uitwisseling-compact').waitFor()
  assert(
    (await page.locator('details.dx-paneel').count()) === 0,
    'De builder toont nog het grote diagramuitwisselingsblok.',
  )

  await page.goto(`${base}/import`)
  await page.getByRole('heading', { name: 'PDF-import', exact: true }).waitFor()
  await page.getByText('PDF-import vereist de backend.', { exact: false }).waitFor()
  assert(pageErrors.length === 0, `Paginacrash: ${pageErrors.join(' | ')}`)
} finally {
  await browser.close()
}

console.log(
  JSON.stringify({
    ok: true,
    checks: {
      accessibleDirectionChoice: true,
      fourFormatsBundled: true,
      processIdPreserved: true,
      capabilityGating: true,
      accessibleImportError: true,
      compactBuilderAndDetailLinks: true,
      legacyPdfRoute: true,
    },
  }),
)
