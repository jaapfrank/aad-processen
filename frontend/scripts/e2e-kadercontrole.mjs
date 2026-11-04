// Regressietest voor de procesbrede ISO- en BPMN-gap-analyse.
// Gebruik: node scripts/e2e-kadercontrole.mjs [baseUrl]
import { existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const base = process.argv[2] ?? 'http://127.0.0.1:4174'
const windowsChrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const executablePath = existsSync(windowsChrome) ? windowsChrome : undefined
const shotDir = fileURLToPath(new URL('../.shots/', import.meta.url))
mkdirSync(shotDir, { recursive: true })

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const browser = await chromium.launch({ executablePath })

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const paginaFouten = []
  page.on('pageerror', (error) => paginaFouten.push(error.message))

  await page.goto(`${base}/iso`)
  await page.locator('#pk-titel').waitFor()

  assert(
    (await page.locator('.pk-kaderkaart').count()) === 6,
    'Het totaaloverzicht bevat niet alle zes officiële kaders.',
  )
  assert(
    (await page.locator('.pk-matrix tbody tr').count()) > 0,
    'De procesmatrix bevat geen werkprocessen.',
  )
  assert(
    (await page.locator('.pk-matrix thead th').count()) === 7,
    'De procesmatrix toont niet Proces plus zes kaderkolommen.',
  )
  await page.screenshot({ path: `${shotDir}kadercontrole-overzicht.png`, fullPage: true })

  const eersteProces = page.locator('.pk-matrix tbody tr').first().locator('th button')
  await eersteProces.click()
  await page.locator('.pk-proceskop h3').waitFor()
  assert(
    (await page.locator('.pk-resultaat').count()) === 6,
    'Een individueel proces bevat niet zes kaderresultaten.',
  )

  await page.locator('.pk-filters select').nth(1).selectOption('bpmn20')
  const resultaat = page.locator('.pk-resultaat')
  await resultaat.waitFor()
  const hoofdEditorActie = page.locator('.pk-procesacties a', {
    hasText: 'Aandachtspunten oplossen',
  })
  const hoofdEditorHref = await hoofdEditorActie.getAttribute('href')
  assert(
    hoofdEditorHref?.includes('kader=bpmn20') &&
      !hoofdEditorHref.includes('controle=') &&
      !hoofdEditorHref.includes('stap='),
    `De hoofdactie behoudt het geselecteerde kader niet volledig (${hoofdEditorHref ?? 'geen href'}).`,
  )
  const alleBevindingenPagina = await context.newPage()
  await alleBevindingenPagina.goto(new URL(hoofdEditorHref, base).toString())
  const alleBevindingenBar = alleBevindingenPagina.getByRole('region', {
    name: 'ISO- en kaderbevindingen',
  })
  await alleBevindingenBar.waitFor()
  assert(
    await alleBevindingenPagina.locator('.pe-process-findings li').count() >= 2,
    'De kader-hoofdactie toont niet alle procesniveau-bevindingen in de editor.',
  )
  await alleBevindingenPagina.close()
  assert((await resultaat.count()) === 1, 'Het kaderfilter beperkt het resultaat niet tot BPMN.')
  assert(
    (await resultaat.getAttribute('open')) !== null,
    'Een enkel kaderresultaat is niet direct geopend.',
  )
  assert(
    (await resultaat.locator('.pk-controle').count()) >= 8,
    'Het BPMN-resultaat bevat te weinig structurele en governancecontroles.',
  )
  const rollenControle = resultaat.locator('.pk-controle', {
    hasText: 'Rollen en stapverantwoordelijkheid',
  })
  assert(
    await rollenControle.evaluate((element) => element.classList.contains('gevonden')),
    'De geldige rolkoppelingen krijgen geen consistente gevonden-status.',
  )
  assert(
    (await rollenControle.textContent()).includes('rol(len) zijn benoemd'),
    'De gevonden rolcontrole toont een tegenstrijdige bevinding.',
  )
  const eventsControle = resultaat.locator('.pk-controle', {
    hasText: 'Start- en eindevents',
  })
  assert(
    await eventsControle.evaluate((element) => element.classList.contains('aandacht')),
    'Een ontbrekende expliciete start wordt niet als aandachtspunt gemarkeerd.',
  )
  assert(
    (await eventsControle.textContent()).includes('ontbreekt'),
    'Het BPMN-aandachtspunt toont niet waarom de modelcheck faalt.',
  )
  const bron = resultaat.locator('.pk-bron a')
  assert(
    (await bron.getAttribute('href')) === 'https://www.omg.org/spec/BPMN/2.0.2/',
    'De officiële BPMN-bron ontbreekt of is onjuist.',
  )
  await page.screenshot({ path: `${shotDir}kadercontrole-bpmn.png`, fullPage: true })
  const procesniveauActie = eventsControle.locator('.pk-editoractie')
  assert(
    await procesniveauActie.isVisible(),
    'Een procesniveau-bevinding heeft geen duidelijke editoractie.',
  )
  const procesniveauHref = await procesniveauActie.getAttribute('href')
  assert(
    procesniveauHref && !procesniveauHref.includes('stap='),
    'Ontbrekende start/einde is ten onrechte aan een bestaande stap gekoppeld.',
  )
  const procesniveauPagina = await context.newPage()
  await procesniveauPagina.goto(new URL(procesniveauHref, base).toString())
  const procesniveauBar = procesniveauPagina.getByRole('region', {
    name: 'ISO- en kaderbevindingen',
  })
  await procesniveauBar.waitFor()
  assert(
    (await procesniveauBar.textContent()).includes('procesniveau'),
    'De editor verliest de niet-koppelbare procesbevinding.',
  )
  assert(
    await procesniveauPagina.locator('.pe-process-findings').count() === 1,
    'De procesniveau-taak is niet afzonderlijk zichtbaar in de editor.',
  )
  assert(
    await procesniveauPagina.locator('.pe-node-framework-findings').count() === 0,
    'Een procesniveau-taak markeert ten onrechte een processtap.',
  )
  await procesniveauPagina.close()

  // Gebruik een vaste fixture met een kaderbevinding die aantoonbaar aan
  // bestaande uitvoeringsstappen gekoppeld kan worden.
  await page.goto(`${base}/iso`)
  const koppelbaarProces = page.locator('.pk-matrix tbody tr', {
    hasText: 'Demo (ABC-keuze) 1/2',
  })
  await koppelbaarProces.locator('th button').click()
  await page.locator('.pk-filters select').nth(1).selectOption('iso9001')
  const koppelbaarResultaat = page.locator('.pk-resultaat')
  await koppelbaarResultaat.waitFor()
  const stapActie = koppelbaarResultaat.locator('.pk-editoractie[href*="stap="]').first()
  assert(
    await stapActie.isVisible(),
    'Een eenduidig stap-koppelbare ISO 9001-bevinding heeft geen editoractie.',
  )
  await stapActie.click()
  await page.waitForURL(/\/bouwer\/.+[?&]kader=iso9001/)
  const bevindingenBar = page.getByRole('region', { name: 'ISO- en kaderbevindingen' })
  await bevindingenBar.waitFor()
  assert(
    await page.locator('.pe-node-framework-findings').count() > 0,
    'Gekoppelde kaderbevindingen markeren geen nodes.',
  )
  assert(
    await page.locator('.pe-node-kaderbevinding').count() > 0,
    'De gemarkeerde node mist de kaderstijl.',
  )
  assert(
    await bevindingenBar.getByRole('button', { name: 'Focus gemarkeerd' }).getAttribute('aria-pressed') === 'true',
    'Doorklikken activeert het kaderfilter niet.',
  )
  assert(
    await bevindingenBar.getByLabel('Ga naar stap').inputValue() !== '',
    'De gekoppelde stap is niet in de focusselectie gekozen.',
  )
  assert(
    await page.locator('.pe-node-selected.pe-node-kaderbevinding').count() === 1,
    'De juiste gekoppelde node is niet geselecteerd en gefocust.',
  )
  assert(
    await page.locator('.pe-step-findings').isVisible(),
    'De inspector toont de bevinding van de geselecteerde stap niet.',
  )
  await bevindingenBar.getByRole('button', { name: 'Alle stappen' }).click()
  assert(
    await page.locator('.pe-node-dimmed').count() === 0,
    'Het filter Alle stappen heft de focusdim niet op.',
  )

  assert(paginaFouten.length === 0, `Browserfouten: ${paginaFouten.join(' | ')}`)

  await page.close()
  await context.close()
} finally {
  await browser.close()
}

console.log(JSON.stringify({
  ok: true,
  checks: {
    allProcesses: true,
    sixFrameworks: true,
    perProcessDetails: true,
    bpmnFilter: true,
    officialSource: true,
    processLevelFindingPreserved: true,
    linkedFindingEditorFocus: true,
    editorLegendAndFilter: true,
    frameworkPreservedByMainAction: true,
    allFrameworkFindingsVisible: true,
  },
}))
