import type { Process, Step } from '../contract'

/*
 * De brongetrouwe weergave gebruikt dezelfde bladmaat en verhoudingen als
 * pagina 1 van de aangeleverde procesplaat. De bron-PDF is 595,2 × 963,72 pt.
 * Door in PDF-punten te rekenen en pas aan het eind te schalen blijven
 * kolommen, lettergroottes en lijndiktes onderling in verhouding.
 */
export const BRONGETROUWE_BRON_BREEDTE = 595.2
export const BRONGETROUWE_BRON_HOOGTE = 963.72
export const BRONGETROUWE_PAGINAVERHOUDING =
  BRONGETROUWE_BRON_BREEDTE / BRONGETROUWE_BRON_HOOGTE
export const BRONGETROUWE_MINIMUM_BREEDTE = 1600

const BRON_LANE_START = 84.49
const BRON_LANE_STAP = 85.08
const BRON_LANE_KOP_BREEDTE = 56.69
const BRON_KOP_HOOGTE = 137.32
const BRON_EERSTE_SECTIE_Y = 155.91
const BRON_EERSTE_STAP_AFSTAND = 33.3
const BRON_TWEEDE_SECTIE_Y = 510.51
const BRON_VOLGENDE_SECTIE_EERSTE_STAP_AFSTAND = 37.35
const BRON_VOLGENDE_SECTIE_AFSTAND = 36.35

export interface BrongetrouweLayout {
  /** Linkermarge van het oorspronkelijke PDF-blad, in SVG-eenheden. */
  links: number
  /** Basissprong tussen twee aangrenzende lanes. */
  laneBreedte: number
  /** Werkelijke, mogelijk niet-uniforme x-positie per lane. */
  lanePosities: Map<string, number>
  laneKopBreedte: number
  kopHoogte: number
  annotatieBreedte: number
  annotatieX: number
  systeemNotitieX: number
  schaal: number
  posities: Map<string, { x: number; y: number }>
  secties: Array<{ naam: string; y: number }>
  breedte: number
  hoogte: number
}

export interface BrongetrouweLayoutControle {
  geldig: boolean
  fouten: string[]
  waarschuwingen: string[]
  breedte: number
  hoogte: number
  paginaverhouding: number
}

export function tekstregels(tekst: string, maxTekens: number): string[] {
  const regels: string[] = []
  const explicieteRegels = tekst.trim().split(/\r?\n/)
  for (const explicieteRegel of explicieteRegels) {
    const woorden = explicieteRegel.trim().split(/\s+/).filter(Boolean)
    if (woorden.length === 0) {
      regels.push('')
      continue
    }
    let regel = ''
    for (const woord of woorden) {
      if (!regel || `${regel} ${woord}`.length <= maxTekens) {
        regel = regel ? `${regel} ${woord}` : woord
      } else {
        regels.push(regel)
        regel = woord
      }
    }
    if (regel) regels.push(regel)
  }
  return regels.length > 0 ? regels : ['']
}

export function stapAnnotatie(stap: Step): string {
  return [stap.toelichting, stap.waarschuwing].filter(Boolean).join(' · ')
}

export function isSysteemLaneNaam(naam: string): boolean {
  return /erp|website|crm|pim|systeem|applicatie|portaal/i.test(naam)
}

/**
 * Visio-platen laten bewust een brede werkruimte tussen de uitvoerende rollen
 * en de systeemkolommen. Dit is dus geen gelijkmatig grid: bij de overgang
 * naar de eerste systeem-lane wordt één lege kolom ingevoegd.
 */
function bepaalLaneSlots(proces: Process): Map<string, number> {
  const slots = new Map<string, number>()
  let slot = 0
  proces.lanes.forEach((lane, index) => {
    if (index > 0) {
      const vorige = proces.lanes[index - 1]
      const overgangNaarSysteem =
        !isSysteemLaneNaam(vorige.naam) && isSysteemLaneNaam(lane.naam)
      slot += overgangNaarSysteem ? 2 : 1
    }
    slots.set(lane.id, slot)
  })
  return slots
}

function heeftSysteemGebeurtenissen(stap: Step): boolean {
  return Boolean(stap.systeemGebeurtenissen?.length)
}

