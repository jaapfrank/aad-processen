import type { Process, Step, StepSystemEvent } from '../contract'

export interface BrongetrouweHoofdinteractie {
  bronLaneId: string
  doelLaneId: string
  soort: 'activiteit' | 'bericht'
  metPijl: boolean
}

export interface BrongetrouweAnnotatie {
  id: string
  soort: 'instructie' | 'zij-notitie' | 'waarschuwing'
  tekst: string
  plaatsing: 'in-diagram' | 'rechts'
}

export interface BrongetrouweStapSemantiek {
  hoofdinteractie?: BrongetrouweHoofdinteractie
  gebeurtenissenVoor: StepSystemEvent[]
  gebeurtenissenNa: StepSystemEvent[]
  annotaties: BrongetrouweAnnotatie[]
}

export interface BrongetrouweSemantiekControle {
  geldig: boolean
  fouten: string[]
  waarschuwingen: string[]
}

function heeftTekst(waarde: string | undefined): waarde is string {
  return Boolean(waarde?.trim())
}

function isGestructureerdeStatus(stap: Step): boolean {
  const status = stap.erpStatus?.trim().toLocaleLowerCase('nl')
  return Boolean(
    status &&
      stap.systeemGebeurtenissen?.some(
        (gebeurtenis) =>
          gebeurtenis.type === 'status' &&
          gebeurtenis.activiteit.toLocaleLowerCase('nl').includes(status),
      ),
  )
}

/**
 * Zet de Step-contractvelden om in afzonderlijke renderbetekenissen.
 *
 * Belangrijk: vrije velden worden bewust niet samengevoegd. Een instructie,
 * status-callout en waarschuwing blijven daardoor ieder selecteerbaar en
 * positioneerbaar. Oude processen zonder v1.8-velden behouden hun zijnotitie.
 */
export function bepaalBrongetrouweStapSemantiek(stap: Step): BrongetrouweStapSemantiek {
  const gebeurtenissen = stap.systeemGebeurtenissen ?? []
  const gebeurtenissenVoor = gebeurtenissen.filter(
    (gebeurtenis) => gebeurtenis.positie === 'voor',
  )
  const gebeurtenissenNa = gebeurtenissen.filter(
    (gebeurtenis) => gebeurtenis.positie !== 'voor',
  )

  const doelLaneId =
    stap.type === 'bericht' ? stap.doelLaneId : stap.interactieDoelLaneId
  const hoofdinteractie = doelLaneId
    ? {
        bronLaneId: stap.laneId,
        doelLaneId,
        soort: stap.type === 'bericht' ? 'bericht' as const : 'activiteit' as const,
        metPijl: stap.type === 'bericht',
      }
    : undefined

  const annotaties: BrongetrouweAnnotatie[] = []
  if (heeftTekst(stap.toelichting)) {
    annotaties.push({
      id: `${stap.id}:toelichting`,
      soort: 'instructie',
      tekst: stap.toelichting,
      plaatsing: 'in-diagram',
    })
  }
  if (heeftTekst(stap.zijnotitie) && !isGestructureerdeStatus(stap)) {
    annotaties.push({
      id: `${stap.id}:zijnotitie`,
      soort: 'zij-notitie',
      tekst: stap.zijnotitie,
      plaatsing: 'rechts',
    })
  }
  if (heeftTekst(stap.waarschuwing)) {
    annotaties.push({
      id: `${stap.id}:waarschuwing`,
      soort: 'waarschuwing',
      tekst: stap.waarschuwing,
      plaatsing: 'rechts',
    })
  }

  return {
    hoofdinteractie,
    gebeurtenissenVoor,
    gebeurtenissenNa,
    annotaties,
  }
}

/**
 * Contractcontrole voor fidelity-specifieke semantiek. Deze validatie is puur
 * en kan daarom ook bij import, AI-output en export worden hergebruikt.
 */
export function controleerBrongetrouweSemantiek(
  proces: Process,
): BrongetrouweSemantiekControle {
  const fouten: string[] = []
  const waarschuwingen: string[] = []
  const laneIds = new Set(proces.lanes.map((lane) => lane.id))

  for (const stap of proces.stappen) {
    if (stap.interactieDoelLaneId) {
      if (!laneIds.has(stap.interactieDoelLaneId)) {
        fouten.push(
          `Stap ${stap.nummer} verwijst naar onbekende interactie-lane '${stap.interactieDoelLaneId}'.`,
        )
      } else if (stap.interactieDoelLaneId === stap.laneId) {
        fouten.push(`Stap ${stap.nummer} heeft dezelfde bron- en interactie-lane.`)
      }
      if (stap.type === 'bericht') {
        waarschuwingen.push(
          `Berichtstap ${stap.nummer} gebruikt interactieDoelLaneId; gebruik doelLaneId voor de ontvanger.`,
        )
      }
    }

    const gebeurtenisIds = new Set<string>()
    for (const gebeurtenis of stap.systeemGebeurtenissen ?? []) {
      const label = `Systeemgebeurtenis '${gebeurtenis.id}' bij stap ${stap.nummer}`
      if (gebeurtenisIds.has(gebeurtenis.id)) {
        fouten.push(`${label} heeft geen unieke id binnen de stap.`)
      }
      gebeurtenisIds.add(gebeurtenis.id)

      if (!gebeurtenis.activiteit.trim()) {
        fouten.push(`${label} heeft geen activiteit/callout.`)
      }
      if (!laneIds.has(gebeurtenis.laneId)) {
        fouten.push(`${label} verwijst naar onbekende lane '${gebeurtenis.laneId}'.`)
      }
      if (gebeurtenis.doelLaneId && !laneIds.has(gebeurtenis.doelLaneId)) {
        fouten.push(
          `${label} verwijst naar onbekende doel-lane '${gebeurtenis.doelLaneId}'.`,
        )
      }
      if (
        gebeurtenis.doelLaneId &&
        gebeurtenis.doelLaneId === gebeurtenis.laneId
      ) {
        fouten.push(`${label} heeft dezelfde bron- en doel-lane.`)
      }
      if (gebeurtenis.type === 'synchronisatie' && !gebeurtenis.doelLaneId) {
        fouten.push(`${label} vereist een doel-lane.`)
      }
      if (
        gebeurtenis.type !== 'synchronisatie' &&
        gebeurtenis.doelLaneId
      ) {
        waarschuwingen.push(
          `${label} heeft een doel-lane, maar type '${gebeurtenis.type}' is geen synchronisatie.`,
        )
      }
    }
  }

  return {
    geldig: fouten.length === 0,
    fouten,
    waarschuwingen,
  }
}
