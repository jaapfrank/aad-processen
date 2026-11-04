import type { Process, Step } from '../contract'

export type ProcesKaderId =
  | 'iso9001'
  | 'iso27001'
  | 'iso14001'
  | 'iso45001'
  | 'iso22301'
  | 'bpmn20'

export type KaderControleStatus = 'gevonden' | 'aandacht' | 'handmatig'

export interface ProcesKader {
  id: ProcesKaderId
  naam: string
  editie: string
  domein: string
  bronUrl: string
  bronOrganisatie: 'ISO' | 'OMG'
  bronGecontroleerdOp: string
}

export interface KaderControle {
  id: string
  categorie: string
  titel: string
  status: KaderControleStatus
  bevinding: string
  advies?: string
  /**
   * Bestaande afnemers mogen dit veld negeren. Alleen bevindingen die
   * eenduidig aan bestaande processtappen te koppelen zijn krijgen ids.
   * Procesbrede of ontbrekende objecten worden niet kunstmatig aan een stap
   * gehangen.
   */
  stapIds?: string[]
}

export interface ProcesKaderRapport {
  kader: ProcesKader
  procesId: string
  procesNaam: string
  score: number
  gevonden: number
  aandacht: number
  handmatig: number
  controles: KaderControle[]
}

/**
 * Versies zijn gecontroleerd op de officiële publicatiepagina's. De scan gebruikt
 * alleen openbare metadata en hoog-over proceskenmerken; normteksten zelf worden
 * niet gekopieerd of als gratis certificeringscheck voorgesteld.
 */
export const PROCES_KADERS: readonly ProcesKader[] = [
  {
    id: 'iso9001',
    naam: 'ISO 9001',
    editie: 'ISO 9001:2015 + Amd 1:2024',
    domein: 'Kwaliteitsmanagement',
    bronUrl: 'https://www.iso.org/standard/62085.html',
    bronOrganisatie: 'ISO',
    bronGecontroleerdOp: '2026-07-24',
  },
  {
    id: 'iso27001',
    naam: 'ISO/IEC 27001',
    editie: 'ISO/IEC 27001:2022 + Amd 1:2024',
    domein: 'Informatiebeveiliging',
    bronUrl: 'https://www.iso.org/standard/27001',
    bronOrganisatie: 'ISO',
    bronGecontroleerdOp: '2026-07-24',
  },
  {
    id: 'iso14001',
    naam: 'ISO 14001',
    editie: 'ISO 14001:2026',
    domein: 'Milieumanagement',
    bronUrl: 'https://www.iso.org/standard/14001',
    bronOrganisatie: 'ISO',
    bronGecontroleerdOp: '2026-07-24',
  },
  {
    id: 'iso45001',
    naam: 'ISO 45001',
    editie: 'ISO 45001:2018 + Amd 1:2024',
    domein: 'Gezond en veilig werken',
    bronUrl: 'https://www.iso.org/standard/63787.html',
    bronOrganisatie: 'ISO',
    bronGecontroleerdOp: '2026-07-24',
  },
  {
    id: 'iso22301',
    naam: 'ISO 22301',
    editie: 'ISO 22301:2019 + Amd 1:2024',
    domein: 'Business continuity',
    bronUrl: 'https://www.iso.org/standard/75106.html',
    bronOrganisatie: 'ISO',
    bronGecontroleerdOp: '2026-07-24',
  },
  {
    id: 'bpmn20',
    naam: 'BPMN 2.0.2',
    editie: 'BPMN 2.0.2 / ISO/IEC 19510',
    domein: 'Formele procesnotatie',
    bronUrl: 'https://www.omg.org/spec/BPMN/2.0.2/',
    bronOrganisatie: 'OMG',
    bronGecontroleerdOp: '2026-07-24',
  },
] as const

interface ProcesFeiten {
  lanesGeldig: boolean
  sectiesGeldig: boolean
  explicieteStart: boolean
  explicietEinde: boolean
  verbindingenGeldig: boolean
  allesBereikbaar: boolean
  beslissingenGeldig: boolean
  berichtenGeldig: boolean
  documentatie: boolean
  beheersmaatregelen: boolean
  metingOfTermijn: boolean
  systeemOfDataReferentie: boolean
  gekoppeldeProcessen: boolean
  alternatieveRoutes: boolean
  risicoSignalen: boolean
  versieerbaar: boolean
  herleidbareBron: boolean
  processtappen: number
  rollen: number
}

