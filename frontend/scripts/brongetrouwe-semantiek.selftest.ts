import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { Process, Step } from '../src/contract.ts'
import {
  bepaalBrongetrouweStapSemantiek,
  controleerBrongetrouweSemantiek,
} from '../src/visualisaties/brongetrouweSemantiek.ts'

const fixtureUrl = new URL('../../contract/fixtures/service-aanvraagproces.json', import.meta.url)
const proces = JSON.parse(readFileSync(fixtureUrl, 'utf8')) as Process

const stap = (id: string): Step => {
  const resultaat = proces.stappen.find((item) => item.id === id)
  assert.ok(resultaat, `Fixture bevat stap ${id}`)
  return resultaat
}

const controle = controleerBrongetrouweSemantiek(proces)
assert.equal(controle.geldig, true, controle.fouten.join('\n'))
assert.deepEqual(controle.waarschuwingen, [])

const w1 = bepaalBrongetrouweStapSemantiek(stap('w1'))
assert.deepEqual(w1.hoofdinteractie, {
  bronLaneId: 'klant',
  doelLaneId: 'website',
  soort: 'activiteit',
  metPijl: false,
})
assert.deepEqual(
  w1.gebeurtenissenNa.map(({ type, laneId, doelLaneId, activiteit }) => ({
    type,
    laneId,
    doelLaneId,
    activiteit,
  })),
  [
    {
      type: 'actie',
      laneId: 'website',
      doelLaneId: undefined,
      activiteit: 'Maakt RMA nummer aan',
    },
    {
      type: 'synchronisatie',
      laneId: 'website',
      doelLaneId: 'erp',
      activiteit: 'Synchroniseert RMA gegevens',
    },
    {
      type: 'status',
      laneId: 'erp',
      doelLaneId: undefined,
      activiteit: 'RMA status ‘controle’',
    },
  ],
)
assert.deepEqual(
  w1.annotaties.map(({ soort, tekst }) => ({ soort, tekst })),
  [
    {
      soort: 'instructie',
      tekst:
        'Volgens instructie op website\nKiest retourreden (WKOA), verkeerd geleverd, defect, verkeerd besteld, staat van product, gewenste afhandeling. Selecteert serienummer.',
    },
  ],
  'de ERP-status blijft een statusgebeurtenis en wordt niet bij de blauwe instructie gevoegd',
)

assert.deepEqual(bepaalBrongetrouweStapSemantiek(stap('w2')).hoofdinteractie, {
  bronLaneId: 'website',
  doelLaneId: 'klant',
  soort: 'bericht',
  metPijl: true,
})

const w3 = bepaalBrongetrouweStapSemantiek(stap('w3'))
assert.equal(w3.hoofdinteractie?.doelLaneId, 'erp')
assert.deepEqual(
  w3.gebeurtenissenNa.map((gebeurtenis) => gebeurtenis.activiteit),
  ['RMA status ‘invoer compleet’', 'Synchroniseert RMA gegevens'],
)
assert.equal(w3.annotaties.length, 0)

assert.equal(
  bepaalBrongetrouweStapSemantiek(stap('w5')).hoofdinteractie?.doelLaneId,
  'magazijn',
)
assert.equal(stap('wE').laneId, 'magazijn')
assert.equal(
  bepaalBrongetrouweStapSemantiek(stap('i1')).hoofdinteractie?.doelLaneId,
  'service',
)
assert.equal(
  bepaalBrongetrouweStapSemantiek(stap('i2')).hoofdinteractie?.doelLaneId,
  'klant',
)
assert.deepEqual(
  bepaalBrongetrouweStapSemantiek(stap('i4')).gebeurtenissenNa.map(
    (gebeurtenis) => gebeurtenis.activiteit,
  ),
  ['Status ‘nieuw’'],
)
assert.deepEqual(
  bepaalBrongetrouweStapSemantiek(stap('i5')).gebeurtenissenNa.map(
    (gebeurtenis) => gebeurtenis.activiteit,
  ),
  ['RMA status ‘controle’'],
)
assert.deepEqual(
  bepaalBrongetrouweStapSemantiek(stap('i7')).gebeurtenissenNa.map(
    (gebeurtenis) => gebeurtenis.activiteit,
  ),
  ['RMA status ‘invoer compleet’', 'Synchroniseert RMA gegevens'],
)
assert.equal(
  bepaalBrongetrouweStapSemantiek(stap('i9')).hoofdinteractie?.doelLaneId,
  'magazijn',
)
assert.equal(stap('iE').laneId, 'magazijn')

const legacyStep: Step = {
  id: 'legacy',
  nummer: '1',
  laneId: 'a',
  type: 'actie',
  activiteit: 'Oude stap',
  toelichting: 'Losse instructie',
  zijnotitie: 'Losse zij-notitie',
  waarschuwing: 'Losse waarschuwing',
}
assert.deepEqual(
  bepaalBrongetrouweStapSemantiek(legacyStep).annotaties.map((item) => item.soort),
  ['instructie', 'zij-notitie', 'waarschuwing'],
  'oude vrije velden blijven afzonderlijk beschikbaar',
)

const ongeldig: Process = {
  ...proces,
  stappen: [
    {
      ...stap('w1'),
      interactieDoelLaneId: 'ontbrekend',
      systeemGebeurtenissen: [
        {
          id: 'dubbel',
          type: 'synchronisatie',
          laneId: 'website',
          activiteit: '',
        },
        {
          id: 'dubbel',
          type: 'status',
          laneId: 'ontbrekend',
          doelLaneId: 'erp',
          activiteit: 'Status',
        },
      ],
    },
  ],
}
const ongeldigeControle = controleerBrongetrouweSemantiek(ongeldig)
assert.equal(ongeldigeControle.geldig, false)
assert.ok(
  ongeldigeControle.fouten.some((fout) => fout.includes('onbekende interactie-lane')),
)
assert.ok(ongeldigeControle.fouten.some((fout) => fout.includes('geen unieke id')))
assert.ok(ongeldigeControle.fouten.some((fout) => fout.includes('vereist een doel-lane')))
assert.ok(ongeldigeControle.fouten.some((fout) => fout.includes('geen activiteit/callout')))

console.log('Brongetrouwe semantiek selftest: OK')
