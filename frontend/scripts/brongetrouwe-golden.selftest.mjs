// Deterministische meettest voor pagina 1 van de aangeleverde bron-PDF.
//
// De PNG is een kale rasterisatie van de PDF-pagina: geen browsertoolbar,
// thumbnailkolom of viewerachtergrond. De test leest PNG en PDF uitsluitend
// met Node-standaardmodules en controleert de bladmaat en hoofdgeometrie.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'

const pdfUrl = new URL('../../5. Service v3.3.pdf', import.meta.url)
const goldenUrl = new URL(
  '../test-assets/goldens/service-aanvraagproces-pagina1.png',
  import.meta.url,
)

const VERWACHTE_PDF_SHA256 =
  'e5ccd6e74d13ab3dd4fa421ccb6167329040e535e95aa1d429b064bc59f99690'
const VERWACHTE_GOLDEN_SHA256 =
  'f8625ba6322393c8716bc23bfe532c3cd44d125e682693713359d525c450371d'
const VERWACHTE_MEDIA_BOX = { breedte: 595.2, hoogte: 963.72 }
const VERWACHTE_RASTER = { breedte: 793, hoogte: 1283 }
const VERWACHTE_LANE_ASSEN = [111, 225, 338, 565, 678]
const VERWACHTE_HOOFDLIJNEN = [
  182, 207, 252, 347, 442, 513, 680, 771, 782, 827, 865, 927, 973, 1070, 1133,
]

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function leesEersteMediaBox(pdf) {
  const tekst = pdf.toString('latin1')
  const match = /\/Type\s*\/Page\b[\s\S]{0,2000}?\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*]/.exec(
    tekst,
  )
  assert.ok(match, 'De MediaBox van PDF-pagina 1 kon niet worden gelezen.')
  return { breedte: Number(match[1]), hoogte: Number(match[2]) }
}

function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  return pb <= pc ? b : c
}

