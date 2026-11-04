// Browserregressie voor stapvolgorde in Formulieren & controles.
// Gebruik: node scripts/e2e-formulieren-dnd.mjs [baseUrl]
import { existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const base = process.argv[2] ?? 'http://127.0.0.1:4174'
const windowsChrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const executablePath = existsSync(windowsChrome) ? windowsChrome : undefined
const outDir = fileURLToPath(new URL('../.shots/', import.meta.url))
mkdirSync(outDir, { recursive: true })

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const browser = await chromium.launch({ executablePath })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.setDefaultTimeout(10_000)
const dialogs = []
const consoleErrors = []
const pageErrors = []
page.on('dialog', async (dialog) => {
  dialogs.push(dialog.message())
  await dialog.dismiss()
})
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text())
})
page.on('pageerror', (error) => pageErrors.push(error.message))

const card = (id) => page.locator(`.be-stap[data-stap-id="${id}"]`)
const section = (id) => page.locator(`.be-sectie[data-sectie-id="${id}"]`)
const sectionIds = (id) => section(id).locator('.be-stap').evaluateAll((elements) =>
  elements.map((element) => element.getAttribute('data-stap-id')),
)

async function dragToCard(sourceId, targetId, position) {
  const sourceGrip = card(sourceId).locator('.sleep-grip')
  const target = card(targetId)
  await sourceGrip.scrollIntoViewIfNeeded()
  await target.scrollIntoViewIfNeeded()
  const sourceBox = await sourceGrip.boundingBox()
  const targetBox = await target.boundingBox()
  assert(sourceBox && targetBox, `Sleepdoel ${sourceId} → ${targetId} is niet zichtbaar.`)

  await page.mouse.move(sourceBox.x + sourceBox.width * 0.35, sourceBox.y + sourceBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(
    sourceBox.x + sourceBox.width * 0.35 + 12,
    sourceBox.y + sourceBox.height / 2 + 6,
    { steps: 4 },
  )
  let actualPosition
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const currentTargetBox = await target.boundingBox()
    assert(currentTargetBox, `Sleepdoel ${targetId} verdween tijdens het slepen.`)
    const targetY =
      currentTargetBox.y + currentTargetBox.height * (position === 'voor' ? 0.2 : 0.8)
    await page.mouse.move(currentTargetBox.x + currentTargetBox.width / 2, targetY, {
      steps: attempt === 0 ? 18 : 4,
    })
    await page.waitForTimeout(60)
    actualPosition = await target.getAttribute('data-drop-positie')
    if (actualPosition === position) break
  }
  assert(
    actualPosition === position,
    `De kaart toont niet de invoegpositie "${position}" (actueel=${actualPosition ?? 'geen'}).`,
  )
  await page.mouse.up()
  await page.waitForTimeout(120)
}

await page.goto(`${base}/bouwer/service-onderzoek-aanmelden`)
await page.getByRole('button', { name: /Formulieren & controles/ }).click()
const grid = page.getByRole('region', { name: 'Formulieren en controles' })
await grid.waitFor()

assert(
  JSON.stringify(await sectionIds('sk')) === JSON.stringify(['k1', 'k2', 'k3']),
  'De oorspronkelijke volgorde van de SK-sectie is onverwacht.',
)

// Een geannuleerde lange drag moet de lijst niet wijzigen, maar wel het
// geneste formuliergebied langs de onderrand automatisch kunnen scrollen.
await card('k1').locator('.sleep-grip').scrollIntoViewIfNeeded()
const gridBox = await grid.boundingBox()
const k1HeaderBox = await card('k1').locator('.sleep-grip').boundingBox()
assert(gridBox && k1HeaderBox, 'Formuliergebied of eerste stap is niet zichtbaar.')
const scrollBeforeDrag = await grid.evaluate((element) => element.scrollTop)
await page.mouse.move(k1HeaderBox.x + 90, k1HeaderBox.y + k1HeaderBox.height / 2)
await page.mouse.down()
await page.mouse.move(k1HeaderBox.x + 104, k1HeaderBox.y + k1HeaderBox.height / 2 + 6, { steps: 4 })
for (let index = 0; index < 12; index += 1) {
  await page.mouse.move(gridBox.x + gridBox.width * 0.35, gridBox.y + gridBox.height - 8 - (index % 2), {
    steps: 2,
  })
  await page.waitForTimeout(25)
}
const scrollAfterDrag = await grid.evaluate((element) => element.scrollTop)
assert(scrollAfterDrag > scrollBeforeDrag, 'Slepen langs de onderrand scrollt het formulier niet mee.')
await page.mouse.move(gridBox.x + gridBox.width - 24, gridBox.y + 40, { steps: 6 })
await page.mouse.up()
await page.waitForTimeout(100)
assert(
  JSON.stringify(await sectionIds('sk')) === JSON.stringify(['k1', 'k2', 'k3']),
  'Een geannuleerde drag heeft de stapvolgorde gewijzigd.',
)

