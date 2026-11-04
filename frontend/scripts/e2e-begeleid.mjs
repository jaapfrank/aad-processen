import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { chromium } from 'playwright'
const step = (id, rest = {}) => ({ id, nummer: id, type: 'actie', laneId: 'owner', activiteit: id, ...rest })
const processes = ['Medewerker onboarding', 'Machineonderhoud'].map((name, index) => ({
  id: `generiek-${index}`, hoofdproces: index ? 'Techniek' : 'Personeel', detailproces: name, versie: 'V1.2', status: 'live', laatsteWijziging: '2026-09-08', lanes: [{ id: 'owner', naam: 'Proceseigenaar', kleur: '#2563eb' }], secties: [],
  stappen: [step('Start', { type: 'start', naarStap: 'Controlekeuze' }), step('Controlekeuze', { type: 'beslissing', routes: [{ id: 'intern', label: 'Intern uitvoeren', naarStap: 'Interne controle' }, { id: 'extern', label: 'Uitbesteden', naarStap: 'Externe controle' }] }), step('Interne controle', { naarStap: 'Afronding', checklist: ['Instructie gecontroleerd'] }), step('Externe controle', { naarStap: 'Afronding' }), step('Afronding', { type: 'eind' })],
}))
const summaries = processes.map((p) => ({ ...p, aantalStappen: p.stappen.length, koppelingen: [] }))
const server = await createServer({ server: { host: '127.0.0.1', port: 4187, strictPort: true, open: false } })
let browser
try {
  await server.listen()
  browser = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []; page.on('pageerror', (error) => errors.push(error.message))
  let fail = true, empty = false
  await page.route('**/api/**', async (route) => {
    const request = route.request(); assert.equal(request.method(), 'GET', 'Geen organisatiegegevens schrijven')
    const path = new URL(request.url()).pathname; let body, status = 200
    if (path === '/api/config') body = { authMode: 'local', storage: 'local', online: false, versie: 'test' }
    else if (path === '/api/me') body = { user: { id: 'synthetisch', naam: 'Demo medewerker', bron: 'local', rollen: ['kijken'], groepen: [] } }
    else if (path === '/api/processes') { status = fail ? 503 : 200; body = fail ? { message: 'Tijdelijk niet bereikbaar' } : empty ? [] : summaries }
    else if (path.startsWith('/api/processes/')) body = processes.find((p) => p.id === path.split('/').at(-1))
    else { status = 404; body = { message: 'Niet beschikbaar in deze test' } }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  })
  await page.addInitScript(() => localStorage.setItem('spg-recent', '{kapotte-json'))
  const button = (name) => page.getByRole('button', { name, exact: true })
  const heading = (name) => page.getByRole('heading', { name, exact: true }).waitFor()
  await page.goto('http://127.0.0.1:4187/begeleid'); await page.getByRole('alert').getByText('Tijdelijk niet bereikbaar').waitFor()
  fail = false; await button('Opnieuw proberen').click(); await page.getByRole('button', { name: /Medewerker onboarding/ }).click()
  await button('Stap uitgevoerd — verder').click(); await heading('Controlekeuze')
  const shots = fileURLToPath(new URL('../.shots/', import.meta.url)); await mkdir(shots, { recursive: true }); await page.screenshot({ path: `${shots}/begeleid-generieke-keuzes.png`, fullPage: true })
  await button('Uitbesteden').click(); await heading('Externe controle'); assert.equal(await page.getByRole('heading', { name: 'Interne controle', exact: true }).count(), 0)
  await button('Vorige bevestiging terugnemen').click(); await button('Intern uitvoeren').click(); await heading('Interne controle')
  assert.equal(await button('Stap uitgevoerd — verder').isDisabled(), true); await page.getByLabel('Instructie gecontroleerd').check(); await button('Stap uitgevoerd — verder').click(); await button('Bevestig het einde van deze route').click(); await heading('Gekozen route afgerond')
  const note = await page.getByLabel('Routenotitie', { exact: true }).inputValue(); assert.match(note, /Intern uitvoeren/); assert.doesNotMatch(note, /Externe controle|Uitbesteden/); assert.match(note, /geen formeel uitvoerings- of auditbewijs/)
  await button('Een andere route starten').click(); await page.getByLabel('Oefenmodus', { exact: true }).check(); await page.getByRole('button', { name: /Machineonderhoud/ }).click()
  await button('Stap geoefend — verder').click(); await button('Uitbesteden').click(); await button('Stap geoefend — verder').click(); await button('Bevestig het einde van deze route').click(); await heading('Oefenroute afgerond'); assert.match(await page.getByLabel('Routenotitie', { exact: true }).inputValue(), /OEFENING/)
  await button('Een andere route starten').click(); empty = true; await button('Vernieuw processen').click(); await heading('Nog geen gepubliceerde processen')
  empty = false; await page.goto('http://127.0.0.1:4187/'); await heading('Medewerker onboarding')
  fail = true; await page.reload(); await page.getByRole('alert').getByText('Tijdelijk niet bereikbaar').waitFor(); fail = false; await button('Opnieuw proberen').click(); await heading('Machineonderhoud')
  assert.deepEqual(errors, []); console.log('UI smoke geslaagd: twee generieke domeinen, juiste tak, terugnemen, checklist, oefenlabel, fout/herproberen/leeg, corrupt localStorage, geen writes of browserexceptions.')
} finally { await browser?.close(); await server.close() }
