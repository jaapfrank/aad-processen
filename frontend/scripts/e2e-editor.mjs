// Regressietest voor de visuele proceseditor.
// Gebruik: node scripts/e2e-editor.mjs [baseUrl]
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
const page = await browser.newPage({ viewport: { width: 1680, height: 1050 } })
const consoleErrors = []
const pageErrors = []
const failedResponses = []
const nativeDialogs = []
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text())
})
page.on('pageerror', (error) => pageErrors.push(error.message))
page.on('dialog', async (dialog) => {
  nativeDialogs.push(dialog.message())
  await dialog.dismiss()
})
page.on('response', (response) => {
  if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`)
})

await page.goto(base)
await page.evaluate(() => localStorage.removeItem('spg-concepten'))
await page.goto(`${base}/bouwer`)
await page.waitForSelector('.pe-shell')

assert(await page.getByRole('button', { name: '✦ Visuele editor' }).getAttribute('class') === 'active',
  'Visuele editor is niet de standaardmodus.')
await page.getByLabel('Procesnaam').fill('Editor E2E')

const addAndRename = async (type, name) => {
  const viewportVoor = await page.locator('.react-flow__viewport').evaluate((element) =>
    getComputedStyle(element).transform,
  )
  await page.locator(`button[title="${type} toevoegen"]`).click()
  await page.getByRole('textbox', { name: 'Activiteit', exact: true }).fill(name)
  const viewportNa = await page.locator('.react-flow__viewport').evaluate((element) =>
    getComputedStyle(element).transform,
  )
  assert(
    viewportNa === viewportVoor,
    `${type}: toevoegen wijzigde de viewport via een impliciete fit/pan (${viewportVoor} → ${viewportNa}).`,
  )
}

await addAndRename('Start', 'Proces starten')
await addAndRename('Actie', 'Aanvraag controleren')
await addAndRename('Beslissing', 'Aanvraag volledig?')
await addAndRename('Einde', 'Proces afronden')
await page.waitForTimeout(250)

const stepNodes = page.locator('.react-flow__node-editorStep')
assert(await stepNodes.count() === 4, 'Niet alle vier de stappen zijn op het canvas gemaakt.')
const boxes = await stepNodes.evaluateAll((elements) =>
  elements.map((element) => {
    const rect = element.getBoundingClientRect()
    return { x: rect.x, y: rect.y, width: rect.width }
  }),
)
assert(new Set(boxes.map((box) => Math.round(box.y))).size === 4,
  'Nieuwe stappen zijn over elkaar heen geplaatst.')
const canvasBox = await page.locator('.pe-canvas').boundingBox()
assert(canvasBox, 'Editorcanvas heeft geen zichtbare afmetingen.')
assert(
  boxes.every((box) =>
    box.x + box.width / 2 >= canvasBox.x &&
    box.x + box.width / 2 <= canvasBox.x + canvasBox.width
  ),
  'Een nieuw element staat niet in een zichtbare, geldige lane van de actuele viewport.',
)

const nodeByTitle = (title) =>
  page.locator('.react-flow__node-editorStep').filter({
    has: page.locator('.pe-node-title', { hasText: title }),
  }).first()

const connectNodes = async (sourceTitle, targetTitle) => {
  const source = nodeByTitle(sourceTitle).locator('.react-flow__handle.source')
  const target = nodeByTitle(targetTitle).locator('.react-flow__handle.target')
  await target.scrollIntoViewIfNeeded()
  const sourceBox = await source.boundingBox()
  const targetBox = await target.boundingBox()
  assert(sourceBox && targetBox, `Aansluitpunten voor ${sourceTitle} → ${targetTitle} ontbreken.`)
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 12 })
  await page.mouse.up()
}

await connectNodes('Proces starten', 'Aanvraag controleren')
await page.waitForTimeout(250)
assert(await page.locator('.react-flow__edge').count() === 1,
  'Canvasverbinding Start → Actie is niet gemaakt.')
await connectNodes('Aanvraag controleren', 'Aanvraag volledig?')
await page.waitForTimeout(250)
assert(await page.locator('.react-flow__edge').count() === 2,
  'Canvasverbinding Actie → Beslissing is niet gemaakt.')
await connectNodes('Aanvraag volledig?', 'Proces afronden')
await page.waitForTimeout(350)
assert(
  await page.locator('.pe-dialog').isVisible(),
  `Beslisroute-dialoog bleef uit (edges=${await page.locator('.react-flow__edge').count()}, feedback="${await page.locator('.pe-feedback').innerText()}").`,
)
await page.getByRole('button', { name: 'Route maken' }).click()
await page.waitForSelector('.pe-error')
await page.getByLabel('Route-label *').fill('Ja')
await page.getByLabel('Voorwaarde (optioneel)').fill('Alle gegevens zijn aanwezig')
await page.getByRole('button', { name: 'Route maken' }).click()
await page.waitForSelector('.pe-dialog', { state: 'detached' })

await nodeByTitle('Aanvraag volledig?').click()
await page.getByRole('button', { name: '+ Route toevoegen' }).click()
const actionTargetId = await page
  .getByLabel('Doelstap *')
  .locator('option')
  .filter({ hasText: 'Aanvraag controleren' })
  .getAttribute('value')
assert(actionTargetId, 'Doelstapoptie voor de tweede route ontbreekt.')
await page.getByLabel('Doelstap *').selectOption(actionTargetId)
await page.getByLabel('Route-label *').fill('Nee')
await page.getByRole('button', { name: 'Route maken' }).click()
await page.waitForSelector('.pe-dialog', { state: 'detached' })
await page.waitForFunction(
  () => document.querySelectorAll('.react-flow__edge').length === 4,
  undefined,
  { timeout: 2_000 },
).catch(() => undefined)
const semanticEdgeCount = await page.locator('.react-flow__edge').count()
assert(semanticEdgeCount === 4,
  `De twee directe verbindingen en twee beslisroutes zijn niet getekend (edges=${semanticEdgeCount}, feedback="${await page.locator('.pe-feedback').innerText()}").`)

const actionNode = nodeByTitle('Aanvraag controleren')
await actionNode.click()
const beforeMove = await actionNode.boundingBox()
assert(beforeMove, 'Actiestap heeft geen afmetingen.')
const serviceLane = page
  .locator('.react-flow__node-editorLane')
  .filter({ hasText: '(Klanten)service medewerker' })
  .first()
const serviceLaneBox = await serviceLane.boundingBox()
assert(serviceLaneBox, 'De servicelane is niet zichtbaar.')
await page.mouse.move(beforeMove.x + beforeMove.width / 2, beforeMove.y + beforeMove.height / 2)
await page.mouse.down()
await page.mouse.move(
  serviceLaneBox.x + serviceLaneBox.width / 2,
  beforeMove.y + beforeMove.height / 2,
  { steps: 10 },
)
await page.mouse.up()
await page.waitForTimeout(150)
const afterMove = await actionNode.boundingBox()
assert(afterMove && Math.abs(afterMove.x - beforeMove.x) > 80, 'Slepen heeft de stap niet verplaatst.')

await page.getByRole('button', { name: /Undo/ }).click()
await page.waitForTimeout(100)
const afterUndo = await actionNode.boundingBox()
assert(afterUndo && Math.abs(afterUndo.x - beforeMove.x) < 4, 'Undo heeft de verplaatsing niet hersteld.')
await page.getByRole('button', { name: /Redo/ }).click()
await page.waitForTimeout(100)
const afterRedo = await actionNode.boundingBox()
assert(afterRedo && Math.abs(afterRedo.x - afterMove.x) < 4, 'Redo heeft de verplaatsing niet teruggebracht.')

await actionNode.click()
const resizeHandle = page.locator('.react-flow__resize-control.handle.bottom.right')
await resizeHandle.waitFor()
const resizeBox = await resizeHandle.boundingBox()
assert(resizeBox, 'Resizegreep ontbreekt bij de geselecteerde stap.')
const resizeHit = await page.evaluate(({ x, y }) => {
  const element = document.elementFromPoint(x, y)
  return {
    className: element instanceof HTMLElement ? element.className : String(element?.nodeName),
    pointerEvents: element ? getComputedStyle(element).pointerEvents : 'missing',
  }
}, {
  x: resizeBox.x + resizeBox.width / 2,
  y: resizeBox.y + resizeBox.height / 2,
})
await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2)
await page.mouse.down()
await page.mouse.move(resizeBox.x + resizeBox.width / 2 + 48, resizeBox.y + resizeBox.height / 2 + 24, { steps: 10 })
await page.mouse.up()
await page.waitForTimeout(150)
const afterResize = await actionNode.boundingBox()
assert(
  afterResize &&
    afterResize.width > afterRedo.width + 5 &&
    afterResize.height > afterRedo.height + 8,
  `De stap kon niet vrij worden vergroot (voor=${afterRedo.width}, na=${afterResize?.width}, feedback="${await page.locator('.pe-feedback').innerText()}", hit=${JSON.stringify(resizeHit)}).`,
)

await page.locator('.pe-save').click()
await page.waitForURL(/\/bouwer\/editor-e2e$/)
await page.waitForSelector('.pe-status-clean')

const saved = await page.evaluate(() => {
  const persisted = JSON.parse(localStorage.getItem('spg-concepten') ?? '{}')
  return persisted.state?.concepten?.['editor-e2e']
})
assert(saved, 'Het procesconcept is niet opgeslagen.')
assert(saved.stappen.length === 4, 'Opgeslagen concept heeft een onjuist aantal stappen.')
assert(saved.stappen.find((step) => step.activiteit === 'Aanvraag volledig?')?.routes?.length === 2,
  'De twee beslisroutes zijn niet semantisch opgeslagen.')
const action = saved.stappen.find((step) => step.activiteit === 'Aanvraag controleren')
assert(action?.laneId === 'service', 'Automatische lane-wissel heeft de verantwoordelijke rol niet aangepast.')
const placement = saved.diagramLayout?.nodes?.[`step:${action?.id}`]
assert(placement && placement.width > 210 && Number.isFinite(placement.x) && Number.isFinite(placement.y),
  'Handmatige positie en afmetingen zijn niet opgeslagen.')
const laneIndex = saved.lanes.findIndex((lane) => lane.id === action?.laneId)
const expectedX = laneIndex * 240 + (240 - placement.width) / 2
assert(Math.abs(placement.x - expectedX) < 0.01,
  'De verplaatste stap is niet exact horizontaal in de verantwoordelijke baan uitgelijnd.')
assert(nativeDialogs.length === 0, `Slepen opende onverwacht een dialoog: ${nativeDialogs.join(' | ')}`)

await page.reload()
await page.waitForSelector('.pe-shell')
assert(await page.locator('.react-flow__node-editorStep').count() === 4,
  'Stappen zijn na herladen niet teruggekomen.')
assert(await page.locator('.react-flow__edge').count() === 4,
  'Verbindingen zijn na herladen niet teruggekomen.')

await page.locator('.pe-shell').screenshot({ path: `${outDir}editor-e2e.png` })

assert(consoleErrors.length === 0, `Consolefouten: ${consoleErrors.join(' | ')}`)
assert(pageErrors.length === 0, `Paginacrash: ${pageErrors.join(' | ')}`)
assert(failedResponses.length === 0, `HTTP-fouten: ${failedResponses.join(' | ')}`)

await browser.close()
console.log(JSON.stringify({
  ok: true,
  checks: {
    defaultVisualMode: true,
    createWithoutOverlap: true,
    semanticConnections: true,
    requiredRouteQuestion: true,
    keyboardRouteAlternative: true,
    dragUndoRedo: true,
    automaticLaneChange: true,
    resize: true,
    saveAndReload: true,
    noRuntimeErrors: true,
  },
  screenshot: `${outDir}editor-e2e.png`,
}))
