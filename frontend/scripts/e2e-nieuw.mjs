// Smoke-e2e van de nieuwste features: dashboard, donker thema, BC-tab,
// BC-503 zonder configuratie, zoek-highlight en recent-bekeken.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { vereisE2eAdminWachtwoord } from './e2e-credentials.mjs'

const base = process.argv[2] ?? 'http://localhost:5090'
const adminWachtwoord = vereisE2eAdminWachtwoord()
const outDir = fileURLToPath(new URL('../.shots/', import.meta.url))
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const stap = (n) => console.log('✔', n)

await page.goto(`${base}/`)
await page.fill('input[autocomplete="username"]', 'Admin')
await page.fill('input[type="password"]', adminWachtwoord)
await page.click('button[type="submit"]')
await page.waitForSelector('.card-grid')

// Recent bekeken: bezoek twee processen en check de rij op het overzicht
await page.goto(`${base}/proces/service-testen`)
await page.waitForSelector('.wf-balk')
await page.goto(`${base}/proces/transferorders`)
await page.waitForSelector('.wf-balk')
await page.goto(`${base}/`)
await page.waitForSelector('.recent-rij')
stap('recent bekeken-rij op overzicht')

// Dashboard
await page.goto(`${base}/dashboard`)
await page.waitForSelector('.dash-statusbalk')
await page.screenshot({ path: `${outDir}v-01-dashboard.png`, timeout: 15000 })
stap('dashboard rendert (statusbalk + lijsten)')

// Donker thema
await page.click('.thema-knop')
await page.waitForFunction(() => document.documentElement.dataset.thema === 'donker')
await page.screenshot({ path: `${outDir}v-02-donker.png`, timeout: 15000 })
await page.click('.thema-knop')
stap('donker thema togglet (en terug)')

// BC-tab + 503 zonder configuratie
await page.goto(`${base}/beheer`)
await page.click('text=🔗 Business Central')
await page.waitForSelector('text=Business Central koppelen')
stap('BC-instellingen-tab rendert')
const res = await page.request.get(`${base}/api/bc/zoek/TEST-123`)
if (res.status() !== 503) throw new Error(`BC zonder config: verwacht 503, kreeg ${res.status()}`)
stap('BC-lookup geeft nette 503 zonder configuratie')

// Zoek-highlight
await page.goto(`${base}/zoeken?q=fraude`)
await page.waitForSelector('mark')
stap('zoek-highlight (<mark>) zichtbaar')

await browser.close()
console.log('\nNIEUWE FEATURES OK')