type ControleInvoer = Omit<KaderControle, 'status'> & {
  status: boolean | 'handmatig'
}

function heeftTekst(waarde: string | undefined): boolean {
  return Boolean(waarde?.trim())
}

function stapHeeftDocumentatie(stap: Step): boolean {
  return [
    stap.toelichting,
    stap.opmerking,
    stap.zijnotitie,
    stap.erpStatus,
    stap.waarschuwing,
    ...(stap.checklist ?? []),
    ...(stap.fotoEisen ?? []),
  ].some(heeftTekst)
}

function lokaleDoelen(stap: Step): string[] {
  return [
    stap.naarStap,
    ...(stap.routes?.map((route) => route.naarStap) ?? []),
  ].filter((id): id is string => Boolean(id))
}

function bepaalStartStappen(proces: Process): Step[] {
  const explicieteStarts = proces.stappen.filter((stap) => stap.type === 'start')
  if (explicieteStarts.length > 0) return explicieteStarts

  // Backward compatibility voor geïmporteerde platen zonder expliciet
  // startevent: iedere bron zonder inkomende sequence flow blijft een ingang.
  const inkomend = new Set(proces.stappen.flatMap(lokaleDoelen))
  return proces.stappen.filter((stap) => !inkomend.has(stap.id))
}

function bepaalBereikbaarheid(proces: Process): boolean {
  if (proces.stappen.length === 0) return false

  const starts = bepaalStartStappen(proces)
  if (starts.length === 0) return false

  const perId = new Map(proces.stappen.map((stap) => [stap.id, stap]))
  const bezocht = new Set<string>()
  const wachtrij = starts.map((stap) => stap.id)
  while (wachtrij.length > 0) {
    const id = wachtrij.shift()
    if (!id || bezocht.has(id)) continue
    bezocht.add(id)
    const stap = perId.get(id)
    if (stap) wachtrij.push(...lokaleDoelen(stap))
  }
  return bezocht.size === proces.stappen.length
}

function onbereikbareStapIds(proces: Process): string[] {
  if (proces.stappen.length === 0) return []
  const starts = bepaalStartStappen(proces)
  const perId = new Map(proces.stappen.map((stap) => [stap.id, stap]))
  const bezocht = new Set<string>()
  const wachtrij = starts.map((stap) => stap.id)
  while (wachtrij.length > 0) {
    const id = wachtrij.shift()
    if (!id || bezocht.has(id)) continue
    bezocht.add(id)
    const stap = perId.get(id)
    if (stap) wachtrij.push(...lokaleDoelen(stap))
  }
  return proces.stappen.filter((stap) => !bezocht.has(stap.id)).map((stap) => stap.id)
}

function isUitvoeringsstap(stap: Step): boolean {
  return stap.type !== 'start' && stap.type !== 'eind' && stap.type !== 'marker'
}

function heeftBeheerspunt(stap: Step): boolean {
  return (
    heeftTekst(stap.waarschuwing) ||
    heeftTekst(stap.voorwaarde) ||
    (stap.checklist?.length ?? 0) > 0 ||
    (stap.fotoEisen?.length ?? 0) > 0
  )
}

function heeftMeetpunt(stap: Step): boolean {
  return (
    heeftTekst(stap.termijn) ||
    heeftTekst(stap.erpStatus) ||
    (stap.checklist?.length ?? 0) > 0
  )
}

function heeftSysteemOfData(stap: Step): boolean {
  return (
    heeftTekst(stap.erpStatus) ||
    heeftTekst(stap.zijnotitie) ||
    /\b(?:data|systeem|applicatie|erp|crm|pim|bestand|account|toegang)\b/i.test(
      [
        stap.activiteit,
        stap.toelichting,
        stap.opmerking,
        stap.waarschuwing,
        ...(stap.checklist ?? []),
      ].filter(Boolean).join(' '),
    )
  )
}

