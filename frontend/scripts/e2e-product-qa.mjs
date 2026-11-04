import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { chromium } from 'playwright'
const shots = fileURLToPath(new URL('../.shots/product-qa/', import.meta.url)); await fs.mkdir(shots, { recursive: true })
const step = (id, next, type = 'actie') => ({ id, nummer: id, laneId: 'technicus', sectieId: 'hoofd', type, activiteit: id, ...(next ? { naarStap: next } : {}) })
const makeProcess = (name, id = 'synthetisch') => ({ id, hoofdproces: 'Onderhoud', detailproces: name, versie: 'V0.1', status: 'concept', laatsteWijziging: '2026-09-08', revision: 1, bron: { type: 'handmatig' }, lanes: [{ id: 'technicus', naam: 'Technicus', kleur: '#2563eb' }], secties: [{ id: 'hoofd', naam: 'Hoofdroute' }], stappen: [step('Start', 'Inspecteer', 'start'), step('Inspecteer', 'Afronding'), step('Afronding', undefined, 'eind')] })
const summaries = ['in-review', 'concept', 'live'].map((status, i) => ({ ...makeProcess(['Beoordeel onderhoud', 'Werk instructie bij', 'Geldige werkwijze'][i], `p-${i}`), status, aantalStappen: 3, koppelingen: [] }))
const pages = [{ id: 'visio/pages/page1.xml', name: 'Onderhoud', number: 1, background: false }, { id: 'visio/pages/page2.xml', name: 'Inspectie', number: 2, background: false }, { id: 'visio/pages/background.xml', name: 'Achtergrond', number: 3, background: true }]
const review = (extra = {}) => ({ ok: false, format: 'visio-vsdx', pages, geometry: [], confidence: 0, warnings: [], unmapped: [], errors: [], ...extra })
let roles = ['bewerken', 'goedkeuren'], empty = false, unavailable = false, suggestionsRequested = 0, holdUpload, delayUpload = false
const aiProcess = makeProcess('AI onderhoudsronde', 'ai-onderhoud'); delete aiProcess.revision
const savedProcesses = []
const imported = [], aiPrompts = [], unexpectedWrites = []
const server = await createServer({ server: { host: '127.0.0.1', port: 4189, strictPort: true, open: false } }); let browser
const results = []
try {
  await server.listen(); browser = await chromium.launch({ channel: 'msedge', headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); const page = await context.newPage(); const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await context.route('**/api/**', async (route) => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname; let body = {}, status = 200
    if (path === '/api/config') body = { authMode: 'local', storage: 'local', online: false, versie: 'test' }
    else if (path === '/api/me') body = { user: { id: 'synthetische-gebruiker', naam: 'Demo procesmanager', bron: 'local', rollen: roles, groepen: [] } }
    else if (path === '/api/workspace/processes' || path === '/api/processes') body = empty ? [] : summaries
    else if (path.startsWith('/api/processes/') && req.method() === 'PUT') { savedProcesses.push(req.postDataJSON()); body = { ...req.postDataJSON(), revision: 2 } }
    else if (path.startsWith('/api/workspace/processes/') || /\/api\/processes\/[^/]+$/.test(path)) body = makeProcess('Bestaand proces', path.split('/').at(-1))
    else if (path === '/api/suggestions') { suggestionsRequested++; body = empty ? [] : [{ id: 'feedback', procesId: 'p-1', stapId: 'Inspecteer', tekst: 'Voeg de controletermijn toe.', doorGebruiker: 'Medewerker', aangemaaktOp: '2026-09-01', status: 'open', type: 'verbetering' }] }
    else if (path === '/api/iso/overview') { if (unavailable) { status = 503; body = { message: 'Signalen tijdelijk niet beschikbaar' } } else body = { rijen: [], signalen: empty ? [] : [{ procesId: 'p-1', signaal: 'review-verlopen', ernst: 'fout', bericht: 'De reviewdatum is verlopen.' }], normen: [], hoofdprocessen: [] } }
    else if (path === '/api/assurance/frameworks') body = { catalogVersion: 'test', kaders: [] }
    else if (path.endsWith('/iso')) body = { procesId: path.split('/')[3], normen: [] }
    else if (path.includes('/history') || path.endsWith('/runs')) body = []
    else if (path === '/api/diagrams/visio/export-capability') body = { format: 'visio-vsdx', code: 'available', message: '', requiresValidatedTemplate: false }
    else if (path === '/api/diagrams/visio/import') {
      imported.push({ pageId: url.searchParams.get('pageId'), defaultRole: url.searchParams.get('defaultRole') })
      if (delayUpload) { await new Promise((resolve) => { holdUpload = resolve }); delayUpload = false }
      if (!url.searchParams.get('pageId')) body = review({ errors: [{ code: 'page-selection-required', message: 'Kies één procespagina uit het Visio-bestand.' }] })
      else if (url.searchParams.get('pageId') === 'visio/pages/page1.xml' && !url.searchParams.get('defaultRole')) body = review({ errors: [{ code: 'roles-missing', message: 'Dit diagram heeft geen herkenbare lanes. Bevestig de verantwoordelijke rol.' }] })
      else {
        const process = makeProcess(url.searchParams.get('pageId') === 'visio/pages/page1.xml' ? 'Visio onderhoud' : 'Visio inspectie')
        process.bron = { type: 'diagram-import', paginas: [url.searchParams.get('pageId') === 'visio/pages/page1.xml' ? 1 : 2] }; body = review({ ok: true, process, confidence: .75, geometry: process.stappen.map((s, i) => ({ semanticKind: 'step', semanticId: s.id, externalId: `shape-${i}`, x: 70, y: i * 130 + 30, width: 200, height: 70, unit: 'px' })), warnings: [{ code: 'generic-import', message: 'Controleer de rollen en verbindingen uit het oorspronkelijke diagram.' }], unmapped: [{ code: 'unsupported', elementId: 'shape-77', message: 'Decoratieve notitie niet als processtap overgenomen.' }] })
      }
    } else if (path === '/api/ai/vraag') {
      const prompt = req.postDataJSON().vraag; aiPrompts.push(prompt)
      body = { antwoord: prompt.startsWith('Haal expliciete') ? JSON.stringify({ procesNaam: { tekst: 'Onderhoudsronde' }, doel: { tekst: 'Machines inzetbaar houden' }, rollen: { tekst: 'Robot' }, starttrigger: { tekst: 'De planning geeft een onderhoudsmelding.' }, eindresultaat: { tekst: 'Na de controle is de machine vrijgegeven.' }, beslissingen: { tekst: '' } }) : JSON.stringify({ process: aiProcess, assumptions: [], uncertainties: [] }) }
    } else if (req.method() !== 'GET') unexpectedWrites.push(`${req.method()} ${path}`)
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  })
  const run = async (name, action) => { try { await action(); results.push({ name, ok: true }); console.log(`PASS ${name}`) } catch (error) { results.push({ name, ok: false, error: String(error) }); console.log(`FAIL ${name}: ${error.stack}`); console.log('ALERTS', await page.getByRole('alert').allTextContents()); console.log('NODES', await page.locator('.react-flow__node').evaluateAll((els) => els.map((e) => ({ class: e.className, id: e.getAttribute('data-id') })))); await page.screenshot({ path: `${shots}/${name}-failure.png`, fullPage: true }).catch(() => {}) } }
  const open = (path) => page.goto(`http://127.0.0.1:4189${path}`)
  const screenshot = (name) => page.screenshot({ path: `${shots}/${name}.png`, fullPage: true })
  const uploadVisio = async (name = 'bestaande-processen.vsdx') => { const chooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: 'Kies Visio-bestand (.vsdx)', exact: true }).click(); await (await chooser).setFiles({ name, mimeType: 'application/octet-stream', buffer: Buffer.from('synthetische UI-upload; parser wordt afzonderlijk getest') }) }
  await run('dashboard', async () => {
    await open('/dashboard'); await page.getByRole('heading', { name: 'Wat vraagt je aandacht?' }).waitFor(); await page.locator('.werkplek-tellers strong').first().getByText('1').waitFor()
    assert.deepEqual(await page.locator('.werkplek-tellers strong').allTextContents(), ['1', '1', '1', '1']); assert.equal(await page.getByRole('region', { name: 'Proces toevoegen' }).count(), 1); await screenshot('dashboard-desktop')
    unavailable = true; await page.getByRole('button', { name: 'Verversen', exact: true }).click(); await page.getByRole('alert').getByText(/Ontbrekende gegevens tellen niet als nul/).waitFor(); assert.equal(await page.locator('.werkplek-tellers strong').last().innerText(), '—')
    unavailable = false; empty = true; await page.getByRole('button', { name: 'Verversen', exact: true }).click(); await page.getByRole('heading', { name: 'Begin met één herkenbaar proces' }).waitFor(); empty = false
    roles = ['goedkeuren']; const before = suggestionsRequested; await page.reload(); await page.getByRole('heading', { name: 'Beoordeel ingediende wijzigingen' }).waitFor(); assert.equal(await page.getByRole('region', { name: 'Proces toevoegen' }).count(), 0); assert.equal(suggestionsRequested, before)
    roles = ['bewerken', 'goedkeuren']; await page.reload(); await page.getByRole('region', { name: 'Proces toevoegen' }).waitFor()
    await page.setViewportSize({ width: 390, height: 844 }); await screenshot('dashboard-mobile'); const size = await page.locator('main').evaluate((e) => ({ width: e.clientWidth, content: e.scrollWidth })); results.push({ name: 'dashboard-mobile-width', ...size }); assert.ok(size.content <= size.width, 'Dashboard must fit main viewport'); await page.setViewportSize({ width: 1440, height: 1000 })
  })
  await run('visio', async () => {
    await open('/uitwisseling'); await page.getByRole('button', { name: 'Kies Visio-bestand (.vsdx)', exact: true }).waitFor(); assert.match(await page.locator('.ux-formaten button').first().innerText(), /Microsoft Visio/); assert.equal(await page.locator('.ux-formaten button').first().getAttribute('aria-pressed'), 'true')
    await uploadVisio('ouder-bestand.vsd'); await page.getByRole('alert').getByText(/Sla een ouder Visio-bestand/).waitFor(); assert.equal(imported.length, 0)
    delayUpload = true; await uploadVisio(); await page.getByRole('status').getByText(/wordt geanalyseerd/).waitFor(); holdUpload(); await page.getByLabel('Visio-pagina', { exact: true }).waitFor(); assert.equal(await page.getByLabel('Visio-pagina', { exact: true }).locator('option').count(), 4); assert.equal(await page.getByLabel('Visio-pagina', { exact: true }).locator('option[value="visio/pages/background.xml"]').getAttribute('disabled'), '')
    await page.getByLabel('Visio-pagina', { exact: true }).selectOption('visio/pages/page1.xml'); await page.getByRole('button', { name: 'Analyseer deze pagina opnieuw' }).click(); await page.getByLabel(/Verantwoordelijke rol voor dit diagram/).waitFor(); assert.equal(await page.getByRole('button', { name: 'Analyseer deze pagina opnieuw' }).isDisabled(), true)
    await page.getByLabel(/Verantwoordelijke rol voor dit diagram/).fill('Technicus'); await page.getByRole('button', { name: 'Analyseer deze pagina opnieuw' }).click(); await page.getByRole('button', { name: 'Gebruik als gecontroleerd werkconcept' }).waitFor(); await page.getByText('Decoratieve notitie niet als processtap overgenomen.', { exact: false }).waitFor(); await screenshot('visio-review-desktop'); await page.setViewportSize({ width: 390, height: 844 }); await page.getByRole('heading', { name: 'Welke pagina en rollen wil je overnemen?', exact: true }).scrollIntoViewIfNeeded(); await screenshot('visio-review-mobile'); const mobile = await page.locator('main').evaluate((e) => ({ width: e.clientWidth, content: e.scrollWidth })); assert.ok(mobile.content <= mobile.width, 'Visio review must fit main viewport'); await page.setViewportSize({ width: 1440, height: 1000 })
    assert.deepEqual(imported.at(-1), { pageId: 'visio/pages/page1.xml', defaultRole: 'Technicus' })
    await page.getByLabel('Visio-pagina', { exact: true }).selectOption('visio/pages/page2.xml'); assert.equal(await page.getByRole('button', { name: 'Gebruik als gecontroleerd werkconcept' }).isDisabled(), true); await page.getByRole('button', { name: 'Analyseer deze pagina opnieuw' }).click(); await page.getByText('Visio inspectie', { exact: true }).waitFor(); assert.deepEqual(imported.at(-1), { pageId: 'visio/pages/page2.xml', defaultRole: null })
    await page.getByRole('button', { name: /^PDF/ }).click(); assert.equal(await page.locator('.dx-rapport').count(), 0); await page.getByRole('button', { name: /^Microsoft Visio/ }).click(); assert.equal(await page.locator('.dx-rapport').count(), 0)
    await uploadVisio(); await page.getByLabel('Visio-pagina', { exact: true }).selectOption('visio/pages/page2.xml'); await page.getByRole('button', { name: 'Analyseer deze pagina opnieuw' }).click(); await page.getByRole('button', { name: 'Gebruik als gecontroleerd werkconcept' }).click(); await page.getByRole('heading', { name: 'Visio inspectie', exact: true }).waitFor(); await page.getByRole('button', { name: /Opslaan als concept/ }).waitFor(); assert.equal(await page.locator('.react-flow__node-editorStep').count(), 3); await screenshot('visio-editor'); await page.getByRole('button', { name: /Opslaan als concept/ }).click(); await page.getByText(/Opgeslagen als concept/).first().waitFor(); assert.deepEqual(savedProcesses.at(-1).bron.paginas, [2]); assert.equal(savedProcesses.at(-1).bron.type, 'visio-import'); assert.equal(savedProcesses.at(-1).bron.bestand, 'bestaande-processen.vsdx'); assert.equal(Object.keys(savedProcesses.at(-1).diagramLayout.nodes).length, 3)
  })
  await run('csv', async () => {
    await open('/uitwisseling?formaat=tabel'); await page.getByLabel('CSV- of TSV-bestand').setInputFiles({ name: 'import.csv', mimeType: 'text/csv', buffer: Buffer.from('code;werk;verantwoordelijke;volgende\nA;Bereid onderhoud voor;Technicus;B\nB;Rond af;Technicus;') }); await page.getByRole('heading', { name: 'Koppel de kolommen' }).waitFor(); assert.equal(await page.getByRole('button', { name: /Open 2 stappen/ }).isDisabled(), true)
    await page.getByRole('combobox', { name: 'Stapnummer / ID', exact: true }).selectOption('0'); await page.getByRole('combobox', { name: 'Activiteit', exact: true }).selectOption('1'); assert.equal(await page.getByRole('button', { name: /Open 2 stappen/ }).isEnabled(), true)
    await page.setViewportSize({ width: 390, height: 844 }); await screenshot('csv-mobile'); const size = await page.locator('main').evaluate((e) => ({ width: e.clientWidth, content: e.scrollWidth })); results.push({ name: 'csv-mobile-width', ...size }); assert.ok(size.content <= size.width, 'CSV mapping must fit main viewport'); await page.setViewportSize({ width: 1440, height: 1000 })
    await page.getByRole('button', { name: /Open 2 stappen/ }).click(); await page.getByRole('heading', { name: 'import', exact: true }).waitFor(); assert.equal(await page.locator('.react-flow__node-editorStep').count(), 2)
  })
  await run('ai', async () => {
    await open('/ai-diagram'); const description = 'Onderhoudsronde. Machines inzetbaar houden. Technicus voert de controle uit. De planning geeft een onderhoudsmelding. Na de controle is de machine vrijgegeven.'; await page.getByLabel('Procesbeschrijving', { exact: true }).fill(description); await page.getByRole('button', { name: 'Analyseer mijn beschrijving' }).click(); await page.getByRole('heading', { name: '2. Controleer en vul aan' }).waitFor()
    assert.equal(await page.getByLabel(/Hoe heet dit proces/).inputValue(), 'Onderhoudsronde'); assert.equal(await page.getByLabel(/Welke rollen of systemen/).inputValue(), ''); assert.equal(await page.getByRole('button', { name: 'Maak diagram-preview' }).isDisabled(), true)
    await page.getByLabel(/Welke rollen of systemen/).fill('Technicus'); await page.getByLabel(/Welke beslissingen of uitzonderingsroutes/).fill('geen'); await page.getByRole('button', { name: 'Maak diagram-preview' }).click(); await page.getByRole('heading', { name: '3. Validatie' }).waitFor(); await page.getByText('Valide', { exact: true }).waitFor(); assert.doesNotMatch(aiPrompts.at(-1), /Robot/); await page.getByRole('heading', { name: '3. Validatie' }).scrollIntoViewIfNeeded(); await screenshot('ai-preview-desktop')
    await page.setViewportSize({ width: 390, height: 844 }); await page.getByRole('button', { name: 'Visualisatie passend weergeven', exact: true }).click(); await page.getByRole('heading', { name: '4. Preview', exact: true }).scrollIntoViewIfNeeded(); await screenshot('ai-preview-mobile'); const size = await page.locator('main').evaluate((e) => ({ width: e.clientWidth, content: e.scrollWidth })); results.push({ name: 'ai-mobile-width', ...size }); assert.ok(size.content <= size.width, 'AI preview must fit main viewport'); await page.setViewportSize({ width: 1440, height: 1000 })
    await page.getByLabel('Ik heb rollen, volgorde, start, einde en beslisroutes in deze preview gecontroleerd.').check(); await page.getByRole('button', { name: 'Accepteren voor procesbouwer' }).click(); await page.getByRole('heading', { name: 'AI onderhoudsronde', exact: true }).waitFor(); assert.equal(await page.locator('.react-flow__node-editorStep').count(), 3)
  })
  results.push({ name: 'api-writes', unexpectedWrites }, { name: 'browser-exceptions', errors: pageErrors }); console.log(JSON.stringify(results, null, 2)); await fs.writeFile(`${shots}/results.json`, JSON.stringify(results, null, 2)); assert.deepEqual(unexpectedWrites, []); assert.deepEqual(pageErrors, []); assert.ok(results.filter((r) => r.ok === false).length === 0)
} finally { await browser?.close(); await server.close() }
