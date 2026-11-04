import assert from 'node:assert/strict'
import { buildAiIntakePrompt, parseAiIntakeResponse } from '../src/lib/aiIntake.ts'

const bron = 'Wijzigingsbeheer. De eigenaar beoordeelt ieder verzoek. Bij akkoord voert de beheerder de wijziging uit.'
const intake = parseAiIntakeResponse(JSON.stringify({
  procesNaam: { tekst: 'Wijzigingsbeheer' },
  rollen: { tekst: 'De eigenaar beoordeelt ieder verzoek.' },
  starttrigger: { tekst: 'Iedere maandag om 9 uur' },
  eindresultaat: { tekst: 'Bij akkoord voert de beheerder de wijziging uit.' },
}), bron)
assert.equal(intake.procesNaam, 'Wijzigingsbeheer')
assert.equal(intake.rollen, 'De eigenaar beoordeelt ieder verzoek.')
assert.equal(intake.starttrigger, '', 'Een verzonnen starttrigger mag niet worden vooringevuld.')
assert.equal(intake.beslissingen, '', 'Onbekende beslisroutes blijven leeg.')
assert.equal(intake.eindresultaat, 'Bij akkoord voert de beheerder de wijziging uit.')
assert.deepEqual(parseAiIntakeResponse('{}', bron), { procesNaam: '', doel: '', rollen: '', starttrigger: '', eindresultaat: '', beslissingen: '' })
assert.equal(parseAiIntakeResponse('```json\n{"procesNaam":{"tekst":"Wijzigingsbeheer"}}\n```', bron).procesNaam, 'Wijzigingsbeheer')
assert.throws(() => parseAiIntakeResponse('[]', bron))
assert.throws(() => parseAiIntakeResponse('geen JSON', bron))
assert.equal(parseAiIntakeResponse('{"rollen":{"tekst":123}}', bron).rollen, '')
assert.equal(parseAiIntakeResponse('{"rollen":{"tekst":"de eigenaar beoordeelt ieder verzoek."}}', bron).rollen, '', 'Alleen letterlijke broninhoud wordt overgenomen.')
assert.ok(buildAiIntakePrompt(bron).includes(bron))
console.log('AI-intake: brongebonden extractie, ontbrekende informatie, verkeerde output en JSON-afhandeling geslaagd.')
