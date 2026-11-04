// Her-export van het gedeelde contract (bron van waarheid in /contract).
// De frontend gebruikt deze types overal, zodat FE en BE niet uit elkaar lopen.
export type {
  Process,
  ProcessSummary,
  ProcessStatus,
  ProcessSource,
  ProcessDiagramPoint,
  ProcessNodePlacement,
  ProcessEdgePlacement,
  ProcessDiagramLayout,
  Lane,
  Section,
  Step,
  StepType,
  StepSystemEvent,
  StepSystemEventType,
  User,
  Role,
  AppConfig,
  Version,
  Suggestion,
  SuggestionType,
  SuggestionStatus,
  ImportJob,
} from '@contract/model'

export type {
  IsoNorm,
  IsoOverview,
  IsoMatrixRow,
  IsoMapping,
  BorgingIssue,
} from '@contract/iso'

export type {
  DiagramFormat,
  DiagramBounds,
  DiagramSemanticRef,
  DiagramNode,
  DiagramEndpoint,
  DiagramPoint,
  DiagramEdge,
  DiagramPage,
  DiagramDocument,
  DiagramImportIssue,
  DiagramImportReport,
  DiagramFormatCapability,
  DiagramPackageIssue,
  DiagramElementGeometry,
  DiagramPackageImportResult,
  DiagramExportBlocker,
} from '@contract/diagram'
