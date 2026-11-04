// End-to-end regressie voor AI-voorstel → menselijke feedback → lokaal concept.
// De AI- en ledgerresponses worden vast geïntercepteerd; er wordt nooit een
// externe provider aangeroepen. Gebruik: node scripts/e2e-ai-run-history.mjs [baseUrl]
import { existsSync } from 'node:fs'
import { chromium } from 'playwright'

const base = process.argv[2] ?? 'http://127.0.0.1:4173'
const windowsChrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const executablePath = existsSync(windowsChrome) ? windowsChrome : undefined
const runId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const processId = 'service-aanvraagproces'
const oldActivity = 'Dient retouraanvraag in via de website'
const newActivity = 'Dient retouraanvraag in en controleert de verplichte gegevens'
const zeroHash = `sha256:${'0'.repeat(64)}`

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const analysis = {
  schemaVersion: 'process-maintenance.v1',
  runId,
  procesId: processId,
  processRevision: 1,
  status: 'voorstel',
  samenvatting: 'De intake kan eenduidiger worden beschreven.',
  bronIds: [`process:${processId}:revision:1`],
  vragen: [],
  issues: [{
    id: 'issue.intake.1',
    stapId: 'w1',
    categorie: 'beheersing',
    ernst: 'waarschuwing',
    titel: 'Verplichte gegevens zijn niet expliciet',
    bevinding: 'De activiteit benoemt niet dat verplichte gegevens worden gecontroleerd.',
    uitleg: 'Een expliciete controle maakt de uitvoering beter herleidbaar.',
    bronIds: [`process:${processId}:step:w1`],
  }],
  wijzigingen: [{
    id: 'change.intake.activity',
    stapId: 'w1',
    veld: 'activiteit',
    oudeWaarde: oldActivity,
    nieuweWaarde: newActivity,
    reden: 'Maak de intakecontrole expliciet.',
    bevestigingVereist: true,
    bronIds: [`process:${processId}:step:w1:field:activiteit`],
  }],
  bronnen: [
    {
      id: `process:${processId}:revision:1`,
      type: 'process',
      procesId: processId,
      processRevision: 1,
      stapId: null,
      veld: null,
      label: 'Procesrevisie 1',
      contentHash: zeroHash,
    },
    {
      id: `process:${processId}:step:w1`,
      type: 'process-step',
      procesId: processId,
      processRevision: 1,
      stapId: 'w1',
      veld: null,
      label: 'Stap 1',
      contentHash: zeroHash,
    },
    {
      id: `process:${processId}:step:w1:field:activiteit`,
      type: 'process-field',
      procesId: processId,
      processRevision: 1,
      stapId: 'w1',
      veld: 'activiteit',
      label: 'Stap 1, activiteit',
      contentHash: zeroHash,
    },
  ],
}

const baseRun = {
  runId,
  capability: 'process-maintenance',
  procesId: processId,
  processRevision: 1,
  status: 'completed',
  resultaatStatus: 'voorstel',
  provider: 'offline-e2e',
  model: 'fixture-v1',
  gestartDoor: 'Development beheerder',
  gestartOp: '2026-07-28T20:00:00.000Z',
  afgerondOp: '2026-07-28T20:00:01.250Z',
  duurMs: 1250,
  inputHash: zeroHash,
  outputHash: zeroHash,
  vraagAantal: 0,
  issueAantal: 1,
  wijzigingAantal: 1,
}

const browser = await chromium.launch({ executablePath })
const context = await browser.newContext({ viewport: { width: 1680, height: 1050 } })
const page = await context.newPage()
const pageErrors = []
const aiRequests = []
let analysisIntercepted = false
let feedbackRequest
let feedbackRecorded = false
let conceptWasVisibleBeforeFeedbackAcknowledged = false

page.on('pageerror', (error) => pageErrors.push(error.message))
page.on('request', (request) => {
  if (request.url().includes('/ai/')) {
    aiRequests.push(`${request.method()} ${request.url()}`)
  }
})

await page.route(
  `**/api/processes/${processId}/ai/maintenance-analysis`,
  async (route) => {
    analysisIntercepted = true
    const request = route.request().postDataJSON()
    assert(request.expectedRevision === 1, 'De analyse is niet aan revisie 1 gepind.')
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(analysis) })
  },
)

