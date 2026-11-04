// Gerichte browserregressie voor de lange SVG-visualisaties.
// Gebruik: node scripts/e2e-visualisatie-scroll.mjs [baseUrl]
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

const browser = await chromium.launch(executablePath ? { executablePath } : {})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const consoleErrors = []
const pageErrors = []
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text())
})
page.on('pageerror', (error) => pageErrors.push(error.message))

async function controleerModus(modus, context) {
  await page.getByRole('button', { name: modus, exact: true }).click()
  const canvas = page.locator('.pv-scroll-verticaal')
  await canvas.waitFor()

  const maten = await canvas.evaluate((element) => {
    const stijl = getComputedStyle(element)
    return {
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      overflowY: stijl.overflowY,
      overscrollBehaviorY: stijl.overscrollBehaviorY,
      tabIndex: element.tabIndex,
    }
  })
  assert(
    maten.scrollHeight > maten.clientHeight,
    `${context}/${modus}: testdiagram heeft geen verticale overflow (${JSON.stringify(maten)}).`,
  )
  assert(maten.overflowY === 'auto', `${context}/${modus}: overflow-y is niet auto.`)
  assert(
    maten.overscrollBehaviorY === 'auto',
    `${context}/${modus}: verticale scroll-keten naar de pagina wordt nog geblokkeerd.`,
  )
  assert(maten.tabIndex === 0, `${context}/${modus}: canvas is niet met het toetsenbord bereikbaar.`)

  await canvas.evaluate((element) => {
    element.scrollTop = 0
  })
  await canvas.scrollIntoViewIfNeeded()
  const raakpunt = await canvas.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const links = Math.max(rect.left + 8, 8)
    const rechts = Math.min(rect.right - 8, window.innerWidth - 8)
    const boven = Math.max(rect.top + 8, 8)
    const onder = Math.min(rect.bottom - 8, window.innerHeight - 8)
    if (links > rechts || boven > onder) return null
    return { x: (links + rechts) / 2, y: (boven + onder) / 2 }
  })
  assert(raakpunt, `${context}/${modus}: canvas heeft geen zichtbaar raakvlak.`)
  await page.mouse.move(raakpunt.x, raakpunt.y)
  await page.mouse.wheel(0, 420)
  await page.waitForTimeout(80)
  assert(
    (await canvas.evaluate((element) => element.scrollTop)) > 0,
    `${context}/${modus}: muiswiel verplaatst het witte diagram niet verticaal.`,
  )
}

await page.goto(`${base}/proces/service-crma-aanvraag-b2b`)
await page.waitForSelector('.proces-main .pv-root')
for (const modus of ['Brongetrouw', 'Flowchart', 'BPMN']) {
  await controleerModus(modus, 'procesdetail')
}

await page.goto(`${base}/bouwer/service-crma-aanvraag-b2b`)
await page.getByRole('button', { name: /Formulieren & controles/ }).click()
await page.waitForSelector('.be-preview-blok .pv-root')
for (const modus of ['Brongetrouw', 'Flowchart', 'BPMN']) {
  await controleerModus(modus, 'bouwer-preview')
}

assert(consoleErrors.length === 0, `Consolefouten: ${consoleErrors.join(' | ')}`)
assert(pageErrors.length === 0, `Paginacrash: ${pageErrors.join(' | ')}`)

await browser.close()
console.log(JSON.stringify({
  ok: true,
  checks: {
    procesdetail: ['brongetrouw', 'flowchart', 'bpmn'],
    bouwerPreview: ['brongetrouw', 'flowchart', 'bpmn'],
    mouseWheel: true,
    keyboardReachable: true,
    pageScrollChaining: true,
  },
}))
