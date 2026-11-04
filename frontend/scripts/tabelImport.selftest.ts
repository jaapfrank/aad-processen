import assert from 'node:assert/strict'
import { leesTabel, herkenKolommen, maakTabelProces } from '../src/lib/tabelImport.ts'

for (const scheiding of [';', ',', '\t']) {
  const bron = leesTabel(`ID${scheiding}Activiteit${scheiding}Rol\r\n1${scheiding}"Controleer${scheiding} en bevestig\nmet een ""notitie"""${scheiding}Eigenaar`)
  assert.equal(bron.scheiding, scheiding)
  assert.equal(bron.rijen[0][1], `Controleer${scheiding} en bevestig\nmet een "notitie"`)
  assert.throws(() => leesTabel(`ID${scheiding}Activiteit\n1${scheiding}"Niet afgesloten`), /niet afgesloten/)
  assert.throws(() => leesTabel(`ID${scheiding}Activiteit\n1${scheiding}"Klaar"onverwacht`), /afgesloten CSV-veld/)
}
assert.equal(leesTabel('\uFEFFsep=;\r\nID;Activiteit\r\n1;Controle').scheiding, ';')
assert.deepEqual(leesTabel('Activiteit\nControleer de machine').rijen, [['Controleer de machine']])
assert.throws(() => leesTabel('ID;Activiteit\n1;Controle;extra'), /evenveel kolommen/)
assert.throws(() => leesTabel('ID;Activiteit'), /minimaal/)
assert.throws(() => leesTabel('Activiteit\n' + Array.from({ length: 2001 }, () => 'Controle').join('\n')), /maximaal/)

const opties = { naam: 'Medewerker onboarding', hoofdproces: 'Personeel', standaardRol: '', verbindRijen: true, bestand: 'onboarding.csv' }
const lineair = leesTabel('ID;Activiteit;Rol;Type\n1;Bereid account voor;IT;activiteit\n2;Bevestig ontvangst;Medewerker;actie')
const resultaat = maakTabelProces(lineair, herkenKolommen(lineair.kolommen), opties)
assert.deepEqual(resultaat.fouten, [])
assert.equal(resultaat.proces.status, 'concept')
assert.equal(resultaat.proces.bron?.type, 'tabel-import')
assert.equal(resultaat.proces.stappen[0].type, 'start')
assert.equal(resultaat.proces.stappen.at(-1)?.type, 'eind')
assert.equal(resultaat.proces.stappen[1].type, 'actie')
assert.equal(resultaat.proces.stappen[1].naarStap, resultaat.proces.stappen[2].id)
assert.equal(resultaat.proces.lanes.length, 2)

const takken = leesTabel('ID;Activiteit;Rol;Type;Volgende;Ja;Nee\nA;Start;Techniek;start;B;;\nB;Onderhoud nodig?;Techniek;beslissing;;C;D\nC;Onderhoud uitvoeren;Techniek;actie;D;;\nD;Afronden;Techniek;eind;;;')
const vertakt = maakTabelProces(takken, herkenKolommen(takken.kolommen), { ...opties, naam: 'Machineonderhoud', hoofdproces: 'Techniek' })
assert.deepEqual(vertakt.fouten, [])
assert.equal(vertakt.proces.stappen.length, 4)
assert.equal(vertakt.proces.stappen[1].naarStap, undefined)
assert.deepEqual(vertakt.proces.stappen[1].routes?.map((route) => route.naarStap), ['stap-3', 'stap-4'])
const dubbel = leesTabel('ID;Activiteit;Rol;Volgende\n1;Start;IT;2\n1;Vervolg;IT;9')
const ongeldig = maakTabelProces(dubbel, herkenKolommen(dubbel.kolommen), opties)
assert.ok(ongeldig.fouten.some((fout) => fout.includes('meer dan één keer')))
assert.ok(ongeldig.fouten.some((fout) => fout.includes('onbekende stap')))
const onbekendType = leesTabel('Activiteit;Rol;Type\nStart;IT;magisch')
assert.ok(maakTabelProces(onbekendType, herkenKolommen(onbekendType.kolommen), opties).fouten.some((fout) => fout.includes('onbekend staptype')))
console.log('Tabelimport geslaagd: CSV/TSV/BOM/Excel-separator, gequote multiline velden, beschadigde quotes, rijlimiet, 2 domeinen, routebehoud en invoerfouten.')