function heeftRisicosignaal(stap: Step): boolean {
  return (
    heeftTekst(stap.waarschuwing) ||
    heeftTekst(stap.voorwaarde) ||
    (stap.routes ?? []).some((route) => heeftTekst(route.voorwaarde))
  )
}

function ongeldigeFlowStapIds(proces: Process): string[] {
  const stapIds = new Set(proces.stappen.map((stap) => stap.id))
  const problemen = new Set(onbereikbareStapIds(proces))
  for (const stap of proces.stappen) {
    if (stap.naarStap && !stapIds.has(stap.naarStap)) problemen.add(stap.id)
    if (
      stap.type === 'eind' &&
      (Boolean(stap.naarStap) || (stap.routes?.length ?? 0) > 0)
    ) problemen.add(stap.id)
    if (
      (stap.routes ?? []).some(
        (route) =>
          !route.naarProces &&
          (!route.naarStap || !stapIds.has(route.naarStap)),
      )
    ) problemen.add(stap.id)
    if (stap.type === 'beslissing') {
      const routes = stap.routes ?? []
      const labels = routes.map((route) => route.label.trim().toLocaleLowerCase('nl-NL'))
      if (
        routes.length < 2 ||
        Boolean(stap.naarStap) ||
        labels.some((label) => !label) ||
        new Set(labels).size !== labels.length
      ) problemen.add(stap.id)
    }
  }
  return proces.stappen.filter((stap) => problemen.has(stap.id)).map((stap) => stap.id)
}

function koppelbareStapIds(
  proces: Process,
  controleId: string,
  status: KaderControleStatus,
): string[] | undefined {
  if (status !== 'aandacht') return undefined
  const laneIds = new Set(proces.lanes.map((lane) => lane.id))
  const sectieIds = new Set(proces.secties.map((sectie) => sectie.id))
  const uitvoeringsstappen = proces.stappen.filter(isUitvoeringsstap)
  let ids: string[]

  switch (controleId) {
    case 'basis-rollen':
      ids = proces.stappen
        .filter((stap) => !stap.laneId || !laneIds.has(stap.laneId))
        .map((stap) => stap.id)
      break
    case 'basis-flow':
    case 'bpmn-flow':
      ids = ongeldigeFlowStapIds(proces)
      break
    case 'basis-documentatie':
      ids = uitvoeringsstappen.filter((stap) => !stapHeeftDocumentatie(stap)).map((stap) => stap.id)
      break
    case 'qms-grenzen':
      ids = proces.stappen
        .filter((stap) => Boolean(stap.sectieId) && !sectieIds.has(stap.sectieId as string))
        .map((stap) => stap.id)
      break
    case 'qms-criteria':
    case 'isms-controls':
    case 'ems-controls':
    case 'ohs-controls':
      ids = uitvoeringsstappen.filter((stap) => !heeftBeheerspunt(stap)).map((stap) => stap.id)
      break
    case 'qms-meten':
    case 'ems-monitor':
    case 'bcms-time':
      ids = uitvoeringsstappen.filter((stap) => !heeftMeetpunt(stap)).map((stap) => stap.id)
      break
    case 'isms-systemen':
      ids = uitvoeringsstappen.filter((stap) => !heeftSysteemOfData(stap)).map((stap) => stap.id)
      break
    case 'ohs-risks':
      ids = uitvoeringsstappen.filter((stap) => !heeftRisicosignaal(stap)).map((stap) => stap.id)
      break
    case 'bcms-deps':
      ids = uitvoeringsstappen
        .filter(
          (stap) =>
            !heeftSysteemOfData(stap) &&
            !heeftTekst(stap.naarProces) &&
            !(stap.routes ?? []).some((route) => heeftTekst(route.naarProces)),
        )
        .map((stap) => stap.id)
      break
    case 'bcms-alternative':
      ids = proces.stappen
        .filter((stap) => stap.type === 'beslissing' && (stap.routes?.length ?? 0) < 2)
        .map((stap) => stap.id)
      break
    case 'bpmn-gateways':
      ids = proces.stappen
        .filter((stap) => stap.type === 'beslissing')
        .filter((stap) => ongeldigeFlowStapIds(proces).includes(stap.id))
        .map((stap) => stap.id)
      break
    case 'bpmn-lanes':
      ids = proces.stappen
        .filter(
          (stap) =>
            !laneIds.has(stap.laneId) ||
            (
              stap.type === 'bericht' &&
              (
                !stap.doelLaneId ||
                !laneIds.has(stap.doelLaneId) ||
                stap.doelLaneId === stap.laneId
              )
            ),
        )
        .map((stap) => stap.id)
      break
    default:
      return undefined
  }

  const uniek = [...new Set(ids)]
  return uniek.length > 0 ? uniek : undefined
}