/**
 * Compacte, inhoudsgestuurde rijafstand in PDF-punten. De bronplaat gebruikt
 * handmatig wisselende afstanden: lange toelichtingen krijgen ruimte, terwijl
 * bericht- en subprocesregels dicht bij elkaar mogen staan.
 */
function stapAfstand(stap: Step, volgende?: Step): number {
  if (heeftSysteemGebeurtenissen(stap)) {
    const aantal = stap.systeemGebeurtenissen?.length ?? 0
    if (aantal >= 3) return 71.6
    if (aantal === 2) return 51.5
    return volgende?.systeemGebeurtenissen?.length ? 46 : 35
  }
  if (stap.type === 'bericht') {
    if (volgende?.type === 'subproces') {
      return 36.5
    }
    return 43
  }
  if (stap.type === 'subproces' || stap.type === 'start' || stap.type === 'marker') {
    return 36
  }
  if (stap.type === 'eind') return BRON_VOLGENDE_SECTIE_AFSTAND
  if (stap.voorwaarde || stap.type === 'beslissing') return 38
  if (stap.opmerking) return 35
  /*
   * Blauwe instructies liggen in de bronplaat over de vrije diagramruimte.
   * Ze maken de hoofdflow dus niet automatisch hoger.
   */
  if (stap.toelichting) return 36
  if (stap.erpStatus || stap.zijnotitie) {
    return volgende?.erpStatus || volgende?.zijnotitie ? 46 : 35
  }
  if (volgende?.type === 'eind') return 45
  if (stap.activiteit.length > 52 && (volgende?.erpStatus || volgende?.zijnotitie)) return 29
  return 36
}

export function maakBrongetrouweLayout(proces: Process): BrongetrouweLayout {
  const slots = bepaalLaneSlots(proces)
  const hoogsteSlot = Math.max(5, ...slots.values())
  const bronBreedte = Math.max(
    BRONGETROUWE_BRON_BREEDTE,
    BRONGETROUWE_BRON_BREEDTE +
      Math.max(0, hoogsteSlot - 5) * BRON_LANE_STAP,
  )
  const schaal = BRONGETROUWE_MINIMUM_BREEDTE / BRONGETROUWE_BRON_BREEDTE
  const breedte = bronBreedte * schaal
  const laneBreedte = BRON_LANE_STAP * schaal
  const lanePosities = new Map(
    proces.lanes.map((lane) => [
      lane.id,
      (BRON_LANE_START + (slots.get(lane.id) ?? 0) * BRON_LANE_STAP) * schaal,
    ]),
  )
  const systeemLanes = proces.lanes.filter((lane) => isSysteemLaneNaam(lane.naam))
  const eersteSysteemX = systeemLanes.length > 0
    ? lanePosities.get(systeemLanes[0].id)
    : undefined
  const laatsteLaneX = proces.lanes.length > 0
    ? lanePosities.get(proces.lanes[proces.lanes.length - 1].id) ?? breedte - BRON_LANE_START * schaal
    : breedte - BRON_LANE_START * schaal
  const annotatieX = eersteSysteemX === undefined
    ? Math.min(breedte * 0.58, laatsteLaneX + 10 * schaal)
    : Math.max(BRON_LANE_START * schaal, eersteSysteemX - 249.5 * schaal)
  const systeemNotitieX = Math.min(
    breedte - 25 * schaal,
    laatsteLaneX + 11.5 * schaal,
  )
  const posities = new Map<string, { x: number; y: number }>()
  const secties: Array<{ naam: string; y: number }> = []
  let sectieY = BRON_EERSTE_SECTIE_Y

  proces.secties.forEach((sectie, sectieIndex) => {
    secties.push({ naam: sectie.naam, y: sectieY * schaal })
    const stappen = proces.stappen.filter((item) => item.sectieId === sectie.id)
    let stapY = sectieY + (
      sectieIndex === 0
        ? BRON_EERSTE_STAP_AFSTAND
        : BRON_VOLGENDE_SECTIE_EERSTE_STAP_AFSTAND
    )
    stappen.forEach((stap, index) => {
      posities.set(stap.id, {
        x: lanePosities.get(stap.laneId) ?? BRON_LANE_START * schaal,
        y: stapY * schaal,
      })
      stapY += stapAfstand(stap, stappen[index + 1])
    })
    const laatste = stappen.at(-1)
    sectieY = laatste
      ? (posities.get(laatste.id)?.y ?? stapY * schaal) / schaal + BRON_VOLGENDE_SECTIE_AFSTAND
      : sectieY + 55
    if (sectieIndex === 0 && proces.secties.length > 1) {
      /*
       * De aangeleverde Visio-bron houdt de tweede sectie op een vaste
       * basislijn. Kortere labels erboven mogen die sectie niet omhoog trekken.
       */
      sectieY = Math.max(sectieY, BRON_TWEEDE_SECTIE_Y)
    }
  })

  const losseStappen = proces.stappen.filter((item) => !posities.has(item.id))
  let losY = Math.max(sectieY, BRON_EERSTE_SECTIE_Y + BRON_EERSTE_STAP_AFSTAND)
  losseStappen.forEach((stap, index) => {
    posities.set(stap.id, {
      x: lanePosities.get(stap.laneId) ?? BRON_LANE_START * schaal,
      y: losY * schaal,
    })
    losY += stapAfstand(stap, losseStappen[index + 1])
  })

  const laatsteStapY = Math.max(
    0,
    ...[...posities.values()].map((positie) => positie.y / schaal),
  )
  const inhoudOnderkant = Math.max(
    BRONGETROUWE_BRON_HOOGTE,
    laatsteStapY + 15.5,
    losseStappen.length > 0 ? losY + 15.5 : 0,
  )

  return {
    links: 28.35 * schaal,
    laneBreedte,
    lanePosities,
    laneKopBreedte: BRON_LANE_KOP_BREEDTE * schaal,
    kopHoogte: BRON_KOP_HOOGTE * schaal,
    annotatieBreedte: Math.max(120 * schaal, breedte - annotatieX - 18 * schaal),
    annotatieX,
    systeemNotitieX,
    schaal,
    posities,
    secties,
    breedte,
    hoogte: inhoudOnderkant * schaal,
  }
}

