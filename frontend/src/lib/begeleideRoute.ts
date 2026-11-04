import type { Process, Step } from '../contract'

export interface RouteBevestiging {
  stapId: string
  routeId?: string
  overgeslagen?: boolean
}

export type RoutePositie =
  | { soort: 'stap'; stap: Step }
  | { soort: 'klaar' }
  | { soort: 'overdracht'; procesId: string }
  | { soort: 'geblokkeerd'; melding: string }

const geblokkeerd = (melding: string): RoutePositie => ({ soort: 'geblokkeerd', melding })

/** Startpunten zijn expliciet, of hebben geen inkomende verbinding. Losse takken worden nooit aangeplakt. */
export function begeleideStartpunten(proces: Process): Step[] {
  const expliciet = proces.stappen.filter((stap) => stap.type === 'start')
  if (expliciet.length > 0) return expliciet
  const doelen = new Set(proces.stappen.flatMap((stap) => [
    ...(stap.naarStap ? [stap.naarStap] : []),
    ...(stap.routes ?? []).flatMap((route) => route.naarStap ? [route.naarStap] : []),
  ]))
  return proces.stappen.filter((stap) => !doelen.has(stap.id) && stap.type !== 'marker' && stap.type !== 'eind')
}

/** Ambigue modellen vragen om correctie in de editor; de gids verzint geen vervolg. */
export function begeleideStapProbleem(proces: Process, stap: Step): string | undefined {
  const routes = stap.routes ?? []
  const doelGeldig = (id: string) => proces.stappen.filter((item) => item.id === id).length === 1
  if (stap.type === 'beslissing' || routes.length > 0) {
    if (stap.type !== 'beslissing' || stap.naarStap || stap.naarProces || routes.length < 2) {
      return 'Deze beslissing heeft geen eenduidige, benoemde vervolgroutes. Laat de proceseigenaar de verbindingen controleren.'
    }
    if (new Set(routes.map((route) => route.id)).size !== routes.length ||
        new Set(routes.map((route) => route.label.trim().toLocaleLowerCase())).size !== routes.length ||
        routes.some((route) => !route.id.trim() || !route.label.trim()) ||
        routes.filter((route) => route.standaard).length > 1) {
      return 'De routekeuzes zijn niet eenduidig benoemd. Laat de proceseigenaar de beslissing corrigeren.'
    }
    if (routes.some((route) => Boolean(route.naarStap) === Boolean(route.naarProces) ||
        (route.naarStap && !doelGeldig(route.naarStap)))) {
      return 'Een beslisroute heeft een ontbrekend of dubbel doel. Laat de proceseigenaar de verbinding corrigeren.'
    }
  } else {
    if (stap.type === 'eind' && stap.naarStap) return 'Deze eindstap heeft toch een vervolg binnen het proces. Laat de proceseigenaar dit corrigeren.'
    if (stap.naarStap && !doelGeldig(stap.naarStap)) return 'De volgende stap bestaat niet of is niet eenduidig. Laat de proceseigenaar de verbinding corrigeren.'
    if (stap.naarStap && stap.naarProces && stap.type !== 'subproces') return 'Deze stap heeft twee verschillende vervolgen. Laat de proceseigenaar een expliciete beslissing of subprocesstap maken.'
    if (!stap.naarStap && !stap.naarProces && stap.type !== 'eind') return 'Hier ontbreekt een vervolgstap of expliciet einde. De gids kan deze route nog niet afronden.'
  }
  return undefined
}

/** Herleid de positie uitsluitend uit bevestigde stappen van de geopende procesversie. */
export function begeleidePositie(proces: Process, startId: string, historie: RouteBevestiging[]): RoutePositie {
  if (new Set(proces.stappen.map((stap) => stap.id)).size !== proces.stappen.length) {
    return geblokkeerd('Dit proces bevat dubbele stapnummers in de technische verbindingen. Laat de proceseigenaar het proces corrigeren.')
  }
  const start = begeleideStartpunten(proces).find((stap) => stap.id === startId)
  if (!start) return geblokkeerd('Dit startpunt is niet beschikbaar in deze procesversie.')
  let positie: RoutePositie = { soort: 'stap', stap: start }
  for (const bevestiging of historie) {
    if (positie.soort !== 'stap' || positie.stap.id !== bevestiging.stapId) {
      return geblokkeerd('De bevestigde stappen sluiten niet aan op deze route. Start de route opnieuw.')
    }
    const stap: Step = positie.stap
    const probleem = begeleideStapProbleem(proces, stap)
    if (probleem) return geblokkeerd(probleem)
    if (bevestiging.overgeslagen && (!stap.voorwaarde || stap.type === 'beslissing' || stap.type === 'eind')) {
      return geblokkeerd('Deze stap kan niet als niet van toepassing worden overgeslagen.')
    }
    let stapDoel = stap.naarStap
    let procesDoel = bevestiging.overgeslagen ? undefined : stap.naarProces
    if (stap.type === 'beslissing') {
      const route = stap.routes?.find((item) => item.id === bevestiging.routeId)
      if (!route) return geblokkeerd('Kies expliciet een van de vastgelegde beslisroutes.')
      stapDoel = route.naarStap
      procesDoel = route.naarProces
    } else if (bevestiging.routeId) {
      return geblokkeerd('Deze stap heeft geen beslisroute.')
    }
    if (stapDoel) positie = { soort: 'stap', stap: proces.stappen.find((item) => item.id === stapDoel)! }
    else if (procesDoel) positie = { soort: 'overdracht', procesId: procesDoel }
    else if (stap.type === 'eind') positie = { soort: 'klaar' }
    else return geblokkeerd('Er is geen vastgelegd vervolg voor deze keuze.')
  }
  return positie
}

/** Lokale recenthistorie is optioneel en mag het processenoverzicht nooit laten uitvallen. */
export function leesRecenteProcesIds(ophalen: () => string | null): string[] {
  try {
    const waarde: unknown = JSON.parse(ophalen() ?? '[]')
    return Array.isArray(waarde)
      ? [...new Set(waarde.filter((id): id is string => typeof id === 'string' && id.length > 0))].slice(0, 12)
      : []
  } catch {
    return []
  }
}
