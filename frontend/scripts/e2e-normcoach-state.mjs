import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { chromium } from 'playwright'
const vragen = [{ id: 'vraag-1', titel: 'Eigenaarschap', vraag: 'Is een eigenaar aangewezen?', bewijsHint: 'Een rolbesluit' }, { id: 'vraag-2', titel: 'Periodieke review', vraag: 'Is een review gepland?', bewijsHint: 'Een kalender' }]
const maakToets = (id, naam, datum, bewijs) => ({ sessionId: id, kaderId: id, kaderNaam: naam, catalogVersion: 'test', status: 'open', gestartDoor: 'Reviewer', gestartOp: datum, revision: 1, vragen,
  antwoorden: [{ vraagId: 'vraag-1', uitkomst: 'ja', bewijsreferentie: bewijs, motivatie: '', beantwoordDoor: 'Reviewer', beantwoordOp: datum }],
  readiness: { beantwoord: 1, totaal: 2, ja: 1, deels: 0, nee: 0, onbekend: 0, nvt: 0, bewijsGereed: 1, open: 1, disclaimer: '' },
})
let toetsen = [maakToets('a', 'Kader A', '2026-09-08', 'bewijs-a'), maakToets('b', 'Kader B', '2026-09-07', 'bewijs-b')]
const kaders = toetsen.map((toets) => ({ id: toets.kaderId, naam: toets.kaderNaam, editie: '1', domein: 'Voorbeeld', type: 'Intern', bronUrl: 'https://example.com/', bronOrganisatie: 'Voorbeeld', bronGecontroleerdOp: '2026-09-08', actief: true, vragen }))
const server = await createServer({ server: { host: '127.0.0.1', port: 4188, strictPort: true, open: false } }); let browser
try {
  await server.listen(); browser = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await browser.newPage(); const errors = []; const writes = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname; let body
    if (path === '/api/config') body = { authMode: 'local', storage: 'local', online: false, versie: 'test' }
    else if (path === '/api/me') body = { user: { id: 'reviewer', naam: 'Reviewer', bron: 'local', rollen: ['goedkeuren'], groepen: [] } }
    else if (path === '/api/assurance/frameworks') body = { catalogVersion: 'test', kaders }
    else if (path === '/api/assurance/questionnaires') body = toetsen
    else if (path === '/api/assurance/questionnaires/b/answers') {
      const request = route.request().postDataJSON(); writes.push(request)
      assert.equal(request.expectedRevision, 1); assert.equal(request.vraagId, 'vraag-2'); assert.equal(request.bewijsreferentie, 'bewijs-review-b')
      const bijgewerkt = { ...toetsen[1], revision: 2, antwoorden: [...toetsen[1].antwoorden, { ...request, beantwoordDoor: 'Reviewer', beantwoordOp: '2026-09-08' }], readiness: { ...toetsen[1].readiness, beantwoord: 2, bewijsGereed: 2, open: 0 } }
      toetsen = [toetsen[0], bijgewerkt]; body = bijgewerkt
    } else { await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }); return }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })
  })
  await page.goto('http://127.0.0.1:4188/normcoach')
  await page.getByRole('heading', { name: 'Periodieke review', exact: true }).waitFor()
  const bewijs = page.getByPlaceholder('Bijv. document-id, URL, ticket of dossierpad')
  assert.equal(await bewijs.inputValue(), '')
  await page.getByRole('button', { name: 'Vorige vraag', exact: true }).click(); assert.equal(await bewijs.inputValue(), 'bewijs-a')
  await bewijs.fill('onopgeslagen-a')
  await page.getByRole('button', { name: 'Volgende vraag', exact: true }).click(); assert.equal(await bewijs.inputValue(), '')
  await page.locator('.nc-sessie').filter({ hasText: 'Kader B' }).click()
  await page.getByRole('button', { name: 'Vorige vraag', exact: true }).click(); assert.equal(await bewijs.inputValue(), 'bewijs-b')
  await page.getByRole('button', { name: 'Volgende vraag', exact: true }).click(); assert.equal(await bewijs.inputValue(), '')
  await page.getByRole('radio', { name: /^Ja / }).check(); await bewijs.fill('bewijs-review-b'); await page.getByRole('button', { name: 'Antwoord vastleggen en verder', exact: true }).click()
  await page.getByText('Antwoord op “Periodieke review” is traceerbaar vastgelegd.').waitFor()
  assert.equal(await bewijs.inputValue(), 'bewijs-review-b'); assert.equal(writes.length, 1)
  assert.deepEqual(errors, []); console.log('Normcoach UI geslaagd: invoer gescheiden per vraag en sessie, bestaande antwoorden zichtbaar, juiste vraag/revisie/bewijs opgeslagen en na save bijgewerkt.')
} finally { await browser?.close(); await server.close() }
