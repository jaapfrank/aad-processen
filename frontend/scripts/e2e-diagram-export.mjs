// Chrome-regressietest voor zichtbare, lokale draw.io- en VSDX-downloads.
// Gebruik: node scripts/e2e-diagram-export.mjs [baseUrl]
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const base = process.argv[2] ?? 'http://127.0.0.1:4174'
const windowsChrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const executablePath = existsSync(windowsChrome) ? windowsChrome : undefined
const outDir = fileURLToPath(new URL('../.shots/diagram-export/', import.meta.url))
mkdirSync(outDir, { recursive: true })

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function storedZipEntries(buffer) {
  const entries = new Map()
  let offset = 0
  while (offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const compression = buffer.readUInt16LE(offset + 8)
    const compressedSize = buffer.readUInt32LE(offset + 18)
    const nameLength = buffer.readUInt16LE(offset + 26)
    const extraLength = buffer.readUInt16LE(offset + 28)
    const nameStart = offset + 30
    const contentStart = nameStart + nameLength + extraLength
    const name = buffer.subarray(nameStart, nameStart + nameLength).toString('utf8')
    assert(compression === 0, `Onverwachte ZIP-compressie voor ${name}; selftest verwacht Store.`)
    entries.set(name, buffer.subarray(contentStart, contentStart + compressedSize))
    offset = contentStart + compressedSize
  }
  return entries
}