await page.route(
  new RegExp(
    `/api/processes/${processId}/ai/runs` +
      `(?:/[^/?]+/feedback)?(?:\\?.*)?$`,
  ),
  async (route) => {
  const request = route.request()
  if (request.method() === 'POST') {
    feedbackRequest = request.postDataJSON()
    feedbackRecorded = true
    conceptWasVisibleBeforeFeedbackAcknowledged =
      await page.locator('.pe-node-title', { hasText: newActivity }).count() > 0
    const acceptedRun = {
      ...baseRun,
      feedback: {
        beslissing: 'accepted',
        geaccepteerdeWijzigingIds: ['change.intake.activity'],
        doorGebruiker: 'Development beheerder',
        op: '2026-07-28T20:01:00.000Z',
      },
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(acceptedRun),
    })
    return
  }
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
      body: JSON.stringify([
      feedbackRecorded
        ? {
            ...baseRun,
            feedback: {
              beslissing: 'accepted',
              geaccepteerdeWijzigingIds: ['change.intake.activity'],
              doorGebruiker: 'Development beheerder',
              op: '2026-07-28T20:01:00.000Z',
            },
          }
        : baseRun,
      ]),
    })
  },
)

await page.goto(
  `${base}/bouwer/demo-abc-keuze-1` +
    '?kader=iso9001&controle=qms-meten&stap=k1',
)
await page.locator('.pe-shell').waitFor()
assert(
  await page.getByText(/inloggen is tijdelijk overgeslagen/i).isVisible(),
  'De expliciete lokale no-loginbanner ontbreekt.',
)
assert(
  await page.locator('.pe-node-kaderbevinding').count() > 0 &&
    await page.locator('.pe-node-framework-findings').count() > 0,
  'De gekoppelde ISO-bevinding markeert geen editorstap.',
)

await page.goto(`${base}/bouwer/${processId}`)
await page.locator('.pe-shell').waitFor()

await page.getByRole('button', { name: /Analyseer onderhoud/ }).click()
await page.getByRole('heading', { name: 'Controleerbaar onderhoudsvoorstel' }).waitFor()
assert(
  analysisIntercepted,
  `De analysefixture is niet onderschept. AI-verzoeken: ${aiRequests.join(' | ')}`,
)
await page.locator('.pe-node-ai-bevinding').waitFor()
assert(
  await page.locator('.pe-node-ai-bevinding').count() === 1,
  'Het AI-signaal markeert niet exact één editorstap.',
)

await page.getByRole('button', { name: 'Zet wijzigingen in concept' }).click()
await page.locator('.ai-steward-panel.ai-steward-applied').waitFor()
assert(
  feedbackRecorded,
  `De menselijke acceptatie is niet naar de ledger gestuurd. ` +
    `AI-verzoeken: ${aiRequests.join(' | ')}`,
)
assert(
  !conceptWasVisibleBeforeFeedbackAcknowledged,
  'De proceswijziging is lokaal toegepast voordat de ledgerfeedback was bevestigd.',
)
assert(
  feedbackRequest?.beslissing === 'accepted' &&
    feedbackRequest?.geaccepteerdeWijzigingIds?.length === 1 &&
    feedbackRequest.geaccepteerdeWijzigingIds[0] === 'change.intake.activity',
  `Onjuiste feedbackpayload: ${JSON.stringify(feedbackRequest)}`,
)
await page.locator('.pe-node-title', { hasText: newActivity }).waitFor()
assert(
  await page.locator('.pe-node-title', { hasText: newActivity }).count() === 1,
  'De gevalideerde tekstwijziging staat niet als lokaal concept in de editor.',
)

await page.getByRole('button', { name: 'AI Process Steward sluiten' }).click()
assert(
  await page.locator('.ai-steward-panel').count() === 0,
  'Het AI-voorstelpaneel kon na verwerking niet worden gesloten.',
)
await page.getByRole('button', { name: /AI-historie/ }).click()
await page.getByRole('heading', { name: 'AI-runhistorie' }).waitFor()
assert(
  await page.getByText('Geaccepteerd', { exact: true }).isVisible(),
  'De geaccepteerde beslissing is niet zichtbaar in de runhistorie.',
)
assert(
  (await page.locator('.pmrh-panel').textContent()).includes('1 wijziging vastgelegd'),
  'De runhistorie toont het geaccepteerde wijzigingsaantal niet.',
)
assert(pageErrors.length === 0, `Paginacrash: ${pageErrors.join(' | ')}`)

await context.close()
await browser.close()

console.log(JSON.stringify({
  ok: true,
  checks: {
    explicitNoLoginProfile: true,
    linkedIsoMarker: true,
    revisionPinned: true,
    editorMarker: true,
    feedbackBeforeConcept: true,
    acceptedIdsExact: true,
    localConceptOnly: true,
    historyVisibleWhenStewardClosed: true,
  },
}))
