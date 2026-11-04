// Maakt een review-screenshot van uitsluitend het gegenereerde bronblad.
// Gebruik: node scripts/capture-bronweergave.mjs [baseUrl]
import { existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const base = (process.argv[2] ?? 'http://127.0.0.1:4174').replace(/\/+$/, '')
const output = fileURLToPath(
  new URL('../.shots/fidelity-final-svg.png', import.meta.url),
)
const chromeCandidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean)
const executablePath = chromeCandidates.find((candidate) => existsSync(candidate))

mkdirSync(fileURLToPath(new URL('../.shots/', import.meta.url)), { recursive: true })

const browser = await chromium.launch(executablePath ? { executablePath } : {})
const page = await browser.newPage({
  viewport: { width: 1800, height: 1000 },
  deviceScaleFactor: 1,
})

try {
  await page.goto(`${base}/proces/service-aanvraagproces`, {
    waitUntil: 'domcontentloaded',
  })
  const root = page.locator('.proces-main .pv-root')
  await root.waitFor({ state: 'visible' })
  await root.getByRole('button', { name: 'Brongetrouw', exact: true }).click()
  const reset = root.getByRole('button', { name: 'Zoom herstellen naar 100%' })
  if (await reset.isEnabled()) await reset.click()
  await root.locator('.pv-fidelity').evaluate((element) => {
    let current = element
    while (current instanceof HTMLElement && current !== document.body) {
      current.style.maxHeight = 'none'
      current.style.height = 'auto'
      current.style.overflow = 'visible'
      current = current.parentElement
    }
  })
  const svg = root.locator('.pv-fidelity svg')
  await svg.waitFor({ state: 'visible' })
  await page.waitForTimeout(300)
  await svg.screenshot({ path: output })
  console.log(JSON.stringify({ ok: true, output }))
} finally {
  await browser.close()
}