function verzamelFeiten(proces: Process): ProcesFeiten {
  const stapIds = new Set(proces.stappen.map((stap) => stap.id))
  const laneIds = new Set(proces.lanes.map((lane) => lane.id))
  const sectieIds = new Set(proces.secties.map((sectie) => sectie.id))

  const verbindingenGeldig = proces.stappen.every((stap) => {
    if (stap.naarStap && !stapIds.has(stap.naarStap)) return false
    if (
      stap.type === 'eind' &&
      (Boolean(stap.naarStap) || (stap.routes?.length ?? 0) > 0)
    ) {
      return false
    }
    return (stap.routes ?? []).every(
      (route) =>
        Boolean(route.naarProces) ||
        (Boolean(route.naarStap) && stapIds.has(route.naarStap as string)),
    )
  })

  const beslissingenGeldig = proces.stappen
    .filter((stap) => stap.type === 'beslissing')
    .every((stap) => {
      const routes = stap.routes ?? []
      const labels = routes.map((route) => route.label.trim().toLocaleLowerCase('nl-NL'))
      return (
        routes.length >= 2 &&
        !stap.naarStap &&
        labels.every(Boolean) &&
        new Set(labels).size === labels.length &&
        routes.every((route) => Boolean(route.naarStap || route.naarProces))
      )
    })

  const tekstCorpus = proces.stappen
    .flatMap((stap) => [
      stap.activiteit,
      stap.toelichting,
      stap.opmerking,
      stap.zijnotitie,
      stap.erpStatus,
      stap.waarschuwing,
      ...(stap.checklist ?? []),
    ])
    .filter((tekst): tekst is string => Boolean(tekst))
    .join(' ')

  return {
    lanesGeldig:
      proces.lanes.length > 0 &&
      proces.lanes.every((lane) => heeftTekst(lane.naam)) &&
      proces.stappen.every((stap) => Boolean(stap.laneId) && laneIds.has(stap.laneId)),
    sectiesGeldig:
      proces.secties.length > 0 &&
      proces.stappen.every(
        (stap) => !stap.sectieId || sectieIds.has(stap.sectieId),
      ),
    explicieteStart: proces.stappen.some((stap) => stap.type === 'start'),
    explicietEinde: proces.stappen.some((stap) => stap.type === 'eind'),
    verbindingenGeldig,
    allesBereikbaar: bepaalBereikbaarheid(proces),
    beslissingenGeldig,
    berichtenGeldig: proces.stappen
      .filter((stap) => stap.type === 'bericht')
      .every(
        (stap) =>
          Boolean(stap.doelLaneId) &&
          laneIds.has(stap.doelLaneId as string) &&
          stap.doelLaneId !== stap.laneId,
      ),
    documentatie: proces.stappen.some(stapHeeftDocumentatie),
    beheersmaatregelen: proces.stappen.some(
      (stap) =>
        heeftTekst(stap.waarschuwing) ||
        (stap.checklist?.length ?? 0) > 0 ||
        (stap.fotoEisen?.length ?? 0) > 0 ||
        heeftTekst(stap.voorwaarde),
    ),
    metingOfTermijn: proces.stappen.some(
      (stap) =>
        heeftTekst(stap.termijn) ||
        heeftTekst(stap.erpStatus) ||
        (stap.checklist?.length ?? 0) > 0,
    ),
    systeemOfDataReferentie:
      proces.stappen.some(
        (stap) => heeftTekst(stap.erpStatus) || heeftTekst(stap.zijnotitie),
      ) ||
      /\b(?:data|systeem|applicatie|erp|crm|pim|bestand|account|toegang)\b/i.test(
        tekstCorpus,
      ),
    gekoppeldeProcessen: proces.stappen.some(
      (stap) =>
        heeftTekst(stap.naarProces) ||
        (stap.routes ?? []).some((route) => heeftTekst(route.naarProces)),
    ),
    alternatieveRoutes: proces.stappen.some(
      (stap) => (stap.routes?.length ?? 0) >= 2,
    ),
    risicoSignalen: proces.stappen.some(
      (stap) =>
        heeftTekst(stap.waarschuwing) ||
        heeftTekst(stap.voorwaarde) ||
        (stap.routes ?? []).some((route) => heeftTekst(route.voorwaarde)),
    ),
    versieerbaar:
      heeftTekst(proces.detailproces) &&
      heeftTekst(proces.versie) &&
      heeftTekst(proces.laatsteWijziging) &&
      Boolean(proces.status),
    herleidbareBron:
      Boolean(proces.bron) &&
      (heeftTekst(proces.bron?.bestand) ||
        heeftTekst(proces.bron?.importDatum) ||
        proces.bron?.type === 'handmatig'),
    processtappen: proces.stappen.length,
    rollen: proces.lanes.length,
  }
}

