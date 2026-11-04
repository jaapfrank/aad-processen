import type { Process, Step } from '../contract'

export interface ExplicieteProcesverbinding {
  bronId: string
  doelType: 'stap' | 'proces'
  doelId: string
  label: string
  routeId?: string
  standaard?: boolean
  doelBestaat: boolean
}

/**
 * Leidt uitsluitend relaties af die letterlijk in het contract staan.
 * De array- en sectievolgorde bepalen alleen de layout, nooit de proceslogica.
 */
export function bepaalExplicieteProcesverbindingen(proces: Process): ExplicieteProcesverbinding[] {
  const bekendeStappen = new Set(proces.stappen.map((stap) => stap.id))
  return proces.stappen.flatMap((stap) => {
    const direct: ExplicieteProcesverbinding[] = [
      ...(stap.naarStap
        ? [{
            bronId: stap.id,
            doelType: 'stap' as const,
            doelId: stap.naarStap,
            label: '',
            doelBestaat: bekendeStappen.has(stap.naarStap),
          }]
        : []),
      ...(stap.naarProces
        ? [{
            bronId: stap.id,
            doelType: 'proces' as const,
            doelId: stap.naarProces,
            label: 'Vervolgproces',
            doelBestaat: true,
          }]
        : []),
    ]
    const routes: ExplicieteProcesverbinding[] = (stap.routes ?? []).flatMap((route) => [
      ...(route.naarStap
        ? [{
            bronId: stap.id,
            doelType: 'stap' as const,
            doelId: route.naarStap,
            label: route.label,
            routeId: route.id,
            standaard: route.standaard,
            doelBestaat: bekendeStappen.has(route.naarStap),
          }]
        : []),
      ...(route.naarProces
        ? [{
            bronId: stap.id,
            doelType: 'proces' as const,
            doelId: route.naarProces,
            label: route.label,
            routeId: route.id,
            standaard: route.standaard,
            doelBestaat: true,
          }]
        : []),
    ])
    return [...direct, ...routes]
  })
}

/**
 * Bepaalt alleen de plaatsingsvolgorde voor graphweergaven.
 * Expliciete relaties worden depth-first gevolgd; cycles en losse stappen
 * worden daarna in de oorspronkelijke sectie-/arrayvolgorde toegevoegd.
 */
export function ordenStappenVoorDiagram(proces: Process): Step[] {
  const basis = [
    ...proces.secties.flatMap((sectie) =>
      proces.stappen.filter((stap) => stap.sectieId === sectie.id),
    ),
  ]
  const opgenomen = new Set(basis.map((stap) => stap.id))
  basis.push(...proces.stappen.filter((stap) => !opgenomen.has(stap.id)))

  const stapOpId = new Map(basis.map((stap) => [stap.id, stap]))
  const interne = bepaalExplicieteProcesverbindingen(proces).filter(
    (verbinding) => verbinding.doelType === 'stap' && verbinding.doelBestaat,
  )
  const inkomend = new Map(basis.map((stap) => [stap.id, 0]))
  const uitgaand = new Map(basis.map((stap) => [stap.id, [] as string[]]))
  for (const verbinding of interne) {
    inkomend.set(verbinding.doelId, (inkomend.get(verbinding.doelId) ?? 0) + 1)
    const doelen = uitgaand.get(verbinding.bronId)
    if (doelen && !doelen.includes(verbinding.doelId)) doelen.push(verbinding.doelId)
  }

  const wortels = [
    ...basis.filter((stap) => stap.type === 'start'),
    ...basis.filter((stap) => stap.type !== 'start' && (inkomend.get(stap.id) ?? 0) === 0),
  ]
  const bezocht = new Set<string>()
  const resultaat: Step[] = []

  const bezoek = (beginId: string) => {
    const stack = [beginId]
    while (stack.length > 0) {
      const id = stack.pop()!
      if (bezocht.has(id)) continue
      const stap = stapOpId.get(id)
      if (!stap) continue
      bezocht.add(id)
      resultaat.push(stap)
      const doelen = uitgaand.get(id) ?? []
      for (let index = doelen.length - 1; index >= 0; index -= 1) stack.push(doelen[index])
    }
  }

  wortels.forEach((stap) => bezoek(stap.id))
  basis.forEach((stap) => bezoek(stap.id))
  return resultaat
}
