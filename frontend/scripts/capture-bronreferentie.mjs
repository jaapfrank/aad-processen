// Leg uitsluitend het witte paginavlak van pagina 1 van de lokale bron-PDF
// vast. De vaste viewport, 100%-zoom en clip maken de referentie reproduceerbaar
// zonder toolbar, thumbnails of donkere Chrome-viewerachtergrond.
//
// Gebruik Windows Node wanneer Windows Chrome de beschikbare browser is:
// node scripts/capture-bronreferentie.mjs
import { existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from 'playwright'

const pdf = fileURLToPath(new URL('../../5. Service v3.3.pdf', import.meta.url))
const output = fileURLToPath(new URL('../.shots/bronreferentie-pagina-1.png', import.meta.url))
const windowsChrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const executablePath = existsSync(windowsChrome) ? windowsChrome : undefined
mkdirSync(fileURLToPath(new URL('../.shots/', import.meta.url)), { recursive: true })

const viewport = { width: 2048, height: 1500 }
const paginaClip = { x: 778, y: 59, width: 793, height: 1283 }
const browser = await chromium.launch(executablePath ? { executablePath } : {})
const page = await browser.newPage({ viewport, deviceScaleFactor: 1 })

try {
  await page.goto(`${pathToFileURL(pdf).href}#page=1&zoom=100`, { waitUntil: 'load' })
  await page.waitForTimeout(3500)
  await page.screenshot({ path: output, clip: paginaClip })
  console.log(JSON.stringify({
    output,
    bronPagina: 1,
    zoom: '100%',
    viewport,
    paginaClip,
    bevatViewerchrome: false,
  }))
} finally {
  await browser.close()
}