function automatisch(
  id: string,
  categorie: string,
  titel: string,
  gevonden: boolean,
  bevindingGevonden: string,
  bevindingOntbreekt: string,
  advies?: string,
): ControleInvoer {
  return {
    id,
    categorie,
    titel,
    status: gevonden,
    bevinding: gevonden ? bevindingGevonden : bevindingOntbreekt,
    advies: gevonden ? undefined : advies,
  }
}

function handmatig(
  id: string,
  categorie: string,
  titel: string,
  bevinding: string,
  advies: string,
): ControleInvoer {
  return { id, categorie, titel, status: 'handmatig', bevinding, advies }
}

function basisControles(feiten: ProcesFeiten): ControleInvoer[] {
  return [
    automatisch(
      'basis-versie',
      'Borging',
      'Identiteit, versie en status',
      feiten.versieerbaar,
      'Procesnaam, versie, wijzigingsdatum en publicatiestatus zijn vastgelegd.',
      'Minstens één van procesnaam, versie, wijzigingsdatum of status ontbreekt.',
      'Leg de ontbrekende metadata vast voordat het proces wordt goedgekeurd.',
    ),
    automatisch(
      'basis-rollen',
      'Verantwoordelijkheid',
      'Rollen en stapverantwoordelijkheid',
      feiten.lanesGeldig,
      `${feiten.rollen} rol(len) zijn benoemd en iedere stap heeft een geldige verantwoordelijke.`,
      'Niet iedere stap is aan een bestaande, benoemde rol gekoppeld.',
      'Koppel iedere stap aan één verantwoordelijke lane en benoem de rol concreet.',
    ),
    automatisch(
      'basis-flow',
      'Proceslogica',
      'Verbindingen en beslisroutes',
      feiten.verbindingenGeldig && feiten.allesBereikbaar && feiten.beslissingenGeldig,
      'Verbindingen, bereikbaarheid en beslisroutes zijn structureel consistent.',
      'Er zijn ongeldige, onbereikbare of onvolledige verbindingen of beslisroutes.',
      'Herstel losse stappen, verwijzingen en beslissingen met minder dan twee benoemde routes.',
    ),
    automatisch(
      'basis-documentatie',
      'Gedocumenteerde informatie',
      'Instructies en registraties',
      feiten.documentatie,
      'Het model bevat toelichting, bewijsinstructies, notities of controlegegevens.',
      'Naast de activiteitnamen is geen toelichting, bewijsinstructie of controlegegeven gevonden.',
      'Voeg bij kritieke stappen instructie, bewijs, checklist of systeemregistratie toe.',
    ),
    handmatig(
      'basis-governance',
      'Borging',
      'Proceseigenaar en reviewritme',
      'Eigenaarschap, toepassingsgebied en actuele reviewbewijzen zijn niet volledig uit het diagram af te leiden.',
      'Bevestig eigenaar, goedkeurder, reviewinterval, laatste review en toepassingsgebied in de ISO-koppeling.',
    ),
  ]
}