/**
 * Pure selfcheck voor import, tests en export: dezelfde geometrie-invarianten
 * als de brongetrouwe renderer, zonder DOM-, meet- of diagramdependency.
 */
export function controleerBrongetrouweLayout(proces: Process): BrongetrouweLayoutControle {
  const layout = maakBrongetrouweLayout(proces)
  const fouten: string[] = []
  const waarschuwingen: string[] = []
  const laneIds = new Set<string>()
  const stapIds = new Set<string>()
  let vorigeLaneX = -Infinity

  if (proces.lanes.length === 0) fouten.push('Het proces heeft geen lanes.')
  for (const lane of proces.lanes) {
    if (laneIds.has(lane.id)) fouten.push(`Dubbele lane-id: ${lane.id}.`)
    laneIds.add(lane.id)
    const x = layout.lanePosities.get(lane.id)
    if (x === undefined) fouten.push(`Lane ${lane.naam} heeft geen layoutpositie.`)
    if (x !== undefined && x <= vorigeLaneX) {
      fouten.push(`Lane ${lane.naam} staat niet rechts van de voorgaande lane.`)
    }
    if (x !== undefined) vorigeLaneX = x
  }
  for (const stap of proces.stappen) {
    if (stapIds.has(stap.id)) fouten.push(`Dubbele stap-id: ${stap.id}.`)
    stapIds.add(stap.id)
    if (!laneIds.has(stap.laneId)) fouten.push(`Stap ${stap.nummer} verwijst naar een onbekende lane.`)
    if (stap.doelLaneId && !laneIds.has(stap.doelLaneId)) {
      fouten.push(`Stap ${stap.nummer} verwijst naar een onbekende doel-lane.`)
    }
    if (!layout.posities.has(stap.id)) fouten.push(`Stap ${stap.nummer} heeft geen layoutpositie.`)
  }
  if (layout.breedte / layout.hoogte < 0.5) {
    waarschuwingen.push('Het proces is te lang voor één goed leesbare bronpagina; paginering is aanbevolen.')
  }

  return {
    geldig: fouten.length === 0,
    fouten,
    waarschuwingen,
    breedte: layout.breedte,
    hoogte: layout.hoogte,
    paginaverhouding: layout.breedte / layout.hoogte,
  }
}
