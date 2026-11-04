// Gerichte browserregressie voor zoom in editor en alle zes leesvisualisaties.
// Gebruik: node scripts/e2e-zoom.mjs [baseUrl]
import { existsSync } from 'node:fs'
import { chromium } from 'playwright'

const base = process.argv[2] ?? 'http://127.0.0.1:4174'
const chromeCandidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean)
const executablePath = chromeCandidates.find((candidate) => existsSync(candidate))

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function percentage(tekst) {
  return Number.parseInt(tekst.replace(/[^\d]/g, ''), 10)
}

const browser = await chromium.launch(executablePath ? { executablePath } : {})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const consoleErrors = []
const pageErrors = []
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text())
})
page.on('pageerror', (error) => pageErrors.push(error.message))

async function gemetenSchaal(root, modus) {
  return root.evaluate((element, actieveModus) => {
    if (actieveModus === 'Interactief') {
      const viewport = element.querySelector('.react-flow__viewport')
      if (!(viewport instanceof Element)) return Number.NaN
      return new DOMMatrix(getComputedStyle(viewport).transform).a
    }
    if (actieveModus === 'SIPOC') {
      const schaal = element.querySelector('.pv-sipoc-schaal')
      return schaal instanceof HTMLElement ? Number.parseFloat(getComputedStyle(schaal).zoom) : Number.NaN
    }
    const svg = element.querySelector('svg')
    if (!(svg instanceof SVGSVGElement) || svg.viewBox.baseVal.width <= 0) return Number.NaN
    return svg.getBoundingClientRect().width / svg.viewBox.baseVal.width
  }, modus)
}

async function herstelNaarHonderd(zoomgroep) {
  const reset = zoomgroep.getByRole('button', { name: /herstellen naar 100%/ })
  if (await reset.isEnabled()) await reset.click()
  await page.waitForTimeout(220)
  const niveau = percentage(await zoomgroep.getByRole('status', { name: /Zoomniveau/ }).innerText())
  assert(niveau === 100, `Reset eindigde op ${niveau}% in plaats van 100%.`)
}

async function controleerLeesvisualisaties(root, context) {
  const modi = ['Brongetrouw', 'Interactief', 'Flowchart', 'BPMN', 'SIPOC', 'Value-stream']
  for (const modus of modi) {
    await root.getByRole('button', { name: modus, exact: true }).click()
    await page.waitForTimeout(220)

    const zoomgroep = root.getByRole('group', { name: 'Zoom procesvisualisatie' })
    const niveau = zoomgroep.getByRole('status', { name: 'Zoomniveau' })
    assert(await zoomgroep.isVisible(), `${context}/${modus}: zichtbare zoombediening ontbreekt.`)
    await herstelNaarHonderd(zoomgroep)

    const schaalVoor = await gemetenSchaal(root, modus)
    await zoomgroep.getByRole('button', { name: 'Inzoomen', exact: true }).click()
    await page.waitForTimeout(240)
    const ingezoomd = percentage(await niveau.innerText())
    const schaalNa = await gemetenSchaal(root, modus)
    assert(ingezoomd === 110, `${context}/${modus}: zoomstatus werd ${ingezoomd}% in plaats van 110%.`)
    assert(
      Number.isFinite(schaalVoor) && Number.isFinite(schaalNa) && schaalNa > schaalVoor * 1.05,
      `${context}/${modus}: canvas schaalt niet werkelijk mee (${schaalVoor} → ${schaalNa}).`,
    )

    await zoomgroep.getByRole('button', { name: 'Uitzoomen', exact: true }).click()
    await page.waitForTimeout(220)
    assert(percentage(await niveau.innerText()) === 100, `${context}/${modus}: uitzoomen herstelde 100% niet.`)

    await zoomgroep.getByRole('button', { name: 'Visualisatie passend weergeven' }).click()
    await page.waitForTimeout(240)
    const passend = percentage(await niveau.innerText())
    assert(passend >= 40 && passend <= 200, `${context}/${modus}: passend leverde ongeldige zoom ${passend}%.`)

    if (modus !== 'Interactief') {
      await herstelNaarHonderd(zoomgroep)
      for (let stap = 0; stap < 10; stap += 1) {
        const knop = zoomgroep.getByRole('button', { name: 'Inzoomen', exact: true })
        if (!(await knop.isEnabled())) break
        await knop.click()
      }
      const scrollgebied = root.locator('[data-pv-zoomgebied]')
      const maten = await scrollgebied.evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        overflowX: getComputedStyle(element).overflowX,
        overscrollBehaviorY: getComputedStyle(element).overscrollBehaviorY,
      }))
      assert(maten.overflowX === 'auto', `${context}/${modus}: horizontale scroll staat niet op auto.`)
      assert(
        maten.overscrollBehaviorY === 'auto',
        `${context}/${modus}: zoom blokkeert de verticale scrollketen naar de pagina.`,
      )
      assert(
        maten.scrollWidth > maten.clientWidth,
        `${context}/${modus}: 200% content is afgeknipt in plaats van scrollbaar (${JSON.stringify(maten)}).`,
      )
      await scrollgebied.evaluate((element) => {
        element.scrollLeft = element.scrollWidth
      })
      assert(
        (await scrollgebied.evaluate((element) => element.scrollLeft)) > 0,
        `${context}/${modus}: ingezoomde content kan niet horizontaal worden verschoven.`,
      )

      await scrollgebied.evaluate((element) => {
        element.scrollLeft = Math.min(260, element.scrollWidth - element.clientWidth)
        element.scrollTop = Math.min(220, element.scrollHeight - element.clientHeight)
      })
      const panVoor = await scrollgebied.evaluate((element) => ({
        x: element.scrollLeft,
        y: element.scrollTop,
      }))
      await scrollgebied.scrollIntoViewIfNeeded()
      const panBox = await scrollgebied.boundingBox()
      assert(panBox, `${context}/${modus}: scrollgebied heeft geen zichtbaar sleepvlak.`)
      const viewport = page.viewportSize()
      const zichtbaar = {
        links: Math.max(8, panBox.x + 8),
        rechts: Math.min(viewport.width - 8, panBox.x + panBox.width - 8),
        boven: Math.max(8, panBox.y + 8),
        onder: Math.min(viewport.height - 8, panBox.y + panBox.height - 8),
      }
      assert(
        zichtbaar.rechts > zichtbaar.links && zichtbaar.onder > zichtbaar.boven,
        `${context}/${modus}: scrollgebied heeft geen zichtbaar panvlak (${JSON.stringify(panBox)}).`,
      )
      const panPunt = {
        x: zichtbaar.links + (zichtbaar.rechts - zichtbaar.links) * 0.72,
        y: zichtbaar.boven + (zichtbaar.onder - zichtbaar.boven) * 0.65,
      }
      const panHit = await page.evaluate(({ x, y }) => {
        const element = document.elementFromPoint(x, y)
        return {
          node: element?.nodeName ?? 'geen',
          className: element instanceof Element ? element.getAttribute('class') ?? '' : '',
        }
      }, panPunt)
      await page.mouse.move(panPunt.x, panPunt.y)
      await page.mouse.down()
      assert(
        await scrollgebied.evaluate((element) => element.classList.contains('pv-pannend')),
        `${context}/${modus}: pointer-down activeert de panstatus niet (hit=${JSON.stringify(panHit)}).`,
      )
      await page.mouse.move(
        panBox.x + panBox.width * 0.55,
        panBox.y + panBox.height * 0.48,
        { steps: 8 },
      )
      await page.mouse.up()
      const panNa = await scrollgebied.evaluate((element) => ({
        x: element.scrollLeft,
        y: element.scrollTop,
      }))
      assert(
        panNa.x > panVoor.x || panNa.y > panVoor.y,
        `${context}/${modus}: slepen op het blad verschuift de viewport niet (${JSON.stringify(panVoor)} → ${JSON.stringify(panNa)}).`,
      )
    }
  }
}