function kaderSpecifiekeControles(
  kader: ProcesKaderId,
  feiten: ProcesFeiten,
): ControleInvoer[] {
  switch (kader) {
    case 'iso9001':
      return [
        automatisch(
          'qms-grenzen',
          'Procesbenadering',
          'Duidelijke procesgrenzen',
          feiten.explicieteStart && feiten.explicietEinde && feiten.sectiesGeldig,
          'Expliciete start, einde en geldige processecties zijn gevonden.',
          'Start, einde of sectie-indeling is niet expliciet en volledig gemodelleerd.',
          'Voeg expliciete start- en eindpunten toe en maak de scope per sectie duidelijk.',
        ),
        automatisch(
          'qms-criteria',
          'Operationele beheersing',
          'Criteria en beheersmaatregelen',
          feiten.beheersmaatregelen,
          'Voorwaarden, waarschuwingen of checklists geven aanwijzingen voor beheersing.',
          'Geen voorwaarden, waarschuwingen of checklists in het procesmodel gevonden.',
          'Leg acceptatiecriteria, uitzonderingen en controles vast bij de relevante stappen.',
        ),
        automatisch(
          'qms-meten',
          'Evaluatie',
          'Meet- of opvolgmomenten',
          feiten.metingOfTermijn,
          'Termijnen, statussen of checklists geven een meetbaar opvolgmoment.',
          'Geen termijn, status of checklist als meetbaar opvolgmoment gevonden.',
          'Leg KPI, controlemoment, termijn en bijbehorende registratie vast.',
        ),
        handmatig(
          'qms-context',
          'Kwaliteitsmanagement',
          'Klant-, wettelijke en prestatie-eisen',
          'Klantverwachtingen, wettelijke eisen, KPI-resultaten en verbeteracties zijn niet betrouwbaar uit alleen de flow af te leiden.',
          'Controleer eisen, procesdoelen, prestatiegegevens, afwijkingen en verbetermaatregelen met de proceseigenaar.',
        ),
      ]
    case 'iso27001':
      return [
        automatisch(
          'isms-systemen',
          'Informatiebeveiliging',
          'Systemen of gegevensstromen herkenbaar',
          feiten.systeemOfDataReferentie,
          'Het proces noemt een systeem, status, gegevensdrager of gegevenscontext.',
          'Geen systeem- of gegevensreferentie in het procesmodel gevonden.',
          'Benoem gebruikte systemen, gegevenscategorieën en overdrachtsmomenten.',
        ),
        automatisch(
          'isms-controls',
          'Informatiebeveiliging',
          'Beveiligings- of controlepunten',
          feiten.beheersmaatregelen,
          'Waarschuwingen, voorwaarden of checklists maken controlepunten zichtbaar.',
          'Geen expliciet controlepunt voor risico of uitvoering gevonden.',
          'Leg preventieve/detectieve controles, bewijs en uitzonderingsafhandeling bij de stap vast.',
        ),
        automatisch(
          'isms-trace',
          'Herleidbaarheid',
          'Herleidbare procesbron',
          feiten.herleidbareBron,
          'De herkomst of handmatige bron van het proces is vastgelegd.',
          'Een herleidbare bron of importdatum ontbreekt.',
          'Leg bronbestand, brontype en import- of reviewdatum vast.',
        ),
        handmatig(
          'isms-risk',
          'Informatiebeveiliging',
          'Risicobeoordeling en behandeling',
          'Classificatie, dreigingen, waarschijnlijkheid, impact, risicoacceptatie en control-eigenaarschap staan niet volledig in het procesmodel.',
          'Koppel het proces aan het ISMS-risicoregister en bevestig risico-eigenaar, behandeling, restrisico en bewijs.',
        ),
        handmatig(
          'isms-access',
          'Informatiebeveiliging',
          'Toegang, logging en incidenten',
          'Autorisaties, loggingbewaring, privacygrondslag en incidentrespons vragen technische en organisatorische bewijsstukken.',
          'Controleer toegangsrechten, functiescheiding, logging, bewaartermijnen en incidentroute buiten het diagram.',
        ),
      ]
    case 'iso14001':
      return [
        automatisch(
          'ems-controls',
          'Milieu',
          'Operationele beheersing zichtbaar',
          feiten.beheersmaatregelen,
          'Het model bevat voorwaarden, waarschuwingen of checklists als mogelijke beheerspunten.',
          'Geen operationeel beheerspunt in het procesmodel gevonden.',
          'Leg maatregelen, grenswaarden, controles en escalatie bij relevante stappen vast.',
        ),
        automatisch(
          'ems-monitor',
          'Milieu',
          'Monitoring of termijn',
          feiten.metingOfTermijn,
          'Een termijn, status of checklist biedt een aanknopingspunt voor monitoring.',
          'Geen meet- of opvolgmoment gevonden.',
          'Benoem meetpunt, frequentie, normwaarde, registratie en verantwoordelijke.',
        ),
        handmatig(
          'ems-aspects',
          'Milieu',
          'Milieuaspecten en impact',
          'Significante milieuaspecten en levenscyclusimpact zijn niet betrouwbaar uit activiteitnamen af te leiden.',
          'Bevestig aspecten, impact, significantie en beheersing in het milieuregister.',
        ),
        handmatig(
          'ems-obligations',
          'Milieu',
          'Complianceverplichtingen en noodsituaties',
          'Vergunningen, wetgeving, belanghebbenden en milieunoodsituaties vragen externe bewijsstukken.',
          'Koppel verplichtingen, vergunningen, noodscenario’s, oefeningen en evaluaties aan het proces.',
        ),
      ]
    case 'iso45001':
      return [
        automatisch(
          'ohs-risks',
          'Veilig werken',
          'Gevaren of risicosignalen zichtbaar',
          feiten.risicoSignalen,
          'Voorwaarden, waarschuwingen of routes markeren mogelijke afwijkingen of risico’s.',
          'Geen waarschuwing, voorwaarde of risicoroute in het model gevonden.',
          'Benoem gevaren, maatregelen, stopcriteria en escalatie bij de uitvoeringsstap.',
        ),
        automatisch(
          'ohs-controls',
          'Veilig werken',
          'Uitvoeringscontroles',
          feiten.beheersmaatregelen,
          'Checklists, foto-eisen, voorwaarden of waarschuwingen ondersteunen de uitvoering.',
          'Geen zichtbare uitvoeringscontrole gevonden.',
          'Voeg werkvergunning, LMRA/checklist, PBM-eis of verificatiestap toe waar van toepassing.',
        ),
        handmatig(
          'ohs-participation',
          'Veilig werken',
          'Raadpleging en participatie',
          'De daadwerkelijke betrokkenheid van medewerkers en vertegenwoordigers is niet uit de flow aantoonbaar.',
          'Leg raadpleging, feedback, bevoegdheden en opvolging met bewijs vast.',
        ),
        handmatig(
          'ohs-legal',
          'Veilig werken',
          'Arboverplichtingen en noodrespons',
          'RI&E, wettelijke verplichtingen, incidentonderzoek en geoefende noodrespons vereisen aparte registraties.',
          'Koppel RI&E-maatregelen, incidentroute, noodplan, oefeningen en evaluaties.',
        ),
      ]
    case 'iso22301':
      return [
        automatisch(
          'bcms-deps',
          'Continuïteit',
          'Procesafhankelijkheden',
          feiten.gekoppeldeProcessen || feiten.systeemOfDataReferentie,
          'Een gekoppeld proces, systeem of gegevensafhankelijkheid is zichtbaar.',
          'Geen proces-, systeem- of gegevensafhankelijkheid in het model gevonden.',
          'Benoem leveranciers, systemen, data, locaties en voorafgaande/vervolgprocessen.',
        ),
        automatisch(
          'bcms-alternative',
          'Continuïteit',
          'Alternatieve route',
          feiten.alternatieveRoutes,
          'Het proces bevat minimaal één expliciete alternatieve route.',
          'Geen alternatieve route voor verstoring of uitzondering gevonden.',
          'Modelleer een uitwijk-, handmatige of herstelroute met duidelijke activeringscriteria.',
        ),
        automatisch(
          'bcms-time',
          'Continuïteit',
          'Tijdkritische grens',
          feiten.metingOfTermijn,
          'Een termijn, status of controlepunt is aanwezig.',
          'Geen tijdkritische grens of meetpunt gevonden.',
          'Leg RTO/RPO of maximale onderbreking, herstelvolgorde en meetbewijs vast.',
        ),
        handmatig(
          'bcms-bia',
          'Continuïteit',
          'BIA, herstelmiddelen en oefeningen',
          'Impactanalyse, minimumbezetting, herstelmiddelen en oefenresultaten staan niet volledig in het procesdiagram.',
          'Bevestig BIA, prioriteit, resources, communicatie, oefenschema en verbeteracties.',
        ),
      ]
    case 'bpmn20':
      return [
        automatisch(
          'bpmn-events',
          'BPMN-modelkwaliteit',
          'Start- en eindevents',
          feiten.explicieteStart && feiten.explicietEinde,
          'Minimaal één expliciete start en één expliciet einde zijn gemodelleerd.',
          'Een expliciete start of een expliciet einde ontbreekt.',
          'Gebruik start- en eindevents; vertrouw niet alleen op de eerste of laatste taak.',
        ),
        automatisch(
          'bpmn-flow',
          'BPMN-modelkwaliteit',
          'Sequence flow en bereikbaarheid',
          feiten.verbindingenGeldig && feiten.allesBereikbaar,
          'Sequence flows verwijzen geldig en alle stappen zijn bereikbaar.',
          'Er is een ongeldige verwijzing of een onbereikbaar modelelement.',
          'Verbind losse elementen en herstel verwijzingen naar verwijderde stappen.',
        ),
        automatisch(
          'bpmn-gateways',
          'BPMN-modelkwaliteit',
          'Beslisroutes eenduidig',
          feiten.beslissingenGeldig,
          'Beslissingen hebben minimaal twee unieke, benoemde uitgaande routes.',
          'Minstens één beslissing heeft onvolledige of dubbele routes.',
          'Geef iedere uitgaande route een uniek label, doel en eventueel één standaardroute.',
        ),
        automatisch(
          'bpmn-lanes',
          'BPMN-modelkwaliteit',
          'Pools/lanes en message flows',
          feiten.lanesGeldig && feiten.berichtenGeldig,
          'Rollen zijn geldig en berichtstappen hebben een andere, bestaande doelrol.',
          'Een rolkoppeling of berichtdoel is ongeldig of ontbreekt.',
          'Koppel taken aan een lane en laat berichten naar een expliciete andere deelnemer lopen.',
        ),
      ]
  }
}

