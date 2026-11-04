import assert from 'node:assert/strict'
import type { Process, Step } from '../src/contract.ts'
import { begeleidePositie, begeleideStartpunten, begeleideStapProbleem, leesRecenteProcesIds, type RouteBevestiging } from '../src/lib/begeleideRoute.ts'

const stap = (id: string, rest: Partial<Step> = {}): Step => ({ id, nummer: id, type: 'actie', laneId: 'owner', activiteit: id, ...rest })
function voorbeeld(id: string): Process {
  return {
    id, hoofdproces: id === 'onboarding' ? 'Personeel' : 'Onderhoud', detailproces: id,
    versie: 'V1', status: 'live', laatsteWijziging: '2026-09-08', lanes: [{ id: 'owner', naam: 'Eigenaar', kleur: '#123456' }], secties: [],
    stappen: [
      stap('start', { type: 'start', naarStap: 'keuze' }),
      stap('keuze', { type: 'beslissing', routes: [
        { id: 'a', label: 'Intern uitvoeren', naarStap: 'intern' },
        { id: 'b', label: 'Uitbesteden', naarStap: 'extern' },
      ] }),
      stap('intern', { naarStap: 'eind' }),
      stap('extern', { naarStap: 'eind' }),
      stap('eind', { type: 'eind' }),
      stap('los', { naarStap: 'ander-eind' }),
      stap('ander-eind', { type: 'eind' }),
    ],
  }
}

// Twee verschillende domeinen gebruiken hetzelfde model; niet-gekozen en losse takken blijven buiten de route.
for (const id of ['onboarding', 'machineonderhoud']) {
  const proces = voorbeeld(id)
  assert.deepEqual(begeleideStartpunten(proces).map((s) => s.id), ['start'])
  const historie: RouteBevestiging[] = [{ stapId: 'start' }, { stapId: 'keuze', routeId: 'b' }]
  const positie = begeleidePositie(proces, 'start', historie)
  assert.equal(positie.soort === 'stap' && positie.stap.id, 'extern')
  assert.equal(begeleidePositie(proces, 'start', [...historie, { stapId: 'intern' }]).soort, 'geblokkeerd')
  assert.deepEqual(begeleidePositie(proces, 'start', [...historie, { stapId: 'extern' }, { stapId: 'eind' }]), { soort: 'klaar' })
  assert.equal(begeleidePositie(proces, 'start', [{ stapId: 'start' }, { stapId: 'keuze' }]).soort, 'geblokkeerd')
  assert.equal(begeleidePositie(proces, 'start', [{ stapId: 'start' }, { stapId: 'keuze', routeId: 'onbekend' }]).soort, 'geblokkeerd')
}

const proces = voorbeeld('onboarding')
proces.stappen[1].routes![1] = { id: 'b', label: 'Overdragen', naarProces: 'leveranciersbeheer', standaard: true }
assert.deepEqual(begeleidePositie(proces, 'start', [{ stapId: 'start' }, { stapId: 'keuze', routeId: 'b' }]), { soort: 'overdracht', procesId: 'leveranciersbeheer' })
assert.equal(begeleidePositie(proces, 'start', [{ stapId: 'start' }, { stapId: 'keuze' }]).soort, 'geblokkeerd', 'Ook een standaardroute wordt niet stilzwijgend gekozen')

for (const routes of [
  [{ id: 'a', label: 'A', naarStap: 'weg' }, { id: 'b', label: 'B', naarStap: 'eind' }],
  [{ id: 'a', label: 'A', naarStap: 'intern', naarProces: 'elders' }, { id: 'b', label: 'B', naarStap: 'eind' }],
  [{ id: 'a', label: 'A', naarStap: 'intern' }, { id: 'a', label: 'B', naarStap: 'eind' }],
  [{ id: 'a', label: 'A', naarStap: 'intern' }, { id: 'b', label: 'A', naarStap: 'eind' }],
]) {
  const fout = voorbeeld('ongeldig')
  fout.stappen[1].routes = routes
  assert.ok(begeleideStapProbleem(fout, fout.stappen[1]))
  assert.equal(begeleidePositie(fout, 'start', [{ stapId: 'start' }, { stapId: 'keuze', routeId: 'a' }]).soort, 'geblokkeerd')
}

const lus = voorbeeld('hercontrole')
lus.stappen[2].naarStap = 'keuze'
const lusHistorie: RouteBevestiging[] = [{ stapId: 'start' }, { stapId: 'keuze', routeId: 'a' }, { stapId: 'intern' }]
const opnieuw = begeleidePositie(lus, 'start', lusHistorie)
assert.equal(opnieuw.soort === 'stap' && opnieuw.stap.id, 'keuze', 'Herhaalde controle vraagt opnieuw een menselijke keuze')
assert.equal(begeleidePositie(lus, 'start', [...lusHistorie, { stapId: 'keuze', routeId: 'b' }, { stapId: 'extern' }, { stapId: 'eind' }]).soort, 'klaar')

const conditioneel = voorbeeld('voorwaarde')
conditioneel.stappen[2].voorwaarde = 'Extra controle nodig'
const overgeslagen = [{ stapId: 'start' }, { stapId: 'keuze', routeId: 'a' }, { stapId: 'intern', overgeslagen: true }]
const naOverslaan = begeleidePositie(conditioneel, 'start', overgeslagen)
assert.equal(naOverslaan.soort === 'stap' && naOverslaan.stap.id, 'eind')
assert.equal(begeleidePositie(conditioneel, 'start', [{ stapId: 'start', overgeslagen: true }]).soort, 'geblokkeerd')
assert.equal(begeleidePositie(conditioneel, 'start', overgeslagen.slice(0, -1)).soort, 'stap', 'Terugnemen herleidt de positie zonder oude keuzes te behouden')

const gebroken = voorbeeld('ontbrekend-einde')
delete gebroken.stappen[2].naarStap
assert.ok(begeleideStapProbleem(gebroken, gebroken.stappen[2]))
gebroken.stappen.push({ ...gebroken.stappen[0] })
assert.equal(begeleidePositie(gebroken, 'start', []).soort, 'geblokkeerd')
const zonderStart = voorbeeld('losse-routes')
zonderStart.stappen = [stap('a', { naarStap: 'z' }), stap('b', { naarStap: 'z' }), stap('z', { type: 'eind' })]
assert.deepEqual(begeleideStartpunten(zonderStart).map((s) => s.id), ['a', 'b'])
assert.equal(begeleidePositie(zonderStart, 'a', [{ stapId: 'a' }, { stapId: 'z' }]).soort, 'klaar')
zonderStart.stappen = [stap('a', { naarStap: 'b' }), stap('b', { naarStap: 'a' })]
assert.deepEqual(begeleideStartpunten(zonderStart), [], 'Een cyclus zonder startpunt wordt niet willekeurig gestart')
assert.deepEqual(begeleideStartpunten({ ...zonderStart, stappen: [] }), [])

assert.deepEqual(leesRecenteProcesIds(() => '{kapot'), [])
assert.deepEqual(leesRecenteProcesIds(() => '{"a":1}'), [])
assert.deepEqual(leesRecenteProcesIds(() => '["a",12,"a",null,"b",""]'), ['a', 'b'])
assert.deepEqual(leesRecenteProcesIds(() => { throw new Error('Opslag geblokkeerd') }), [])
assert.deepEqual(leesRecenteProcesIds(() => null), [])
console.log('Begeleide routes geslaagd: 2 domeinen, expliciete keuzes, gescheiden takken, overdracht, herstel, lussen, foutmodellen en veilige recenthistorie.')