await page.goto(`${base}/proces/service-crma-aanvraag-b2b`)
const procesdetail = page.locator('.proces-main .pv-root')
await procesdetail.waitFor()
await controleerLeesvisualisaties(procesdetail, 'procesdetail')

await page.goto(`${base}/bouwer/service-crma-aanvraag-b2b`)
await page.getByRole('button', { name: /Formulieren & controles/ }).click()
const preview = page.locator('.be-preview-blok .pv-root')
await preview.waitFor()
await controleerLeesvisualisaties(preview, 'bouwer-preview')

await page.getByRole('button', { name: /Visuele editor/ }).click()
const editor = page.locator('.pe-shell')
await editor.waitFor()
const editorZoom = editor.getByRole('group', { name: 'Zoom visuele editor' })
const editorNiveau = editorZoom.getByRole('status', { name: 'Zoomniveau editor' })
assert(await editorZoom.isVisible(), 'Editor: zichtbare zoombediening ontbreekt.')
const editorReset = editorZoom.getByRole('button', { name: /Zoom editor herstellen/ })
if (await editorReset.isEnabled()) await editorReset.click()
await page.waitForTimeout(220)
assert(percentage(await editorNiveau.innerText()) === 100, 'Editor: reset herstelde 100% niet.')
const editorSchaalVoor = await editor.locator('.react-flow__viewport').evaluate(
  (element) => new DOMMatrix(getComputedStyle(element).transform).a,
)
await editorZoom.getByRole('button', { name: 'Inzoomen', exact: true }).click()
await page.waitForTimeout(240)
const editorSchaalNa = await editor.locator('.react-flow__viewport').evaluate(
  (element) => new DOMMatrix(getComputedStyle(element).transform).a,
)
assert(percentage(await editorNiveau.innerText()) === 110, 'Editor: inzoomen leverde geen 110% status.')
assert(editorSchaalNa > editorSchaalVoor * 1.05, 'Editor: ReactFlow-canvas schaalde niet werkelijk mee.')
await editorZoom.getByRole('button', { name: 'Procesdiagram passend weergeven' }).click()
await page.waitForTimeout(240)
assert(
  await editor.locator('.react-flow__controls-button').count() >= 3,
  'Editor: bestaande ReactFlow-zoomknoppen zijn niet behouden.',
)

assert(consoleErrors.length === 0, `Consolefouten: ${consoleErrors.join(' | ')}`)
assert(pageErrors.length === 0, `Paginacrash: ${pageErrors.join(' | ')}`)

await browser.close()
console.log(JSON.stringify({
  ok: true,
  checks: {
    procesdetail: 6,
    bouwerPreview: 6,
    editor: true,
    zoomStatus: true,
    resetAndFit: true,
    scrollOnZoom: true,
    reactFlowControlsPreserved: true,
  },
}))
