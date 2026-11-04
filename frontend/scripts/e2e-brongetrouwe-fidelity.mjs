// Browseracceptatie voor de brongetrouwe renderer van Service – Aanvraagproces.
//
// Gebruik:
//   node scripts/e2e-brongetrouwe-fidelity.mjs [baseUrl]
//
// Deze test start of stopt geen server. De opgegeven app moet al bereikbaar zijn.
import { existsSync } from 'node:fs'
import { chromium } from 'playwright'

const base = (process.argv[2] ?? 'http://127.0.0.1:4174').replace(/\/+$/, '')
const GOLDEN = {
  breedte: 793,
  hoogte: 1283,
  ratio: 595.2 / 963.72,
  laneXs: [111, 225, 338, 565, 678],
  stapYs: {
    'Dient retouraanvraag in': 252,
    'Stuurt RMA-nummer en status ‘controle’ bericht': 347,
    'Start proces Service – controle nieuwe aanvragen': 393,
    'Zet RMA status door naar volgende': 443,
    'Stuurt RMA-nummer en retourinstructies': 513,
    'Stuurt artikel op of brengt artikel langs onder vermelding van RMA-nummer': 572,
    'Eind van het proces. Start proces Service ontvangst': 632,
    'Geeft aan iets retour te willen sturen': 730,
    'Vraagt informatie op': 777,
    'Controleert of klant account heeft en zoekt orderinformatie': 828,
    'Maakt RMA-nummer aan': 866,
    'Zet retourmelding door naar status ‘controle’': 928,
    "Stuurt RMA-nummer en status 'controle' bericht": 973,
    'Start proces Service – controle nieuwe aanvragen#2': 1025,
    'Zet RMA status door naar volgende#2': 1071,
    'Stuurt RMA-nummer en retourinstructies#2': 1134,
    'Stuurt artikel op onder vermelding van RMA-nummer': 1193,
    'Eind van het proces. Start proces Service ontvangst#2': 1251,
  },
}
const LANE_TOLERANTIE_PX = 4
const STAP_TOLERANTIE_PX = 6
// Onafhankelijk op de kale golden gemeten. Deze waarden komen dus niet uit
// brongetrouweLayout.ts of uit CSS-variabelen van de renderer.
const GOLDEN_TYPOGRAFIE = {
  fontPx: {
    logo: 29.3,
    metakop: 16,
    metaKlein: 8,
    lane: 13.3,
    body: 10.7,
  },
  kopBaselines: [91, 110, 130],
  laneEenRegelBaseline: 168,
}
const FONT_TOLERANTIE_PX = 0.8

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

function vrijwelGelijk(werkelijk, verwacht, tolerantie, context) {
  assert(
    Math.abs(werkelijk - verwacht) <= tolerantie,
    `${context}: ${werkelijk.toFixed(2)}; verwacht ${verwacht} ± ${tolerantie}.`,
  )
}

function normaliseerTekst(tekst) {
  return tekst.replace(/\s+/g, ' ').trim()
}

const browser = await chromium.launch(executablePath ? { executablePath } : {})
const page = await browser.newPage({
  viewport: { width: 1680, height: 1000 },
  deviceScaleFactor: 1,
})
const consoleErrors = []
const pageErrors = []
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text())
})
page.on('pageerror', (error) => pageErrors.push(error.message))