await dragToCard('k2', 'k3', 'na')
assert(
  JSON.stringify(await sectionIds('sk')) === JSON.stringify(['k1', 'k3', 'k2']),
  'Drop op de onderste kaarthelft plaatst de stap niet erna.',
)
assert(
  (await page.locator('.bouwer-melding').innerText()).includes(' na '),
  'De verplaatsmelding beschrijft de nieuwe positie niet.',
)

await dragToCard('k1', 'b4', 'voor')
assert(
  JSON.stringify(await sectionIds('sk')) === JSON.stringify(['k3', 'k2']),
  'De stap is niet uit de bronsectie verdwenen.',
)
assert(
  (await sectionIds('bulk'))[0] === 'k1',
  'Cross-sectie-drop plaatst de stap niet op de gekozen positie.',
)

// Lege sectie + toetsenbord/formulieralternatief.
await page.getByRole('button', { name: '+ Sectie toevoegen' }).click()
const newSectionName = page.locator('.be-rij input').filter({ hasValue: 'Nieuwe sectie' }).last()
await newSectionName.fill('Nazorg')
await card('k3').locator('.be-stap-kop').click()
await page.getByLabel('Sectie van stap Maakt IRO compleet en koppelt M-nummer').selectOption({
  label: 'Nazorg',
})
const newSection = page.locator('.be-sectie').filter({ has: page.getByRole('heading', { name: 'Nazorg' }) })
assert(
  await newSection.locator('.be-stap[data-stap-id="k3"]').count() === 1,
  'De sectiekeuze kan een stap niet naar een lege sectie verplaatsen.',
)

await grid.screenshot({ path: `${outDir}formulieren-dnd.png` })
await page.getByRole('button', { name: '💾 Opslaan als concept' }).click()
await page.waitForTimeout(150)
const saved = await page.evaluate(() => {
  const persisted = JSON.parse(localStorage.getItem('spg-concepten') ?? '{}')
  return persisted.state?.concepten?.['service-onderzoek-aanmelden']
})
assert(saved, 'De aangepaste formulierstappen zijn niet opgeslagen.')
const savedK1 = saved.stappen.find((step) => step.id === 'k1')
assert(
  savedK1?.sectieId === 'bulk' &&
    savedK1.nummer === '1' &&
    savedK1.laneId === 'onderzoek' &&
    savedK1.naarStap === 'k2' &&
    savedK1.activiteit === 'Haalt artikel uit schap SK',
  'Verplaatsen heeft naast volgorde/sectie ook stapsemantiek gewijzigd.',
)
assert(dialogs.length === 0, `Stapverplaatsing opende onverwacht een dialoog: ${dialogs.join(' | ')}`)
assert(consoleErrors.length === 0, `Consolefouten: ${consoleErrors.join(' | ')}`)
assert(pageErrors.length === 0, `Paginacrash: ${pageErrors.join(' | ')}`)

await browser.close()
console.log(JSON.stringify({
  ok: true,
  checks: {
    dragEdgeAutoScroll: true,
    cancelPreservesOrder: true,
    beforeAfterPlacement: true,
    crossSectionPlacement: true,
    emptySectionAlternative: true,
    semanticDataPreserved: true,
    noDialogsOrRuntimeErrors: true,
  },
  screenshot: `${outDir}formulieren-dnd.png`,
}))
