import type { Lane, Process, Section, Step, StepType } from '../contract'

// Zet een AI-gegenereerd procesvoorstel om naar ons contract. De AI levert
// soms het volledige procesgids-formaat, maar vaak een vereenvoudigde vorm:
// lanes als strings, stappen genest in secties, en veldnamen als
// stap/lane/actie/indien/procesverwijzing. Beide vormen worden geaccepteerd;
// het resultaat is altijd een geldig concept-Process voor de bouwer.

const PALET = ['#F59E0B', '#3B82F6', '#10B981', '#8B5CF6', '#EF4444', '#14B8A6', '#F97316', '#6366F1']

function slug(tekst: string): string {
  return tekst
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60)
}

type Ruw = Record<string, unknown>

function tekst(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

/** Haalt het eerste JSON-object met een procesvorm uit een AI-antwoord. */
export function vindProcesJson(antwoord: string): Ruw | null {
  const kandidaten: string[] = []
  const fence = /```(?:json)?\s*([\s\S]*?)```/g
  for (let m = fence.exec(antwoord); m; m = fence.exec(antwoord)) kandidaten.push(m[1])
  const start = antwoord.indexOf('{')
  if (start >= 0) kandidaten.push(antwoord.slice(start))

  for (const kandidaat of kandidaten) {
    // Zoek een gebalanceerd object vanaf de eerste accolade.
    const begin = kandidaat.indexOf('{')
    if (begin < 0) continue
    let diepte = 0
    for (let i = begin; i < kandidaat.length; i++) {
      if (kandidaat[i] === '{') diepte++
      else if (kandidaat[i] === '}' && --diepte === 0) {
        try {
          const obj = JSON.parse(kandidaat.slice(begin, i + 1)) as Ruw
          if ((obj.detailproces || obj.id) && (obj.secties || obj.stappen)) return obj
        } catch {
          // geen geldige JSON; probeer de volgende kandidaat
        }
        break
      }
    }
  }
  return null
}

/** Normaliseert een (vereenvoudigd of volledig) voorstel naar een concept-Process. */
export function normaliseerVoorstel(ruw: Ruw): Process {
  const naam = tekst(ruw.detailproces) ?? tekst(ruw.naam) ?? 'AI-voorstel'
  const id = tekst(ruw.id) ? slug(tekst(ruw.id)!) : slug(naam)

  // Lanes: strings of objecten.
  const ruweLanes = Array.isArray(ruw.lanes) ? ruw.lanes : []
  const lanes: Lane[] = ruweLanes.map((l, i) => {
    if (typeof l === 'string') return { id: slug(l) || `rol-${i + 1}`, naam: l, kleur: PALET[i % PALET.length] }
    const o = l as Ruw
    const lnaam = tekst(o.naam) ?? tekst(o.id) ?? `Rol ${i + 1}`
    return { id: tekst(o.id) ? slug(tekst(o.id)!) : slug(lnaam), naam: lnaam, kleur: tekst(o.kleur) ?? PALET[i % PALET.length] }
  })
  const laneIdVoor = (ref: unknown): string => {
    const r = tekst(ref)
    if (!r) return lanes[0]?.id ?? 'rol-1'
    const bySlug = lanes.find((l) => l.id === slug(r) || l.naam.toLowerCase() === r.toLowerCase())
    return bySlug?.id ?? lanes[0]?.id ?? 'rol-1'
  }

  // Secties + stappen: genest of plat.
  const secties: Section[] = []
  const stappen: Step[] = []
  const voegStapToe = (s: Ruw, sectieId: string | undefined, index: number) => {
    const nummer = tekst(s.nummer) ?? tekst(s.stap) ?? String(index + 1)
    const activiteit = tekst(s.activiteit) ?? tekst(s.actie) ?? '(onbekende activiteit)'
    const naarProces = tekst(s.naarProces) ?? tekst(s.procesverwijzing)
    let type = tekst(s.type) as StepType | undefined
    if (!type) {
      if (/^e$/i.test(nummer) || /^einde/i.test(activiteit)) type = 'eind'
      else if (naarProces || /^start proces/i.test(activiteit)) type = 'subproces'
      else type = 'actie'
    }
    stappen.push({
      id: `${id}-s${stappen.length + 1}`,
      nummer,
      sectieId,
      laneId: laneIdVoor(s.laneId ?? s.lane),
      type,
      activiteit,
      voorwaarde: tekst(s.voorwaarde) ?? tekst(s.indien),
      toelichting: tekst(s.toelichting),
      erpStatus: tekst(s.erpStatus),
      naarProces: naarProces ? slug(naarProces) : undefined,
    })
  }

  if (Array.isArray(ruw.secties) && ruw.secties.length > 0 && (ruw.secties[0] as Ruw)?.stappen) {
    for (const sec of ruw.secties as Ruw[]) {
      const snaam = tekst(sec.naam) ?? `Deel ${secties.length + 1}`
      const sid = tekst(sec.id) ? slug(tekst(sec.id)!) : slug(snaam)
      secties.push({ id: sid, naam: snaam })
      for (const [i, s] of ((sec.stappen as Ruw[]) ?? []).entries()) voegStapToe(s, sid, i)
    }
  } else {
    for (const sec of (Array.isArray(ruw.secties) ? (ruw.secties as Ruw[]) : [])) {
      const snaam = tekst(sec.naam) ?? `Deel ${secties.length + 1}`
      secties.push({ id: tekst(sec.id) ? slug(tekst(sec.id)!) : slug(snaam), naam: snaam })
    }
    for (const [i, s] of (Array.isArray(ruw.stappen) ? (ruw.stappen as Ruw[]) : []).entries()) {
      voegStapToe(s, tekst(s.sectieId), i)
    }
  }

  // Keten: elke stap wijst naar de volgende (reviewer kan het aanpassen).
  for (let i = 0; i < stappen.length - 1; i++) {
    if (stappen[i].type !== 'eind' && !stappen[i].naarStap) {
      stappen[i].naarStap = stappen[i + 1].id
    }
  }

  if (lanes.length === 0 || stappen.length === 0) {
    throw new Error('Het voorstel bevat geen herkenbare rollen of stappen.')
  }

  return {
    id,
    hoofdproces: tekst(ruw.hoofdproces) ?? 'Service',
    detailproces: naam,
    versie: 'V0.1',
    status: 'concept',
    laatsteWijziging: new Date().toISOString().slice(0, 10),
    bron: { type: 'handmatig' },
    lanes,
    secties,
    stappen,
  }
}
