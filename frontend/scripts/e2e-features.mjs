// E2E van de nieuwe features tegen de echte backend: workflow/versies,
// beheer, begeleid-extra's, gids, favorieten en een echte PDF-import.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { vereisE2eAdminWachtwoord } from './e2e-credentials.mjs'

const base = process.argv[2] ?? 'http://localhost:5175'
const adminWachtwoord = vereisE2eAdminWachtwoord()
const pdfPad = fileURLToPath(new URL('../../5. Service v3.3.pdf', import.meta.url))
const outDir = fileURLToPath(new URL('../.shots/', import.meta.url))
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const fouten = []
page.on('pageerror', (e) => fouten.push(e.message))

const shot = async (naam, wacht = 600) => {
  await page.waitForTimeout(wacht)
  await page.screenshot({ path: `${outDir}${naam}.png` })
  console.log('shot:', naam)
}

// Login
await page.goto(`${base}/`)
await page.fill('input[autocomplete="username"]', 'Admin')
await page.fill('input[type="password"]', adminWachtwoord)
await page.click('button[type="submit"]')
await page.waitForSelector('.card-grid')

// Favorieten + sidebar
await page.click('.fav-knop >> nth=0')
await shot('f-01-overzicht-favoriet')

// Workflow-balk + versies
await page.goto(`${base}/proces/service-aanvraagproces`)
await page.waitForSelector('.wf-balk')
await page.click('text=🕘 Versies')
await shot('f-02-workflow-versies')

// Begeleid: casekaart + trainingsmodus + waarom
await page.goto(`${base}/begeleid`)
await page.check('.bm-opties input[type="checkbox"]')
await page.click('text=⚡ Snelle casekaart')
await shot('f-03-begeleid-casekaart')
await page.click('text=⚡ Spring naar de juiste route')
// Aanvraagproces heeft 2 secties → kanaalkeuze verschijnt (of direct de stappen)
await page.waitForSelector('.bm-ingang:has-text("Website"), .bm-kaart', { timeout: 15000 })
const kanaal = page.locator('.bm-ingang', { hasText: 'Website' })
if (await kanaal.count()) await kanaal.first().click()
await page.waitForSelector('.bm-kaart')
await page.click('text=❓ Waarom deze stap?')
await shot('f-04-begeleid-waarom-training')

// Beheer: suggesties + gebruikers
await page.goto(`${base}/beheer`)
await shot('f-05-beheer-suggesties')
const gebruikersTab = page.locator('button', { hasText: '👥 Gebruikers' })
if (await gebruikersTab.count()) {
  await gebruikersTab.click()
  await shot('f-06-beheer-gebruikers')
}

// Gids
await page.goto(`${base}/gids`)
await shot('f-07-gids')

// Echte PDF-import (volledige flow)
await page.goto(`${base}/import`)
await page.setInputFiles('input[type="file"]', pdfPad)
console.log('PDF geüpload; wachten op herkenning…')
await page.waitForSelector('.import-review', { timeout: 120000 })
await shot('f-08-import-review', 1200)
// Filter op lage zekerheid
await page.check('.import-kop input[type="checkbox"]')
await shot('f-09-import-lage-zekerheid')

await browser.close()
if (fouten.length) {
  console.log('PAGE-ERRORS:', fouten.join(' | '))
  process.exit(1)
}
console.log('E2E FEATURES KLAAR')
