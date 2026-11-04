// Volledige regressie tegen het standalone pakket: bouwer→workflow→goedkeuren,
// suggestie via UI→beheer-afhandeling, gebruikersbeheer, alleen-lezen modus,
// JSON-export, ISO en gids. Faalt hard bij elke afwijking.
import { chromium } from 'playwright'
import { vereisE2eAdminWachtwoord } from './e2e-credentials.mjs'

const base = process.argv[2] ?? 'http://localhost:5090'
const adminWachtwoord = vereisE2eAdminWachtwoord()
const testProcesId = `testproces-e2e-${Date.now().toString(36)}`
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
const page = await ctx.newPage()
const fouten = []
page.on('pageerror', (e) => fouten.push(`pageerror: ${e.message}`))
page.on('dialog', (dialog) => dialog.accept())

const stap = (naam) => console.log('✔', naam)
const login = async (gebruiker, wachtwoord) => {
  await page.waitForSelector('.login-kaart')
  await page.fill('input[autocomplete="username"]', gebruiker)
  await page.fill('input[type="password"]', wachtwoord)
  await page.click('button[type="submit"]')
}

// 1. Login als admin. Iedere run gebruikt een eigen proces-id, omdat verwijderen
// in het product bewust archiveert en een gearchiveerde id niet wordt hergebruikt.
await page.goto(`${base}/`)
await login('Admin', adminWachtwoord)
await page.getByText('Uitloggen', { exact: true }).waitFor({ timeout: 10000 })
await page.locator('.card-grid').waitFor({ state: 'attached' })
stap('login admin')

// 2. Bouwer: nieuw proces met één stap, opslaan als concept
await page.goto(`${base}/bouwer`)
await page.getByRole('button', { name: /Formulieren & controles/ }).click()
await page.fill('input[placeholder="bv. Service – Ontvangst"]', 'Testproces E2E')
await page.getByLabel('Id', { exact: true }).fill(testProcesId)
await page.click('text=+ Stap in "Hoofdflow"')
await page.click('.be-stap-kop')
await page.fill('.be-stap-form textarea >> nth=0', 'Eerste teststap via regressie')
await page.click('text=💾 Opslaan als concept')
await page.waitForURL(new RegExp(`/proces/${testProcesId}\\?workspace=1$`))
await page.waitForSelector('.pill-concept')
stap('bouwer: proces aangemaakt en opgeslagen als concept')

// 3. Workflow: indienen → goedkeuren → live
await page.click('text=📤 Indienen ter goedkeuring')
await page.waitForSelector('text=✅ Goedkeuren & live zetten')
stap('workflow: ingediend (in-review)')
await page.click('text=✅ Goedkeuren & live zetten')
await page.waitForSelector('.pill-live')
stap('workflow: goedgekeurd → live')

// 4. Suggestie indienen via stap-paneel (op het testproces, tabelweergave)
await page.goto(`${base}/proces/${testProcesId}`)
await page.click('text=📋 Tabel')
await page.click('.werkinstructie tbody tr >> nth=0')
await page.click('text=💬 Suggestie bij deze stap')
await page.selectOption('.suggestie-vak select', 'onduidelijk')
await page.fill('.suggestie-vak textarea', 'Regressietest-suggestie: graag verduidelijken.')
await page.click('.suggestie-vak >> text=Versturen')
await page.waitForSelector('text=✓ Bedankt')
stap('suggestie ingediend via UI')

// 5. Beheer: suggestie zichtbaar en afhandelen
await page.goto(`${base}/beheer?tab=suggesties`)
await page.waitForSelector('text=Regressietest-suggestie')
await page.click('button[title="Verwerkt"]')
await page.waitForTimeout(600)
stap('beheer: suggestie afgehandeld')

// 6. Beheer: alleen-lezen gebruiker aanmaken (idempotent bij herdraaien)
await page.click('text=👥 Gebruikers')
await page.waitForSelector('.werkinstructie')
if ((await page.locator('td:has-text("lezer")').count()) === 0) {
  await page.click('text=+ Nieuwe gebruiker')
  const vakken = page.locator('.nieuw-gebruiker input:not([type="checkbox"])')
  await vakken.nth(0).fill('lezer')
  await vakken.nth(1).fill('Lezer Test')
  await vakken.nth(3).fill('Lezer123!')
  await page.click('.nieuw-gebruiker >> text=Aanmaken')
}
await page.waitForSelector('td:has-text("lezer")')
stap('beheer: gebruiker "lezer" aanwezig (kijken+suggesties)')

// 7. Alleen-lezen modus: inloggen als lezer (terug naar de startpagina;
// de router blijft anders op /beheer staan, waar een lezer terecht niets ziet)
await page.click('text=Uitloggen')
await login('lezer', 'Lezer123!')
await page.waitForSelector('text=Uitloggen')
await page.goto(`${base}/`)
await page.waitForSelector('.card-grid')
const zijbalk = await page.locator('.sidebar').textContent()
for (const verboden of ['Procesbouwer', 'PDF-import', 'Import & export', 'Beheer']) {
  if (zijbalk?.includes(verboden)) throw new Error(`Alleen-lezen: "${verboden}" zichtbaar in sidebar!`)
}
await page.goto(`${base}/proces/${testProcesId}`)
await page.waitForSelector('.wf-balk, .proces-head')
if (await page.locator('text=✏️ Bewerken').count()) throw new Error('Alleen-lezen: bewerk-knop zichtbaar!')
stap('alleen-lezen modus: bouwer/import/beheer en bewerk-knop verborgen')

// 8. Terug als admin: JSON-export levert een download
await page.click('text=Uitloggen')
await login('Admin', adminWachtwoord)
await page.waitForSelector('text=Uitloggen')
await page.goto(`${base}/proces/${testProcesId}?workspace=1`)
const downloadBelofte = page.waitForEvent('download', { timeout: 10000 })
await page.click('text=⬇️ JSON')
const download = await downloadBelofte
stap(`JSON-export: download "${download.suggestedFilename()}"`)

// 9. ISO en gids renderen
await page.goto(`${base}/iso`)
await page.waitForSelector('.iso-normen')
await page.goto(`${base}/gids`)
await page.waitForSelector('text=Gebruikersgids')
stap('ISO & gids renderen')

// 10. Opruimen: testproces verwijderen via API (rol beheren, cookie uit context)
const del = await ctx.request.delete(`${base}/api/processes/${testProcesId}`)
if (![200, 204].includes(del.status())) throw new Error(`cleanup faalde: ${del.status()}`)
stap('cleanup: testproces verwijderd')

await browser.close()
if (fouten.length) {
  console.log('PAGE-ERRORS:', fouten.join(' | '))
  process.exit(1)
}
console.log('\nREGRESSIE VOLLEDIG GESLAAGD')