function decodeXmlAttribute(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

const browser = await chromium.launch({ executablePath })
const page = await browser.newPage({ viewport: { width: 1500, height: 960 }, acceptDownloads: true })
const pageErrors = []
page.on('pageerror', (error) => pageErrors.push(error.message))

try {
  await page.goto(`${base}/bouwer/service-aanvraagproces`)
  const compact = page.locator('.bouwer-uitwisseling-compact')
  await compact.waitFor()
  const uitwisselingLink = compact.getByRole('link', { name: 'Exporteren', exact: true })
  const href = await uitwisselingLink.getAttribute('href')
  assert(
    href ===
      '/uitwisseling?processId=service-aanvraagproces&actie=exporteren&formaat=drawio-xml',
    `De builderdeeplink behoudt het processId niet: ${href}`,
  )
  assert(
    (await page.locator('details.dx-paneel').count()) === 0,
    'Het grote diagramuitwisselingspaneel staat nog in de builder.',
  )
  await uitwisselingLink.click()
  await page.waitForURL(/\/uitwisseling\?processId=service-aanvraagproces&actie=exporteren/)
  await page.getByRole('heading', { name: 'Import & export', exact: true }).waitFor()

  const panel = page.locator('.dx-paneel.dx-pagina')
  await panel.waitFor()
  const drawIoButton = page.getByRole('button', { name: /Exporteer \.drawio/ })
  assert(await drawIoButton.isVisible(), 'Draw.io-exportknop is niet zichtbaar.')
  assert(await drawIoButton.isEnabled(), 'Draw.io-exportknop is niet bruikbaar.')
  assert(
    new URL(page.url()).searchParams.get('processId') === 'service-aanvraagproces',
    'Het processId ging verloren bij het kiezen van export.',
  )
  await page.locator('.ux-pagina').screenshot({ path: `${outDir}/diagramuitwisseling.png` })

  const drawIoDownloadPromise = page.waitForEvent('download')
  await drawIoButton.click()
  const drawIoDownload = await drawIoDownloadPromise
  const drawIoPath = `${outDir}/proces.drawio`
  await drawIoDownload.saveAs(drawIoPath)
  const drawIo = readFileSync(drawIoPath, 'utf8')
  assert(drawIoDownload.suggestedFilename().endsWith('.drawio'), 'Draw.io-download heeft geen .drawio-extensie.')
  assert(drawIo.includes('<mxfile'), 'Draw.io-download bevat geen mxfile-root.')
  assert(drawIo.includes('spgSchema="1"'), 'Draw.io-download mist SPG-metadata.')
  assert(drawIo.includes('edge="1"'), 'Draw.io-download mist bewerkbare verbindingen.')

  await page.getByRole('button', { name: /Microsoft Visio/ }).click()
  await page.waitForURL(/formaat=visio-vsdx/)
  const visioButton = page.getByRole('button', { name: /Exporteer \.vsdx/ })
  await visioButton.waitFor()
  assert(await visioButton.isVisible(), 'Visio-exportknop is niet zichtbaar.')
  assert(await visioButton.isEnabled(), 'Visio-exportknop is niet bruikbaar.')
  const visioDownloadPromise = page.waitForEvent('download')
  await visioButton.click()
  const visioDownload = await visioDownloadPromise
  const visioPath = `${outDir}/proces.vsdx`
  await visioDownload.saveAs(visioPath)
  const vsdx = readFileSync(visioPath)
  assert(visioDownload.suggestedFilename().endsWith('.vsdx'), 'Visio-download heeft geen .vsdx-extensie.')
  assert(vsdx.readUInt32LE(0) === 0x04034b50, 'VSDX is geen OPC/ZIP-package.')

  const entries = storedZipEntries(vsdx)
  const required = [
    '[Content_Types].xml',
    '_rels/.rels',
    'visio/document.xml',
    'visio/_rels/document.xml.rels',
    'visio/pages/pages.xml',
    'visio/pages/_rels/pages.xml.rels',
    'visio/pages/page1.xml',
  ]
  for (const name of required) assert(entries.has(name), `VSDX mist verplichte part ${name}.`)
  const xmlParseResults = await page.evaluate((parts) => {
    const parser = new DOMParser()
    return parts.map(({ name, content }) => ({
      name,
      valid:
        parser
          .parseFromString(content, 'application/xml')
          .getElementsByTagName('parsererror').length === 0,
    }))
  }, required.map((name) => ({ name, content: entries.get(name).toString('utf8') })))
  for (const result of xmlParseResults) {
    assert(result.valid, `VSDX-part ${result.name} is geen geldige XML volgens Chrome DOMParser.`)
  }
  assert(
    [...entries.keys()].every((name) => !/vba|macro|\.bin$/i.test(name)),
    'VSDX bevat een macro- of binaire part.',
  )
  const relationships = [...entries.entries()]
    .filter(([name]) => name.endsWith('.rels'))
    .map(([, bytes]) => bytes.toString('utf8'))
    .join('\n')
  assert(!/TargetMode="External"/i.test(relationships), 'VSDX bevat een externe relatie.')

  const pageXml = entries.get('visio/pages/page1.xml').toString('utf8')
  assert(pageXml.includes('<Shapes>'), 'VSDX-pagina mist shapes.')
  assert(pageXml.includes('<Connects>'), 'VSDX-pagina mist gelijmde connectors.')
  assert(pageXml.includes('OneD="1"'), 'VSDX-pagina mist bewerkbare 1D-connectors.')
  assert(pageXml.includes('Prop.spgKind'), 'VSDX-pagina mist SPG Shape Data.')
  const metadataMatch = pageXml.match(
    /<Row N="Prop\.spgData"><Cell N="Value" V="([^"]+)" U="STR"\/><\/Row>/,
  )
  assert(metadataMatch, 'VSDX mist semantische procesmetadata.')
  const formula = decodeXmlAttribute(metadataMatch[1])
  const processJson = formula.slice(1, -1).replace(/""/g, '"')
  const returned = JSON.parse(processJson)
  assert(returned.id === 'service-aanvraagproces', 'VSDX-metadata heeft het verkeerde proces-id.')
  assert(returned.stappen.length > 0, 'VSDX-metadata heeft geen processtappen.')

  // Round-trip terug via de centrale importreview. De pagina behoudt het doel-id
  // en de builder krijgt alleen een niet-opgeslagen werkconcept.
  await page.goto(
    `${base}/uitwisseling?processId=service-aanvraagproces&actie=importeren&formaat=drawio-xml`,
  )
  await page.setInputFiles('input[accept*=".drawio"]', drawIoPath)
  const review = page.locator('.dx-rapport')
  await review.waitFor()
  await review.getByRole('status').waitFor()
  await page.waitForFunction(
    () => document.activeElement?.classList.contains('dx-rapport'),
  )
  assert(
    await review.evaluate((element) => document.activeElement === element),
    'Succesvolle importreview krijgt geen focus.',
  )
  await review
    .getByRole('button', { name: 'Gebruik als gecontroleerd werkconcept', exact: true })
    .click()
  await page.waitForURL('**/bouwer/service-aanvraagproces')
  await page.getByText(/Diagramimport geladen:/).waitFor()
  assert(
    (await page.getByText('Opgeslagen als concept.', { exact: true }).count()) === 0,
    'Diagramimport is zonder expliciete opslagactie opgeslagen.',
  )
  assert(pageErrors.length === 0, `Browserfouten: ${pageErrors.join(' | ')}`)
} finally {
  await browser.close()
}

console.log(JSON.stringify({
  ok: true,
  checks: {
    drawIoButtonVisibleAndDownloaded: true,
    drawIoNativeXml: true,
    visioButtonVisibleAndDownloaded: true,
    visioOpcPartsComplete: true,
    visioXmlPartsParseInChrome: true,
    visioMacroFreeAndInternal: true,
    visioShapesConnectorsAndMetadata: true,
    drawIoImportReviewAndReturn: true,
  },
}, null, 2))
