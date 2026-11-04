import catalog from '@contract/audit-control-catalog.json'
import type { ProcesKaderId } from './procesKaders'

type CatalogFramework = {
  manualControlIds: string[]
}

const frameworks = catalog.frameworks as Record<ProcesKaderId, CatalogFramework>

export const AUDIT_CONTROL_CATALOG_VERSION = catalog.version

export function isHandmatigeCataloguscontrole(
  kaderId: ProcesKaderId,
  controleId: string,
): boolean {
  return frameworks[kaderId]?.manualControlIds.includes(controleId) ?? false
}
