// Gerichte browserregressie voor de graph-aware procesatlas.
// Gebruik: node scripts/e2e-atlas-layout.mjs [baseUrl]
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
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text())
})
page.on('pageerror', (error) => pageErrors.push(error.message))

await page.goto(`${base}/atlas`)
await page.waitForSelector('.react-flow__node-proces')

const layout = await page.locator('.react-flow__node-proces').evaluateAll((elements) =>
  elements.map((element) => {
    const rect = element.getBoundingClientRect()
    const transform = new DOMMatrix(element.style.transform)
    return {
      id: element.getAttribute('data-id'),
      x: transform.m41,
      y: transform.m42,
      screen: {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
      },
    }
  }),
)
assert(layout.length > 0, 'De Procesatlas bevat geen proceskaarten.')

for (let left = 0; left < layout.length; left += 1) {
  for (let right = left + 1; right < layout.length; right += 1) {
    const a = layout[left].screen
    const b = layout[right].screen
    const overlaps = a.left < b.right - 1 && a.right > b.left + 1 &&
      a.top < b.bottom - 1 && a.bottom > b.top + 1
    assert(!overlaps, `Proceskaarten ${layout[left].id} en ${layout[right].id} overlappen.`)
  }
}

const positions = new Map(layout.map((node) => [node.id, node]))
const edgeIds = await page.locator('.react-flow__edge').evaluateAll((elements) =>
  elements
    .map((element) => element.getAttribute('data-testid')?.replace(/^rf__edge-/, ''))
    .filter(Boolean),
)
const horizontalSpans = edgeIds.flatMap((edgeId) => {
  const [sourceId, targetId] = edgeId.split('->')
  const source = positions.get(sourceId)
  const target = positions.get(targetId)
  return source && target ? [target.x - source.x] : []
})
assert(horizontalSpans.length > 0, 'De Procesatlas bevat geen controleerbare koppelingen.')
assert(
  horizontalSpans.every((span) => span >= 0),
  'De graph-aware layout bevat nog een achterwaartse proceskoppeling.',
)
const adjacentConnections = horizontalSpans.filter((span) => span <= 300.01).length
assert(
  adjacentConnections / horizontalSpans.length >= 0.7,
  `Te weinig gekoppelde processen staan naast elkaar (${adjacentConnections}/${horizontalSpans.length}).`,
)

await page.locator('.sl-canvas').screenshot({ path: `${outDir}atlas-layout.png` })
assert(consoleErrors.length === 0, `Consolefouten: ${consoleErrors.join(' | ')}`)
assert(pageErrors.length === 0, `Paginacrash: ${pageErrors.join(' | ')}`)

await browser.close()
console.log(JSON.stringify({
  ok: true,
  checks: {
    nodes: layout.length,
    edges: horizontalSpans.length,
    noOverlap: true,
    noBackwardConnections: true,
    adjacentConnectionRatio: adjacentConnections / horizontalSpans.length,
  },
  screenshot: `${outDir}atlas-layout.png`,
}))
