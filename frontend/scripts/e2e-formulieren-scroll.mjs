// Gerichte regressietest voor de scrollketen van Formulieren & controles.
// Gebruik: node scripts/e2e-formulieren-scroll.mjs [baseUrl]
import { existsSync } from 'node:fs'
import { chromium } from 'playwright'

const base = process.argv[2] ?? 'http://127.0.0.1:4174'
const windowsChrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const executablePath = existsSync(windowsChrome) ? windowsChrome : undefined

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const browser = await chromium.launch({ executablePath })

try {
  for (const viewport of [
    { name: 'desktop', width: 1440, height: 800 },
    { name: 'smal', width: 900, height: 700 },
  ]) {
    const page = await browser.newPage({ viewport })
    page.on('dialog', (dialog) => dialog.accept())

    await page.goto(`${base}/bouwer/service-aanvraagproces`)
    await page.getByRole('button', { name: /Formulieren & controles/ }).click()
    const grid = page.locator('.bouwer-grid')
    await grid.waitFor()

    const voor = await grid.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      overflowY: getComputedStyle(element).overflowY,
    }))
    assert(voor.overflowY === 'auto', `${viewport.name}: verticale overflow is niet automatisch.`)
    assert(
      voor.scrollHeight > voor.clientHeight,
      `${viewport.name}: het lange formulierenpaneel vormt geen scrollgebied.`,
    )

    // Test op de formulierkolom; de visualisatiekolom heeft bewust ook een
    // eigen scrollbar voor grote diagrammen.
    await page.locator('.bouwer-editor').hover()
    await page.mouse.wheel(0, 480)
    await page.waitForTimeout(100)
    const scrollTop = await grid.evaluate((element) => element.scrollTop)
    assert(scrollTop > 0, `${viewport.name}: het muiswiel verplaatst het formulierenpaneel niet.`)

    await grid.evaluate((element) => {
      element.scrollTop = element.scrollHeight
    })
    const main = page.locator('.main')
    const mainVoor = await main.evaluate((element) => element.scrollTop)
    await grid.hover({ position: { x: 24, y: Math.max(24, voor.clientHeight - 24) } })
    await page.mouse.wheel(0, 520)
    await page.waitForTimeout(100)
    assert(
      (await main.evaluate((element) => element.scrollTop)) > mainVoor,
      `${viewport.name}: scrollen aan het einde gaat niet door naar de pagina.`,
    )

    await page.emulateMedia({ media: 'print' })
    const print = await grid.evaluate((element) => {
      const style = getComputedStyle(element)
      return { maxHeight: style.maxHeight, overflowY: style.overflowY }
    })
    assert(print.maxHeight === 'none', `${viewport.name}: print houdt ten onrechte een maximale hoogte.`)
    assert(print.overflowY === 'visible', `${viewport.name}: print knipt het formulierenpaneel af.`)

    await page.close()
  }
} finally {
  await browser.close()
}

console.log(JSON.stringify({
  ok: true,
  checks: {
    desktopScroll: true,
    narrowScroll: true,
    pageScrollChaining: true,
    printExpansion: true,
  },
}))