function decodeerRgbPng(png) {
  const signatuur = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  assert.ok(png.subarray(0, 8).equals(signatuur), 'Golden is geen geldige PNG.')

  let offset = 8
  let breedte = 0
  let hoogte = 0
  const idat = []

  while (offset < png.length) {
    const lengte = png.readUInt32BE(offset)
    const type = png.toString('ascii', offset + 4, offset + 8)
    const data = png.subarray(offset + 8, offset + 8 + lengte)
    offset += 12 + lengte

    if (type === 'IHDR') {
      breedte = data.readUInt32BE(0)
      hoogte = data.readUInt32BE(4)
      assert.equal(data[8], 8, 'Golden moet 8-bits zijn.')
      assert.equal(data[9], 2, 'Golden moet een RGB-PNG zonder palet zijn.')
      assert.equal(data[12], 0, 'Golden mag niet geïnterlaced zijn.')
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
  }

  assert.ok(breedte > 0 && hoogte > 0 && idat.length > 0, 'Golden PNG is onvolledig.')
  const bytesPerPixel = 3
  const rijLengte = breedte * bytesPerPixel
  const gefilterd = inflateSync(Buffer.concat(idat))
  assert.equal(
    gefilterd.length,
    hoogte * (rijLengte + 1),
    'Golden PNG heeft een onverwachte datalengte.',
  )

  const pixels = Buffer.alloc(breedte * hoogte * bytesPerPixel)
  for (let y = 0; y < hoogte; y += 1) {
    const filterOffset = y * (rijLengte + 1)
    const filter = gefilterd[filterOffset]
    const invoer = gefilterd.subarray(filterOffset + 1, filterOffset + 1 + rijLengte)
    const uitvoerOffset = y * rijLengte
    for (let byte = 0; byte < rijLengte; byte += 1) {
      const links = byte >= bytesPerPixel ? pixels[uitvoerOffset + byte - bytesPerPixel] : 0
      const boven = y > 0 ? pixels[uitvoerOffset + byte - rijLengte] : 0
      const linksboven =
        y > 0 && byte >= bytesPerPixel
          ? pixels[uitvoerOffset + byte - rijLengte - bytesPerPixel]
          : 0
      let voorspelling = 0
      if (filter === 1) voorspelling = links
      else if (filter === 2) voorspelling = boven
      else if (filter === 3) voorspelling = Math.floor((links + boven) / 2)
      else if (filter === 4) voorspelling = paeth(links, boven, linksboven)
      else assert.equal(filter, 0, `Onbekend PNG-filter ${filter}.`)
      pixels[uitvoerOffset + byte] = (invoer[byte] + voorspelling) & 0xff
    }
  }

  return { breedte, hoogte, pixels }
}

function isDonker(plaat, x, y, drempel = 200) {
  const offset = (y * plaat.breedte + x) * 3
  return (
    plaat.pixels[offset] < drempel &&
    plaat.pixels[offset + 1] < drempel &&
    plaat.pixels[offset + 2] < drempel
  )
}

function vindLaneAssen(plaat) {
  const kandidaten = []
  for (let x = 40; x < plaat.breedte - 15; x += 1) {
    let score = 0
    for (let y = 180; y < plaat.hoogte - 18; y += 1) {
      if (isDonker(plaat, x, y)) score += 1
    }
    if (score >= 350) kandidaten.push({ x, score })
  }

  const clusters = []
  for (const kandidaat of kandidaten) {
    const laatste = clusters.at(-1)
    if (!laatste || kandidaat.x - laatste.at(-1).x > 2) clusters.push([kandidaat])
    else laatste.push(kandidaat)
  }
  return clusters.map((cluster) =>
    cluster.reduce((beste, kandidaat) => kandidaat.score > beste.score ? kandidaat : beste),
  )
}

function vindHoofdlijnen(plaat) {
  const rijen = []
  for (let y = 130; y < plaat.hoogte - 13; y += 1) {
    let score = 0
    for (let x = 65; x < Math.min(730, plaat.breedte - 1); x += 1) {
      if (isDonker(plaat, x, y, 160)) score += 1
    }
    if (score >= 130) rijen.push({ y, score })
  }

  const clusters = []
  for (const rij of rijen) {
    const laatste = clusters.at(-1)
    if (!laatste || rij.y - laatste.at(-1).y > 1) clusters.push([rij])
    else laatste.push(rij)
  }
  return clusters.map((cluster) =>
    cluster.reduce((beste, rij) => rij.score > beste.score ? rij : beste),
  )
}

function telKleurpixels(plaat) {
  let wit = 0
  let blauw = 0
  let oranje = 0
  const totaal = plaat.breedte * plaat.hoogte
  for (let y = 0; y < plaat.hoogte; y += 1) {
    for (let x = 0; x < plaat.breedte; x += 1) {
      const offset = (y * plaat.breedte + x) * 3
      const r = plaat.pixels[offset]
      const g = plaat.pixels[offset + 1]
      const b = plaat.pixels[offset + 2]
      if (r >= 245 && g >= 245 && b >= 245) wit += 1
      if (b >= 150 && b > r * 1.6 && b > g * 1.6) blauw += 1
      if (r >= 170 && g >= 45 && g <= 155 && b <= 90) oranje += 1
    }
  }
  return { witAandeel: wit / totaal, blauw, oranje }
}

const pdf = readFileSync(pdfUrl)
const golden = readFileSync(goldenUrl)
assert.equal(sha256(pdf), VERWACHTE_PDF_SHA256, 'De bron-PDF is onverwacht gewijzigd.')
assert.equal(sha256(golden), VERWACHTE_GOLDEN_SHA256, 'De golden is onverwacht gewijzigd.')

const mediaBox = leesEersteMediaBox(pdf)
assert.deepEqual(mediaBox, VERWACHTE_MEDIA_BOX)

const plaat = decodeerRgbPng(golden)
assert.deepEqual(
  { breedte: plaat.breedte, hoogte: plaat.hoogte },
  VERWACHTE_RASTER,
)

const bronRatio = mediaBox.breedte / mediaBox.hoogte
const rasterRatio = plaat.breedte / plaat.hoogte
assert.ok(
  Math.abs(bronRatio - rasterRatio) <= 0.001,
  `Golden-verhouding ${rasterRatio.toFixed(6)} wijkt af van PDF ${bronRatio.toFixed(6)}.`,
)

const laneAssen = vindLaneAssen(plaat)
assert.deepEqual(
  laneAssen.map(({ x }) => x),
  VERWACHTE_LANE_ASSEN,
  'De vijf verticale lane-assen wijken af van de bronmeting.',
)
const laneAfstanden = laneAssen.slice(1).map(({ x }, index) => x - laneAssen[index].x)
const normaleAfstand = (laneAfstanden[0] + laneAfstanden[1] + laneAfstanden[3]) / 3
assert.ok(
  laneAfstanden[2] / normaleAfstand >= 1.95 &&
    laneAfstanden[2] / normaleAfstand <= 2.05,
  'De dubbele witruimte tussen uitvoerende rol en systeemlane ontbreekt.',
)

const hoofdlijnen = vindHoofdlijnen(plaat)
assert.deepEqual(
  hoofdlijnen.map(({ y }) => y),
  VERWACHTE_HOOFDLIJNEN,
  'De horizontale hoofdgeometrie wijkt af van de bronmeting.',
)

const kleuren = telKleurpixels(plaat)
assert.ok(kleuren.witAandeel >= 0.88, 'Golden bevat mogelijk viewerchrome of een donkere achtergrond.')
assert.ok(kleuren.blauw >= 900, 'Blauwe bronannotaties ontbreken in de golden.')
assert.ok(kleuren.oranje >= 350, 'Het oranje bronlogo ontbreekt in de golden.')

console.log(JSON.stringify({
  ok: true,
  bron: {
    pdfSha256: sha256(pdf),
    mediaBox,
    ratio: Number(bronRatio.toFixed(6)),
  },
  golden: {
    sha256: sha256(golden),
    raster: { breedte: plaat.breedte, hoogte: plaat.hoogte },
    ratio: Number(rasterRatio.toFixed(6)),
    laneAssen: laneAssen.map(({ x }) => x),
    laneAfstanden,
    hoofdlijnen: hoofdlijnen.map(({ y }) => y),
    kleuren,
  },
}))