export function controleerProcesTegenKader(
  proces: Process,
  kaderId: ProcesKaderId,
): ProcesKaderRapport {
  const kader = PROCES_KADERS.find((item) => item.id === kaderId)
  if (!kader) throw new Error(`Onbekend proceskader: ${kaderId}`)

  const feiten = verzamelFeiten(proces)
  const invoer = [...basisControles(feiten), ...kaderSpecifiekeControles(kaderId, feiten)]
  const controles: KaderControle[] = invoer.map((controle) => {
    const status: KaderControleStatus =
      controle.status === 'handmatig'
        ? 'handmatig'
        : controle.status
          ? 'gevonden'
          : 'aandacht'
    const stapIds = koppelbareStapIds(proces, controle.id, status)
    return {
      ...controle,
      status,
      ...(stapIds ? { stapIds } : {}),
    }
  })
  const automatischControleerbaar = controles.filter(
    (controle) => controle.status !== 'handmatig',
  )
  const gevonden = controles.filter((controle) => controle.status === 'gevonden').length
  const aandacht = controles.filter((controle) => controle.status === 'aandacht').length
  const handmatigAantal = controles.filter(
    (controle) => controle.status === 'handmatig',
  ).length

  return {
    kader,
    procesId: proces.id,
    procesNaam: proces.detailproces,
    score:
      automatischControleerbaar.length === 0
        ? 0
        : Math.round((gevonden / automatischControleerbaar.length) * 100),
    gevonden,
    aandacht,
    handmatig: handmatigAantal,
    controles,
  }
}

export function controleerProcesTegenAlleKaders(
  proces: Process,
): ProcesKaderRapport[] {
  return PROCES_KADERS.map((kader) =>
    controleerProcesTegenKader(proces, kader.id),
  )
}
