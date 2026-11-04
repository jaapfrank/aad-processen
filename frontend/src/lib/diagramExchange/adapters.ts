import type { DiagramFormatAdapter } from './types'
import { unavailableExport, unavailableImport } from './types'
import { exportVisioVsdx } from './visio'

export const visioVsdxAdapter: DiagramFormatAdapter = {
  capability: {
    format: 'visio-vsdx',
    label: 'Microsoft Visio (.vsdx)',
    extensions: ['.vsdx'],
    localImport: false,
    localExport: true,
    roundTrip: 'semantic-subset',
    requiresBackend: false,
    requiresExternalService: false,
    explanation:
      'Exporteert lokaal een macro-vrije, bewerkbare éénpagina-VSDX met lanes, procesvormen en gelijmde connectors. De begrensde backend verzorgt gecontroleerde herimport.',
  },
  importProcess: () =>
    unavailableImport(
      'visio-vsdx',
      'backend-required',
      'Gebruik de gekoppelde veilige VSDX-backendcodec voor Visio-import.',
    ),
  exportProcess: exportVisioVsdx,
}

export const lucidStandardAdapter: DiagramFormatAdapter = {
  capability: {
    format: 'lucid-standard',
    label: 'Lucid Standard Import',
    extensions: ['.lucid'],
    localImport: false,
    localExport: false,
    roundTrip: 'semantic-subset',
    requiresBackend: true,
    requiresExternalService: false,
    explanation:
      'De backend maakt en leest een bewerkbaar Lucid Standard Import-package. Direct opslaan in een Lucid-account zou aanvullend OAuth vereisen.',
  },
  importProcess: () =>
    unavailableImport(
      'lucid-standard',
      'backend-required',
      'Gebruik de gekoppelde Lucid Standard Import-backendcodec.',
    ),
  exportProcess: () =>
    unavailableExport(
      'lucid-standard',
      'backend-required',
      'Gebruik de gekoppelde Lucid Standard Import-backendcodec voor package-export.',
    ),
}
