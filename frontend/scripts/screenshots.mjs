// Visuele review: schiet screenshots van alle hoofdschermen.
// Gebruik: node scripts/screenshots.mjs [baseUrl]   (default http://localhost:5173)
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const base = process.argv[2] ?? 'http://localhost:5173'
const outDir = fileURLToPath(new URL('../.shots/', import.meta.url))
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE-ERROR:', m.text())
})
page.on('pageerror', (e) => console.log('PAGE-ERROR:', e.message))

const shot = async (naam) => {
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${outDir}${naam}.png`, fullPage: false })
  console.log('shot:', naam)
}

await page.goto(`${base}/`)
await shot('01-overzicht')

await page.goto(`${base}/proces/service-aanvraagproces`)
await shot('02-proces-plaat')

await page.click('text=📋 Tabel')
await shot('03-proces-tabel')

// Stap aanklikken voor het detailpaneel (eerste rij in de tabel)
await page.click('.werkinstructie tbody tr >> nth=0')
await shot('04-detailpaneel')

// Rolfilter
await page.selectOption('.rol-filter', { index: 1 })
await page.click('text=🗺️ Plaat')
await shot('05-plaat-rolfilter')

await page.goto(`${base}/atlas`)
await shot('06-atlas')

await page.goto(`${base}/zoeken?q=rma`)
await shot('07-zoeken')

await page.goto(`${base}/begeleid`)
await shot('08-begeleid-start')
await page.click('text=Klant meldt iets')
await shot('09-begeleid-proces')
await page.click('text=Service – Aanvraagproces')
await shot('10-begeleid-kanaal')
await page.click('text=Website')
await shot('11-begeleid-stap')

await page.goto(`${base}/bouwer/service-aanvraagproces`)
await shot('12-bouwer')

await page.goto(`${base}/iso`)
await shot('13-iso')

await browser.close()
console.log('KLAAR — screenshots in .shots/')
