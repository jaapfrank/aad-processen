import type { Process } from '../contract'

/**
 * Maakt een niet-opgeslagen diagramwerkconcept.
 *
 * Bij vervanging van een bestaand proces zijn het doel-id en de revision uit de
 * actuele werkruimte gezaghebbend. Metadata uit het leveranciersbestand mag die
 * optimistic-concurrencywaarde nooit overschrijven.
 */
export function maakDiagramImportWerkconcept(
  geimporteerd: Process,
  doelProces?: Process,
): Process {
  return {
    ...structuredClone(geimporteerd),
    id: doelProces?.id ?? geimporteerd.id,
    revision: doelProces?.revision,
    status: 'concept',
  }
}
