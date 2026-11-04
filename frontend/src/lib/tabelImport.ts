import type { Process, Step, StepType } from '../contract'

export const tabelVelden = [
  ['id', 'Stapnummer / ID'], ['activiteit', 'Activiteit'], ['rol', 'Verantwoordelijke rol'],
  ['type', 'Staptype'], ['toelichting', 'Toelichting'], ['volgende', 'Volgende stap'],
  ['ja', 'Volgende stap bij ja'], ['nee', 'Volgende stap bij nee'], ['termijn', 'Termijn'],
] as const
export type TabelVeld = typeof tabelVelden[number][0]
export type KolomMapping = Record<TabelVeld, number>
export interface TabelBron { kolommen: string[]; rijen: string[][]; scheiding: string }
export interface TabelImportResultaat { proces: Process; fouten: string[]; waarschuwingen: string[] }

const MAX_RIJEN = 2000
const kleuren = ['#2563eb', '#7c3aed', '#0891b2', '#d97706', '#059669', '#db2777']
const normaliseer = (waarde: string) => waarde.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '')

/** Quoted velden behouden zowel scheidingstekens als regeleinden. */
function leesRijen(tekst: string, scheiding: string): string[][] {
  const rijen: string[][] = []
  let rij: string[] = [], veld = '', geciteerd = false, gesloten = false
  const sluitVeld = () => { rij.push(veld.trim()); veld = ''; gesloten = false }
  const sluitRij = () => {
    sluitVeld()
    if (rij.some(Boolean)) rijen.push(rij)
    rij = []
    if (rijen.length > MAX_RIJEN + 1) throw new Error(`Importeer maximaal ${MAX_RIJEN} stappen tegelijk.`)
  }
  for (let i = 0; i < tekst.length; i++) {
    const teken = tekst[i]
    if (geciteerd) {
      if (teken === '"' && tekst[i + 1] === '"') { veld += '"'; i++ }
      else if (teken === '"') { geciteerd = false; gesloten = true }
      else veld += teken
    } else if (teken === scheiding) sluitVeld()
    else if (teken === '\n' || teken === '\r') {
      if (teken === '\r' && tekst[i + 1] === '\n') i++
      sluitRij()
    } else if (teken === '"' && !veld.trim() && !gesloten) geciteerd = true
    else if (gesloten && teken.trim()) throw new Error('Er staat tekst achter een afgesloten CSV-veld. Controleer de aanhalingstekens.')
    else veld += teken
  }
  if (geciteerd) throw new Error('Een aangehaald CSV-veld is niet afgesloten. Controleer de aanhalingstekens.')
  if (veld || rij.length) sluitRij()
  return rijen
}

export function leesTabel(tekst: string, scheiding?: string): TabelBron {
  let inhoud = tekst.replace(/^\uFEFF/, '')
  const excelScheiding = inhoud.match(/^sep=([;,\t])\r?\n/i)
  if (excelScheiding) { inhoud = inhoud.slice(excelScheiding[0].length); scheiding ??= excelScheiding[1] }
  let kandidaten = scheiding ? [scheiding] : [';', ',', '\t']
  if (!scheiding) {
    // Een beschadigde gegevensrij mag niet via een andere delimiter als een enkele kolom worden gelezen.
    let geciteerd = false, einde = inhoud.length
    for (let i = 0; i < inhoud.length; i++) {
      if (inhoud[i] === '"') {
        if (geciteerd && inhoud[i + 1] === '"') i++
        else geciteerd = !geciteerd
      } else if (!geciteerd && (inhoud[i] === '\n' || inhoud[i] === '\r')) { einde = i; break }
    }
    const kopregel = inhoud.slice(0, einde)
    const meerkoloms = kandidaten.filter((kandidaat) => {
      try { return (leesRijen(kopregel, kandidaat)[0]?.length ?? 0) > 1 }
      catch { return false }
    })
    if (meerkoloms.length) kandidaten = meerkoloms
  }
  let beste: { rijen: string[][]; scheiding: string; score: number } | undefined
  let laatsteFout: unknown
  for (const kandidaat of kandidaten) {
    try {
      const rijen = leesRijen(inhoud, kandidaat)
      const breedte = rijen[0]?.length ?? 0
      const score = breedte > 1 ? rijen.slice(0, 20).filter((r) => r.length === breedte).length * 100 + breedte : 0
      if (!beste || score > beste.score) beste = { rijen, scheiding: kandidaat, score }
    } catch (fout) { laatsteFout = fout }
  }
  if (!beste) throw laatsteFout instanceof Error ? laatsteFout : new Error('De tabel kon niet worden gelezen.')
  const [kop, ...rijen] = beste.rijen
  if (!kop?.length || !rijen.length) throw new Error('Het bestand moet een kopregel en minimaal één gegevensrij bevatten.')
  if (rijen.some((rij) => rij.length !== kop.length)) throw new Error('Niet alle rijen hebben evenveel kolommen. Kies het juiste scheidingsteken of controleer de export.')
  return { kolommen: kop.map((waarde, index) => waarde || `Kolom ${index + 1}`), rijen, scheiding: beste.scheiding }
}