try {
  await page.goto(`${base}/proces/service-aanvraagproces`, {
    waitUntil: 'domcontentloaded',
  })
  const root = page.locator('.proces-main .pv-root')
  await root.waitFor({ state: 'visible' })
  await root.getByRole('button', { name: 'Brongetrouw', exact: true }).click()

  const scrollgebied = root.locator('.pv-fidelity[data-pv-zoomgebied]')
  const svg = scrollgebied.locator('svg')
  await svg.waitFor({ state: 'visible' })

  const geometrie = await svg.evaluate((element, golden) => {
    if (!(element instanceof SVGSVGElement)) throw new Error('Brongetrouwe SVG ontbreekt.')
    const viewBox = element.viewBox.baseVal
    const naarGoldenX = (x) => (x / viewBox.width) * golden.breedte
    const naarGoldenY = (y) => (y / viewBox.height) * golden.hoogte
    const lanes = [...element.querySelectorAll('text.pv-lane-naam')].map((lane) => ({
      naam: lane.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      x: naarGoldenX(lane.x.baseVal[0]?.value ?? Number.NaN),
    }))

    const dubbeleLabels = new Map()
    const stappen = [...element.querySelectorAll('g.pv-svg-stap')].map((groep) => {
      const aria = groep.getAttribute('aria-label') ?? ''
      const activiteit = aria.replace(/^Stap [^:]+:\s*/, '')
      const aantal = (dubbeleLabels.get(activiteit) ?? 0) + 1
      dubbeleLabels.set(activiteit, aantal)
      const sleutel = aantal === 1 ? activiteit : `${activiteit}#${aantal}`
      const symbool = [...groep.children].find(
        (kind) =>
          kind.matches('rect.pv-stap-vierkant, rect.pv-marker, circle.pv-systeemcirkel'),
      )
      if (!(symbool instanceof SVGGraphicsElement)) {
        throw new Error(`Hoofdsymbool ontbreekt bij '${aria}'.`)
      }
      const box = symbool.getBBox()
      return {
        sleutel,
        y: naarGoldenY(box.y + box.height / 2),
      }
    })

    const inhoud = [...element.querySelectorAll('g.pv-svg-stap')]
      .map((groep) => groep.getBBox())
      .reduce(
        (bereik, box) => ({
          boven: Math.min(bereik.boven, box.y),
          onder: Math.max(bereik.onder, box.y + box.height),
        }),
        { boven: Number.POSITIVE_INFINITY, onder: Number.NEGATIVE_INFINITY },
      )

    return {
      viewBox: {
        breedte: viewBox.width,
        hoogte: viewBox.height,
        ratio: viewBox.width / viewBox.height,
      },
      dataRatio: Number(element.dataset.layoutRatio),
      lanes,
      stappen,
      inhoudOnderkant: inhoud.onder / viewBox.height,
    }
  }, GOLDEN)

  vrijwelGelijk(geometrie.viewBox.ratio, GOLDEN.ratio, 0.001, 'Paginaverhouding')
  vrijwelGelijk(geometrie.dataRatio, GOLDEN.ratio, 0.001, 'data-layout-ratio')
  assert(
    geometrie.lanes.length === GOLDEN.laneXs.length,
    `Aantal lanes ${geometrie.lanes.length}; verwacht ${GOLDEN.laneXs.length}.`,
  )
  geometrie.lanes.forEach((lane, index) => {
    vrijwelGelijk(
      lane.x,
      GOLDEN.laneXs[index],
      LANE_TOLERANTIE_PX,
      `Lane ${lane.naam || index + 1} op goldenbreedte`,
    )
  })

  const laneAfstanden = geometrie.lanes
    .slice(1)
    .map((lane, index) => lane.x - geometrie.lanes[index].x)
  const normaleAfstand =
    (laneAfstanden[0] + laneAfstanden[1] + laneAfstanden[3]) / 3
  const systeemSprongFactor = laneAfstanden[2] / normaleAfstand
  assert(
    systeemSprongFactor >= 1.95 && systeemSprongFactor <= 2.05,
    `De sprong naar de eerste systeemkolom is ${systeemSprongFactor.toFixed(3)}× in plaats van 2×.`,
  )

  const stapPosities = new Map(geometrie.stappen.map((stap) => [stap.sleutel, stap.y]))
  for (const [sleutel, verwacht] of Object.entries(GOLDEN.stapYs)) {
    const werkelijk = stapPosities.get(sleutel)
    assert(werkelijk !== undefined, `Golden-hoofdstap '${sleutel}' ontbreekt.`)
    vrijwelGelijk(werkelijk, verwacht, STAP_TOLERANTIE_PX, `Hoofdstap '${sleutel}'`)
  }
  assert(
    geometrie.inhoudOnderkant >= 0.98 && geometrie.inhoudOnderkant <= 1.005,
    `Diagraminhoud vult de bladonderkant niet correct (${(geometrie.inhoudOnderkant * 100).toFixed(1)}%).`,
  )

  const semantiek = await svg.evaluate((element) => {
    const tekstVanSvgTekst = (tekst) =>
      [...tekst.querySelectorAll('tspan')]
        .map((regel) => regel.textContent?.trim() ?? '')
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
    const viewBox = element.viewBox.baseVal
    const gebeurtenissen = [...element.querySelectorAll('g.pv-systeem-event')].map((groep) => {
      const tekst = groep.querySelector('text.pv-systeem-event-tekst')
      const box = groep.getBBox()
      return {
        label: tekst ? tekstVanSvgTekst(tekst) : '',
        cirkels: groep.querySelectorAll(':scope > circle.pv-systeemcirkel').length,
        box: {
          x: box.x,
          y: box.y,
          breedte: box.width,
          hoogte: box.height,
          bladBreedte: viewBox.width,
          bladHoogte: viewBox.height,
        },
        binnenBlad:
          box.x >= -1 &&
          box.y >= -1 &&
          box.x + box.width <= viewBox.width + 1 &&
          box.y + box.height <= viewBox.height + 1,
      }
    })
    const annotaties = [...element.querySelectorAll('g.pv-annotatie-groep')].map((groep) => {
      const tekst = groep.querySelector('text.pv-annotatie')
      const box = tekst?.getBBox()
      return {
        tekst: tekst ? tekstVanSvgTekst(tekst) : '',
        xGolden: box ? (box.x / viewBox.width) * 793 : Number.NaN,
        fill: tekst ? getComputedStyle(tekst).fill : '',
        heeftLokaleLeider: Boolean(groep.querySelector(':scope > line.pv-annotatie-leider')),
      }
    })
    return { gebeurtenissen, annotaties }
  })

  const typografie = await svg.evaluate((element, golden) => {
    if (!(element instanceof SVGSVGElement)) throw new Error('Brongetrouwe SVG ontbreekt.')
    const viewBox = element.viewBox.baseVal
    const schaalX = golden.breedte / viewBox.width
    const schaalY = golden.hoogte / viewBox.height
    const meet = (selector) => {
      const node = element.querySelector(selector)
      if (!(node instanceof SVGGraphicsElement)) {
        throw new Error(`Typografie-element '${selector}' ontbreekt.`)
      }
      const box = node.getBBox()
      const stijl = getComputedStyle(node)
      return {
        tekst: node.textContent?.replace(/\s+/g, ' ').trim() ?? '',
        x: box.x * schaalX,
        y: box.y * schaalY,
        breedte: box.width * schaalX,
        hoogte: box.height * schaalY,
        fontPx: Number.parseFloat(stijl.fontSize) * schaalX,
        gewicht: stijl.fontWeight,
        stijl: stijl.fontStyle,
        fill: stijl.fill,
      }
    }
    const logo = meet('text.pv-azerty')
    const logoKleuren = [...element.querySelectorAll('text.pv-azerty > tspan')]
      .map((node) => getComputedStyle(node).fill)
    const metakoppen = [...element.querySelectorAll('text.pv-meta')].map((node) => {
      const box = node.getBBox()
      return {
        tekst: node.textContent?.replace(/\s+/g, ' ').trim() ?? '',
        baseline: (node.y.baseVal[0]?.value ?? Number.NaN) * schaalY,
        fontPx: Number.parseFloat(getComputedStyle(node).fontSize) * schaalX,
        x: box.x * schaalX,
      }
    })
    const metaKlein = meet('text.pv-meta-klein')
    const lanes = [...element.querySelectorAll('text.pv-lane-naam')].map((node) => {
      const box = node.getBBox()
      const stijl = getComputedStyle(node)
      return {
        tekst: node.textContent?.replace(/\s+/g, ' ').trim() ?? '',
        x: box.x * schaalX,
        y: box.y * schaalY,
        breedte: box.width * schaalX,
        hoogte: box.height * schaalY,
        fontPx: Number.parseFloat(stijl.fontSize) * schaalX,
        gewicht: stijl.fontWeight,
        stijl: stijl.fontStyle,
        fill: stijl.fill,
        baseline: (node.y.baseVal[0]?.value ?? Number.NaN) * schaalY,
      }
    })
    const body = meet('text.pv-activiteit')
    const annotatie = meet('text.pv-annotatie')
    return { logo, logoKleuren, metakoppen, metaKlein, lanes, body, annotatie }
  }, GOLDEN)

  assert(typografie.logo.tekst === 'AZERTY', 'Bronlogo heeft niet de verwachte tekstinhoud.')
  assert(
    typografie.logo.x >= 34 && typografie.logo.x <= 45 &&
      typografie.logo.y >= 20 && typografie.logo.y <= 42 &&
      typografie.logo.breedte >= 90 && typografie.logo.breedte <= 135,
    `Bronlogo wijkt materieel af van de golden-zone (${JSON.stringify(typografie.logo)}).`,
  )
  assert(
    typografie.logoKleuren.some((kleur) => /31,\s*90,\s*138/.test(kleur)) &&
      typografie.logoKleuren.some((kleur) => /234,\s*91,\s*12/.test(kleur)),
    `Bronlogo mist de onafhankelijke blauw/oranje kleurverdeling (${typografie.logoKleuren.join(', ')}).`,
  )
  const verwachteKoppen = [
    'Hoofdproces: Service',
    'Detailproces: Service – Aanvraagproces',
    'Versie: V1.1',
  ]
  assert(
    JSON.stringify(typografie.metakoppen.map((kop) => kop.tekst)) ===
      JSON.stringify(verwachteKoppen),
    `Kopteksten wijken af: ${typografie.metakoppen.map((kop) => kop.tekst).join(' | ')}`,
  )
  typografie.metakoppen.forEach((kop, index) => {
    vrijwelGelijk(
      kop.baseline,
      GOLDEN_TYPOGRAFIE.kopBaselines[index],
      2,
      `Baseline koptekst ${index + 1}`,
    )
    vrijwelGelijk(
      kop.fontPx,
      GOLDEN_TYPOGRAFIE.fontPx.metakop,
      FONT_TOLERANTIE_PX,
      `Lettergrootte koptekst ${index + 1}`,
    )
  })
  vrijwelGelijk(
    typografie.logo.fontPx,
    GOLDEN_TYPOGRAFIE.fontPx.logo,
    FONT_TOLERANTIE_PX,
    'Lettergrootte bronlogo',
  )
  vrijwelGelijk(
    typografie.metaKlein.fontPx,
    GOLDEN_TYPOGRAFIE.fontPx.metaKlein,
    FONT_TOLERANTIE_PX,
    'Lettergrootte wijzigingsdatum',
  )
  for (const lane of typografie.lanes) {
    vrijwelGelijk(
      lane.fontPx,
      GOLDEN_TYPOGRAFIE.fontPx.lane,
      FONT_TOLERANTIE_PX,
      `Lettergrootte lane '${lane.tekst}'`,
    )
  }
  const eenRegelLane = typografie.lanes.find((lane) => lane.tekst === 'Klant')
  assert(eenRegelLane, 'Golden-lane Klant ontbreekt.')
  vrijwelGelijk(
    eenRegelLane.baseline,
    GOLDEN_TYPOGRAFIE.laneEenRegelBaseline,
    3,
    'Baseline lane Klant',
  )
  vrijwelGelijk(
    typografie.body.fontPx,
    GOLDEN_TYPOGRAFIE.fontPx.body,
    FONT_TOLERANTIE_PX,
    'Lettergrootte activiteit',
  )
  vrijwelGelijk(
    typografie.annotatie.fontPx,
    GOLDEN_TYPOGRAFIE.fontPx.body,
    FONT_TOLERANTIE_PX,
    'Lettergrootte annotatie',
  )
  assert(
    typografie.annotatie.stijl === 'italic' &&
      /rgb\(\s*0\s*,\s*0\s*,\s*232\s*\)/.test(typografie.annotatie.fill),
    'Bronannotatie wijkt in cursief of blauw af van de golden.',
  )

  const vereisteEvents = [
    'Maakt RMA nummer aan',
    'Synchroniseert RMA gegevens',
    'RMA status ‘controle’',
    'RMA status ‘invoer compleet’',
  ]
  for (const label of vereisteEvents) {
    const events = semantiek.gebeurtenissen.filter(
      (event) => normaliseerTekst(event.label) === label,
    )
    assert(events.length > 0, `Aparte systeemevent-callout '${label}' ontbreekt.`)
    assert(
      events.every((event) => event.cirkels >= 1 && event.binnenBlad),
      `Systeemevent '${label}' mist een zichtbaar cirkelsymbool of valt buiten het blad: ${JSON.stringify(events)}.`,
    )
  }
  assert(
    semantiek.gebeurtenissen.filter(
      (event) => normaliseerTekst(event.label) === 'Synchroniseert RMA gegevens',
    ).every((event) => event.cirkels === 2),
    'Synchronisatie-events moeten beide systeemlanes met twee cirkels verbinden.',
  )

  const annotatieTekst = semantiek.annotaties.map((annotatie) =>
    normaliseerTekst(annotatie.tekst),
  )
  for (const fragment of [
    'Volgens instructie op website',
    'Dit kan telefonisch, aan de balie of per e-mail zijn',
    'Retourreden (WKOA)',
  ]) {
    assert(
      annotatieTekst.some((tekst) => tekst.includes(fragment)),
      `Lokale blauwe annotatie '${fragment}' ontbreekt.`,
    )
  }
  assert(
    semantiek.annotaties.every(
      (annotatie) =>
        annotatie.heeftLokaleLeider &&
        annotatie.xGolden > 70 &&
        annotatie.xGolden < GOLDEN.laneXs[3] &&
        /rgb\(\s*0\s*,\s*0\s*,\s*232\s*\)/.test(annotatie.fill),
    ),
    'Annotaties zijn niet allemaal blauw en lokaal binnen het procesdiagram geplaatst.',
  )
  assert(
    !annotatieTekst.some(
      (tekst) =>
        tekst.includes('RMA status') ||
        tekst.includes('Synchroniseert RMA gegevens') ||
        tekst.includes('Maakt RMA nummer aan'),
    ),
    'Een systeemevent is ten onrechte met een blauwe annotatie samengevoegd.',
  )

  const scrollMaten = await scrollgebied.evaluate((element) => ({
    clientWidth: element.clientWidth,
    clientHeight: element.clientHeight,
    scrollWidth: element.scrollWidth,
    scrollHeight: element.scrollHeight,
    overflowX: getComputedStyle(element).overflowX,
    overflowY: getComputedStyle(element).overflowY,
    tabIndex: element.tabIndex,
  }))
  assert(
    scrollMaten.overflowX === 'auto' && scrollMaten.overflowY === 'auto',
    `Bronblad is niet tweedimensionaal scrollbaar (${JSON.stringify(scrollMaten)}).`,
  )
  assert(scrollMaten.tabIndex === 0, 'Het scrollgebied is niet met het toetsenbord bereikbaar.')
  assert(
    scrollMaten.scrollWidth > scrollMaten.clientWidth &&
      scrollMaten.scrollHeight > scrollMaten.clientHeight,
    `100%-bronblad moet horizontaal en verticaal kunnen scrollen (${JSON.stringify(scrollMaten)}).`,
  )
  await scrollgebied.evaluate((element) => {
    element.scrollLeft = element.scrollWidth
    element.scrollTop = element.scrollHeight
  })
  await page.waitForTimeout(80)
  const verschoven = await scrollgebied.evaluate((element) => ({
    x: element.scrollLeft,
    y: element.scrollTop,
  }))
  assert(verschoven.x > 0 && verschoven.y > 0, 'Het bronblad kan niet in beide richtingen worden verschoven.')

  await root.getByRole('button', { name: 'Visualisatie passend weergeven' }).click()
  await page.waitForTimeout(220)
  const passend = await root.evaluate((element) => {
    const gebied = element.querySelector('.pv-fidelity')
    const plaat = gebied?.querySelector('svg')
    const status = element.querySelector('output[aria-label="Zoomniveau"]')
    if (!(gebied instanceof HTMLElement) || !(plaat instanceof SVGSVGElement)) {
      throw new Error('Passend-meting mist bronblad.')
    }
    return {
      zoom: Number.parseInt(status?.textContent?.replace(/[^\d]/g, '') ?? '', 10),
      clientWidth: gebied.clientWidth,
      svgBreedte: plaat.getBoundingClientRect().width,
      verticaleOverflow: gebied.scrollHeight > gebied.clientHeight,
    }
  })
  assert(
    passend.zoom >= 40 && passend.zoom < 100,
    `Passend leverde een ongeldige zoom van ${passend.zoom}%.`,
  )
  assert(
    passend.svgBreedte <= passend.clientWidth + 2,
    `Passend blad is nog te breed (${passend.svgBreedte.toFixed(1)} > ${passend.clientWidth}).`,
  )
  assert(passend.verticaleOverflow, 'Passend maken heeft verticale bereikbaarheid verloren.')

  const reset = root.getByRole('button', { name: 'Zoom herstellen naar 100%' })
  await reset.click()
  await page.waitForTimeout(180)
  assert(
    (await root.getByRole('status', { name: 'Zoomniveau' }).innerText()).trim() === '100%',
    'Zoomreset herstelde de bronweergave niet naar 100%.',
  )

  assert(consoleErrors.length === 0, `Consolefouten: ${consoleErrors.join(' | ')}`)
  assert(pageErrors.length === 0, `Paginacrash: ${pageErrors.join(' | ')}`)

  console.log(JSON.stringify({
    ok: true,
    bron: 'service-aanvraagproces-pagina1.png',
    route: `${base}/proces/service-aanvraagproces`,
    geometrie: {
      ratio: Number(geometrie.viewBox.ratio.toFixed(6)),
      laneXs: geometrie.lanes.map((lane) => Number(lane.x.toFixed(1))),
      dubbeleSysteemafstand: Number(systeemSprongFactor.toFixed(3)),
      getoetsteHoofdstappen: Object.keys(GOLDEN.stapYs).length,
      inhoudOnderkant: Number(geometrie.inhoudOnderkant.toFixed(3)),
    },
    semantiek: {
      systeemevents: semantiek.gebeurtenissen.length,
      lokaleBlauweAnnotaties: semantiek.annotaties.length,
    },
    typografie: {
      logoPx: Number(typografie.logo.fontPx.toFixed(1)),
      metaPx: Number(typografie.metakoppen[0].fontPx.toFixed(1)),
      lanePx: Number(typografie.lanes[0].fontPx.toFixed(1)),
      bodyPx: Number(typografie.body.fontPx.toFixed(1)),
      kopBaselines: typografie.metakoppen.map((kop) => Number(kop.baseline.toFixed(1))),
    },
    bediening: {
      scrollX: true,
      scrollY: true,
      passendZoom: passend.zoom,
      reset: true,
    },
  }))
} finally {
  await browser.close()
}