export function herkenKolommen(kolommen: string[]): KolomMapping {
  const namen: Record<TabelVeld, string[]> = {
    id: ['id', 'stap', 'stapnummer', 'nummer', 'stepid', 'step'],
    activiteit: ['activiteit', 'actie', 'instructie', 'activity', 'task', 'name', 'titel', 'naam'],
    rol: ['rol', 'verantwoordelijke', 'verantwoordelijkerol', 'eigenaar', 'role', 'owner', 'afdeling'],
    type: ['type', 'staptype', 'steptype'], toelichting: ['toelichting', 'omschrijving', 'description', 'opmerking'],
    volgende: ['volgende', 'volgendestap', 'next', 'nextstep', 'naarstap'],
    ja: ['ja', 'yes', 'volgendestapbijja', 'naarstapbijja'],
    nee: ['nee', 'no', 'volgendestapbijnee', 'naarstapbijnee'], termijn: ['termijn', 'deadline', 'doorlooptijd'],
  }
  return Object.fromEntries(tabelVelden.map(([veld]) => [veld, kolommen.findIndex((naam) => namen[veld].includes(normaliseer(naam)))])) as KolomMapping
}

export function maakTabelProces(bron: TabelBron, mapping: KolomMapping, opties: {
  naam: string; hoofdproces: string; standaardRol: string; verbindRijen: boolean; bestand: string
}): TabelImportResultaat {
  const fouten: string[] = [], waarschuwingen: string[] = []
  const cel = (rij: string[], veld: TabelVeld) => (rij[mapping[veld]] ?? '').trim()
  if (!opties.naam.trim()) fouten.push('Geef het proces een naam.')
  if (mapping.activiteit < 0) fouten.push('Koppel een kolom aan Activiteit.')
  if (mapping.rol < 0 && !opties.standaardRol.trim()) fouten.push('Koppel de verantwoordelijke rol of vul een gemeenschappelijke rol in.')
  const heeftVerwijzingen = mapping.volgende >= 0 || mapping.ja >= 0 || mapping.nee >= 0
  if (heeftVerwijzingen && mapping.id < 0) fouten.push('Koppel het stapnummer / ID zodat vervolgverwijzingen kunnen worden gecontroleerd.')
  const opVolgorde = opties.verbindRijen && !heeftVerwijzingen
  const referenties = new Map<string, string>()
  bron.rijen.forEach((rij, i) => {
    const id = mapping.id < 0 ? String(i + 1) : cel(rij, 'id')
    if (!id) fouten.push(`Rij ${i + 2}: het stap-ID ontbreekt.`)
    else if (referenties.has(id)) fouten.push(`Rij ${i + 2}: stap-ID “${id}” komt meer dan één keer voor.`)
    else referenties.set(id, `stap-${i + 1}`)
  })
  const rollen = [...new Set(bron.rijen.map((rij) => cel(rij, 'rol') || opties.standaardRol.trim()).filter(Boolean))]
  const lanes = rollen.map((naam, i) => ({ id: `rol-${i + 1}`, naam, kleur: kleuren[i % kleuren.length] }))
  const typen: Record<string, StepType> = {
    actie: 'actie', activiteit: 'actie', activity: 'actie', task: 'actie', start: 'start', begin: 'start', end: 'eind', einde: 'eind', eind: 'eind',
    beslissing: 'beslissing', decision: 'beslissing', bericht: 'bericht', message: 'bericht', subproces: 'subproces', marker: 'marker',
  }
  const stappen: Step[] = bron.rijen.map((rij, i) => {
    const rijNummer = i + 2, activiteit = cel(rij, 'activiteit'), rol = cel(rij, 'rol') || opties.standaardRol.trim()
    if (!activiteit) fouten.push(`Rij ${rijNummer}: de activiteit ontbreekt.`)
    if (!rol) fouten.push(`Rij ${rijNummer}: de verantwoordelijke rol ontbreekt.`)
    const typeTekst = normaliseer(cel(rij, 'type'))
    if (typeTekst && !typen[typeTekst]) fouten.push(`Rij ${rijNummer}: onbekend staptype “${cel(rij, 'type')}”.`)
    const target = (veld: TabelVeld) => {
      const waarde = cel(rij, veld)
      if (!waarde) return undefined
      const doel = referenties.get(waarde)
      if (!doel) fouten.push(`Rij ${rijNummer}: ${veld} verwijst naar onbekende stap “${waarde}”.`)
      return doel
    }
    const routes = (['ja', 'nee'] as const).filter((veld) => cel(rij, veld)).map((veld) => ({
      id: `stap-${i + 1}-${veld}`, label: veld === 'ja' ? 'Ja' : 'Nee', naarStap: target(veld),
    }))
    const type: StepType = typen[typeTekst] ?? (routes.length ? 'beslissing' : 'actie')
    if (type === 'beslissing' && routes.length < 2) waarschuwingen.push(`Stap ${i + 1}: werk de beslisroutes verder uit in de editor.`)
    if (routes.length && cel(rij, 'volgende')) fouten.push(`Rij ${rijNummer}: gebruik beslisroutes of één volgende stap, niet beide.`)
    if (routes.length && type !== 'beslissing') fouten.push(`Rij ${rijNummer}: ja/nee-routes vereisen het type beslissing.`)
    const volgende = routes.length ? undefined : target('volgende') ?? (opVolgorde && type !== 'eind' ? `stap-${i + 2}` : undefined)
    return {
      id: `stap-${i + 1}`, nummer: cel(rij, 'id') || String(i + 1), sectieId: 'hoofd',
      laneId: lanes.find((lane) => lane.naam === rol)?.id ?? '', type, activiteit,
      ...(cel(rij, 'toelichting') ? { toelichting: cel(rij, 'toelichting') } : {}),
      ...(cel(rij, 'termijn') ? { termijn: cel(rij, 'termijn') } : {}),
      ...(volgende ? { naarStap: volgende } : {}), ...(routes.length ? { routes } : {}),
    }
  })
  if (opVolgorde && stappen.length) {
    if (!stappen.some((stap) => stap.type === 'start')) stappen.unshift({
      id: 'import-start', nummer: 'Start', laneId: stappen[0].laneId, sectieId: 'hoofd', type: 'start', activiteit: `Start ${opties.naam.trim()}`, naarStap: stappen[0].id,
    })
    const laatste = stappen[stappen.length - 1]
    if (laatste.type !== 'eind') {
      laatste.naarStap = 'import-eind'
      stappen.push({ id: 'import-eind', nummer: 'Eind', laneId: laatste.laneId, sectieId: 'hoofd', type: 'eind', activiteit: 'Proces afgerond' })
    }
    waarschuwingen.push('De rijvolgorde bepaalt de route. Controleer de toegevoegde start en afronding en eventuele uitzonderingen in de editor.')
  } else if (!heeftVerwijzingen) waarschuwingen.push('De stappen zijn nog niet verbonden. Verbind ze in de editor voordat je het proces publiceert.')
  if (!stappen.some((stap) => stap.type === 'start')) waarschuwingen.push('Markeer een startstap in de editor.')
  if (!stappen.some((stap) => stap.type === 'eind')) waarschuwingen.push('Markeer de afronding in de editor.')
  const proces: Process = {
    id: '', hoofdproces: opties.hoofdproces.trim() || opties.naam.trim(), detailproces: opties.naam.trim(), versie: 'V0.1', status: 'concept',
    laatsteWijziging: new Date().toISOString().slice(0, 10), bron: { type: 'tabel-import', bestand: opties.bestand, importDatum: new Date().toISOString() },
    lanes, secties: [{ id: 'hoofd', naam: 'Hoofdroute' }], stappen,
  }
  return { proces, fouten: [...new Set(fouten)], waarschuwingen: [...new Set(waarschuwingen)] }
}
