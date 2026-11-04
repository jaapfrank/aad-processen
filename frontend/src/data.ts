import type {
  AppConfig,
  User,
  Process,
  ProcessSummary,
  IsoNorm,
  IsoOverview,
  Version,
  Suggestion,
  SuggestionType,
  SuggestionStatus,
  ImportJob,
  DiagramPackageImportResult,
  DiagramExportBlocker,
} from './contract'
import type {
  AuditBeoordelingStart,
  AuditBevestiging,
  AuditBevestigingRequest,
  IsoProcessConfig,
} from '@contract/iso'
import type {
  AuditEntry,
  HealthReport,
  DiffReport,
  LocalUser,
  LocalUserCreateRequest,
  LocalUserUpdateRequest,
} from '@contract/model'
import type {
  ProcessMaintenanceAnalysis,
  ProcessMaintenanceAnalysisRequest,
} from '@contract/ai-process-steward'
import type {
  ProcessMaintenanceRunFeedbackRequest,
  ProcessMaintenanceRunLedgerItem,
} from '@contract/ai-run-history'
import type {
  AssuranceFrameworkCatalog,
  AssuranceMonitoringStatus,
  AssuranceQuestionnaire,
  AssuranceQuestionnaireAnswerRequest,
  AssuranceRun,
  AssuranceSettings,
  AssuranceSettingsUpdate,
} from '@contract/assurance'
import configJson from '@contract/examples/config.json'
import meJson from '@contract/examples/me.json'
import isoOverviewJson from '@contract/examples/iso-overview.json'
import { useConcepten } from './store/concepten'
import { useSuggesties } from './store/suggesties'
import { controleerGezondheid } from './lib/gezondheid'
import { getEntraToken } from './entraAuth'
import {
  beschrijfRuntime,
  parseAiInstellingenSnapshot,
  parseAiVerbindingstest,
  type AiInstellingenSnapshot,
  type AiInstellingenWijziging,
  type AiVerbindingstest,
  type RuntimeGegevensbron,
} from './lib/beheerModel'
import { parseProcessMaintenanceAnalysis } from './lib/aiProcessSteward'
import {
  parseProcessMaintenanceRunHistory,
  parseProcessMaintenanceRunLedgerItem,
} from './lib/processMaintenanceRunHistory'

/**
 * Databron-abstractie: één interface voor de mock én de echte API.
 * Zo draait de frontend zonder backend (mock), maar schakelt hij 1-op-1
 * over naar de .NET-backend zonder dat componenten wijzigen.
 */
export interface DataSource {
  /** True wanneer er een echte backend achter zit (import/beheer beschikbaar). */
  readonly heeftBackend: boolean
  /** Alleen-lezen runtime-identiteit; wisselen gebeurt uitsluitend bij start/deployment. */
  readonly runtime: RuntimeGegevensbron
  getConfig(): Promise<AppConfig>
  getMe(): Promise<User | null>
  /** Lokale inlog; geeft de gebruiker terug of null bij foute gegevens. */
  login(gebruikersnaam: string, wachtwoord: string): Promise<User | null>
  /** Maakt uitsluitend op een expliciete lokale development-runtime een tijdelijke testsessie. */
  startDevelopmentSession(): Promise<User | null>
  logout(): Promise<void>
  /** Alleen de laatste goedgekeurde publicaties; veilig voor werkvloer, zoeken en AI-routes. */
  getProcesses(): Promise<ProcessSummary[]>
  getProcess(id: string): Promise<Process | null>
  /** Actuele werkversies voor redacteuren en goedkeurders. */
  getWorkspaceProcesses(): Promise<ProcessSummary[]>
  getWorkspaceProcess(id: string): Promise<Process | null>
  /** Proces opslaan als concept (nieuw of gewijzigd). */
  saveProcess(p: Process): Promise<Process>
  /** Proces verwijderen/archiveren (rol 'beheren'). */
  deleteProcess(id: string): Promise<void>
  getHealth(id: string): Promise<HealthReport>
  // Workflow & versies
  submitProcess(id: string, expectedRevision: number | undefined): Promise<Version>
  approveProcess(id: string, expectedRevision: number | undefined): Promise<Version>
  rejectProcess(id: string, expectedRevision: number | undefined, reden?: string): Promise<Version>
  getVersions(id: string): Promise<Version[]>
  getDiff(id: string, van: number, naar: number): Promise<DiffReport>
  // Suggesties
  postSuggestion(procesId: string, stapId: string, type: SuggestionType, tekst: string): Promise<Suggestion>
  getSuggestions(status?: SuggestionStatus): Promise<Suggestion[]>
  resolveSuggestion(id: string, status: SuggestionStatus): Promise<Suggestion>
  // PDF-import
  importPdf(bestand: File): Promise<ImportJob>
  getImportJob(jobId: string): Promise<ImportJob>
  commitImport(jobId: string, proces: Process): Promise<Process>
  fileUrl(id: string): string
  /** Bewerkbare leveranciersformaten; import retourneert altijd eerst een reviewrapport. */
  exportLucidDiagram(proces: Process): Promise<{ bestand: Blob; bestandsnaam: string }>
  importDiagramPackage(
    format: 'lucid-standard' | 'visio-vsdx',
    bestand: File,
    options?: { pageId?: string; defaultRole?: string },
  ): Promise<DiagramPackageImportResult>
  getVisioExportBlocker(): Promise<DiagramExportBlocker>
  // ISO
  getIsoOverview(norm?: IsoNorm): Promise<IsoOverview>
  isoExportUrl(norm?: IsoNorm): string
  /** ISO-koppeling van één proces lezen/schrijven (rol bewerken). */
  getProcessIso(id: string): Promise<IsoProcessConfig>
  saveProcessIso(id: string, config: IsoProcessConfig): Promise<void>
  startAuditAssessment(id: string, kaderId: string): Promise<AuditBeoordelingStart>
  confirmAuditAssessment(
    id: string,
    request: AuditBevestigingRequest,
  ): Promise<AuditBevestiging>
  /** Organisatiebrede normscope, begeleide toetsing en verplichte assurancecyclus. */
  getAssuranceFrameworks(): Promise<AssuranceFrameworkCatalog>
  getAssuranceSettings(): Promise<AssuranceSettings>
  saveAssuranceSettings(req: AssuranceSettingsUpdate): Promise<AssuranceSettings>
  getAssuranceQuestionnaires(
    frameworkId?: string,
    limit?: number,
  ): Promise<AssuranceQuestionnaire[]>
  getAssuranceQuestionnaire(sessionId: string): Promise<AssuranceQuestionnaire>
  startAssuranceQuestionnaire(kaderId: string): Promise<AssuranceQuestionnaire>
  answerAssuranceQuestionnaire(
    sessionId: string,
    request: AssuranceQuestionnaireAnswerRequest,
  ): Promise<AssuranceQuestionnaire>
  getAssuranceMonitoringStatus(): Promise<AssuranceMonitoringStatus>
  getAssuranceRuns(limit?: number): Promise<AssuranceRun[]>
  startAssuranceRun(): Promise<AssuranceRun>
  /** Back-upbeheer (rol beheren, storage=local). */
  getBackups(): Promise<Array<{ naam: string; bytes: number; gemaaktOp: string }>>
  createBackup(): Promise<{ naam: string }>
  backupUrl(naam: string): string
  /** Huisstijl (GET anoniem; PUT/reset rol beheren). */
  saveBranding(b: { bedrijfsnaam: string; appNaam: string; primaireKleur: string; accentKleur: string; logoDataUrl?: string | null }): Promise<void>
  resetBranding(): Promise<void>
  /** ChatGPT/Codex OAuth (rol beheren). */
  startChatGptOAuth(): Promise<{ authorizationUrl: string }>
  getChatGptOAuthStatus(): Promise<{ gekoppeld: boolean; accountId?: string; verlooptOp?: string; wachtOpCallback: boolean }>
  logoutChatGptOAuth(): Promise<void>
  /** Back-upschema (rol beheren). */
  getBackupInstellingen(): Promise<{ intervalUren: number; retentie: number; extraDoelmap?: string | null }>
  saveBackupInstellingen(req: { intervalUren: number; retentie: number; extraDoelmap?: string | null }): Promise<void>
  /** Mail naar beheerders (rol beheren). */
  getMailInstellingen(): Promise<{ smtpHost: string; smtpPoort: number; ssl: boolean; gebruiker: string; heeftWachtwoord: boolean; afzender: string; ontvangers: string; geconfigureerd: boolean }>
  saveMailInstellingen(req: { smtpHost: string; smtpPoort: number; ssl: boolean; gebruiker?: string; wachtwoord?: string; afzender: string; ontvangers: string }): Promise<void>
  testMail(): Promise<{ melding: string }>
  /** Meldingen-webhook (rol beheren). */
  getMeldingenInstellingen(): Promise<{ webhookUrl: string; bijSuggestie: boolean; bijIndienen: boolean; bijGoedkeuren: boolean; geconfigureerd: boolean }>
  saveMeldingenInstellingen(req: { webhookUrl: string; bijSuggestie: boolean; bijIndienen: boolean; bijGoedkeuren: boolean }): Promise<void>
  testMeldingen(): Promise<{ melding: string }>
  /** Business Central (rol beheren / kijken). */
  getBcInstellingen(): Promise<{ tenantId: string; environment: string; companyId: string; clientId: string; heeftSecret: boolean; extraEntiteit: string; geconfigureerd: boolean }>
  saveBcInstellingen(req: { tenantId: string; environment: string; companyId: string; clientId: string; clientSecret?: string; extraEntiteit?: string }): Promise<void>
  bcZoek(nummer: string): Promise<Array<{ type: string; nummer: string; klant?: string; datum?: string; status?: string; totaal?: number }>>
  /** AD/Entra-instellingen (rol beheren). */
  getEntraInstellingen(): Promise<{ actieveAuthMode: string; tenantId: string; clientId: string; groupRoleMappings: Record<string, string[]>; wachtOpHerstart: boolean }>
  saveEntraInstellingen(req: { authMode: string; tenantId: string; clientId: string; groupRoleMappings: Record<string, string[]> }): Promise<{ melding: string }>
  /** AI-instellingen (rol beheren). */
  getAiInstellingen(): Promise<AiInstellingenSnapshot>
  saveAiInstellingen(req: AiInstellingenWijziging): Promise<AiInstellingenSnapshot>
  rotateAiCredential(secret: string): Promise<AiInstellingenSnapshot>
  revokeAiCredential(): Promise<void>
  testAiConnection(): Promise<AiVerbindingstest>
  /** AI-assistent: vraag over de processen. */
  askAi(vraag: string, geschiedenis?: { rol: 'gebruiker' | 'ai'; tekst: string }[]): Promise<string>
  /** AI Process Steward: analyseert één opgeslagen procesrevisie, zonder mutatie. */
  analyzeProcessMaintenance(
    processId: string,
    request: ProcessMaintenanceAnalysisRequest,
  ): Promise<ProcessMaintenanceAnalysis>
  /** Privacyarme historie van AI-onderhoudsruns; bevat geen prompts of procesinhoud. */
  getProcessMaintenanceRuns(
    processId: string,
    limit?: number,
  ): Promise<ProcessMaintenanceRunLedgerItem[]>
  /** Leg één menselijke acceptatie of afwijzing onveranderbaar bij de run vast. */
  recordProcessMaintenanceRunFeedback(
    processId: string,
    runId: string,
    request: ProcessMaintenanceRunFeedbackRequest,
  ): Promise<ProcessMaintenanceRunLedgerItem>
  /** Audit-log (rol beheren). */
  getAudit(limit?: number): Promise<AuditEntry[]>
  // Lokaal gebruikersbeheer (contract v1.2)
  getAdminUsers(): Promise<LocalUser[]>
  createAdminUser(req: LocalUserCreateRequest): Promise<LocalUser>
  updateAdminUser(id: string, req: LocalUserUpdateRequest): Promise<LocalUser>
  setAdminPassword(id: string, wachtwoord: string): Promise<LocalUser>
}

/** Alle proces-fixtures uit /contract — de mock-inhoud van de app (auto-geladen). */
const fixtureProcessen = Object.values(
  import.meta.glob('@contract/fixtures/*.json', { eager: true, import: 'default' }),
) as Process[]

/** Compacte samenvatting van een (concept)proces voor lijsten/atlas. */
function naarSummary(p: Process): ProcessSummary {
  return {
    id: p.id,
    hoofdproces: p.hoofdproces,
    detailproces: p.detailproces,
    versie: p.versie,
    status: p.status,
    laatsteWijziging: p.laatsteWijziging,
    aantalStappen: p.stappen.length,
    koppelingen: [...new Set(p.stappen.map((s) => s.naarProces).filter((x): x is string => !!x))],
  }
}

const mockUser = () => (meJson as unknown as { user: User }).user

function mockVersion(procesId: string, status: Process['status']): Version {
  return {
    versieNr: 1,
    procesId,
    status,
    gewijzigdDoor: mockUser().naam,
    gewijzigdOp: new Date().toISOString(),
  }
}

/**
 * Mock-bron: fixtures uit /contract + lokale werkversies uit de procesbouwer.
 * Overzicht en begeleiding tonen alleen live publicaties; de werkruimte toont
 * ook concept- en reviewversies. Import en gebruikersbeheer vereisen de backend.
 */
const mockSource: DataSource = {
  heeftBackend: false,
  runtime: beschrijfRuntime('mock'),
  async getConfig() {
    return configJson as unknown as AppConfig
  },
  async getMe() {
    return mockUser()
  },
  async login() {
    return mockUser()
  },
  async startDevelopmentSession() {
    return mockUser()
  },
  async logout() {
    // Mock: geen sessie om te beëindigen.
  },
  async getProcesses() {
    const concepten = useConcepten.getState().concepten
    const samengevoegd = new Map(
      fixtureProcessen
        .filter((p) => p.status === 'live')
        .map((p) => [p.id, naarSummary(p)]),
    )
    for (const c of Object.values(concepten)) {
      if (c.status === 'live') samengevoegd.set(c.id, naarSummary(c))
    }
    return [...samengevoegd.values()]
  },
  async getProcess(id) {
    const concept = useConcepten.getState().concepten[id]
    if (concept?.status === 'live') return concept
    return fixtureProcessen.find((p) => p.id === id && p.status === 'live') ?? null
  },
  async getWorkspaceProcesses() {
    const concepten = useConcepten.getState().concepten
    const samengevoegd = new Map(fixtureProcessen.map((p) => [p.id, naarSummary(p)]))
    for (const c of Object.values(concepten)) samengevoegd.set(c.id, naarSummary(c))
    return [...samengevoegd.values()]
  },
  async getWorkspaceProcess(id) {
    return useConcepten.getState().concepten[id] ?? fixtureProcessen.find((p) => p.id === id) ?? null
  },
  async saveProcess(p) {
    useConcepten.getState().opslaan(p)
    return p
  },
  async deleteProcess(id) {
    useConcepten.getState().verwijderen(id)
  },
  async getHealth(id) {
    const p = await this.getProcess(id)
    if (!p) return { score: 0, issues: [] }
    const bekend = new Set((await this.getProcesses()).map((x) => x.id))
    return controleerGezondheid(p, bekend)
  },
  async submitProcess(id) {
    const p = useConcepten.getState().concepten[id]
    if (p) useConcepten.getState().opslaan({ ...p, status: 'in-review' })
    return mockVersion(id, 'in-review')
  },
  async approveProcess(id) {
    const p = useConcepten.getState().concepten[id]
    if (p) useConcepten.getState().opslaan({ ...p, status: 'live' })
    return mockVersion(id, 'live')
  },
  async rejectProcess(id) {
    const p = useConcepten.getState().concepten[id]
    if (p) useConcepten.getState().opslaan({ ...p, status: 'concept' })
    return mockVersion(id, 'concept')
  },
  async getVersions(id) {
    const p = await this.getWorkspaceProcess(id)
    return p ? [mockVersion(id, p.status)] : []
  },
  async getDiff(id, van, naar) {
    return { procesId: id, van, naar, wijzigingen: [] }
  },
  async postSuggestion(procesId, stapId, type, tekst) {
    const s: Suggestion = {
      id: crypto.randomUUID(),
      procesId,
      stapId,
      type,
      tekst,
      doorGebruiker: mockUser().naam,
      aangemaaktOp: new Date().toISOString(),
      status: 'open',
    }
    useSuggesties.getState().indienen(s)
    return s
  },
  async getSuggestions(status) {
    const alle = useSuggesties.getState().suggesties
    return status ? alle.filter((s) => s.status === status) : alle
  },
  async resolveSuggestion(id, status) {
    useSuggesties.getState().bijwerken(id, status)
    const s = useSuggesties.getState().suggesties.find((x) => x.id === id)
    if (!s) throw new Error('Suggestie niet gevonden')
    return s
  },
  async importPdf() {
    throw new Error('PDF-import vereist de backend (start de app in API-modus).')
  },
  async getImportJob() {
    throw new Error('PDF-import vereist de backend.')
  },
  async exportLucidDiagram() {
    throw new Error('Lucid-export vereist de backend (API-modus).')
  },
  async importDiagramPackage() {
    throw new Error('Lucid/Visio-import vereist de backend (API-modus).')
  },
  async getVisioExportBlocker() {
    return {
      format: 'visio-vsdx',
      code: 'backend-required',
      message: 'Visio-export vereist een door Visio gevalideerde servertemplate.',
      requiresValidatedTemplate: true,
    }
  },
  async commitImport() {
    throw new Error('PDF-import vereist de backend.')
  },
  fileUrl() {
    return '#'
  },
  async getIsoOverview(norm) {
    const basis = isoOverviewJson as unknown as IsoOverview
    if (!norm || norm === basis.norm) return basis
    // Mock kent alleen het iso9001-voorbeeld; andere normen zijn nog leeg.
    return { norm, hoofdprocessen: [], rijen: [], signalen: [], gegenereerdOp: basis.gegenereerdOp }
  },
  isoExportUrl() {
    return '#'
  },
  async getProcessIso(id) {
    return { procesId: id, mappings: [] }
  },
  async saveProcessIso() {
    throw new Error('ISO-koppelingen opslaan vereist de backend (API-modus).')
  },
  async startAuditAssessment() {
    throw new Error('Een handmatige auditbeoordeling vereist de backend (API-modus).')
  },
  async confirmAuditAssessment() {
    throw new Error('Een auditbevestiging vereist de backend (API-modus).')
  },
  async getAssuranceFrameworks() {
    return { catalogVersion: 'mock-empty', kaders: [] }
  },
  async getAssuranceSettings() {
    throw new Error('Normenkaderinstellingen vereisen de backend (API-modus).')
  },
  async saveAssuranceSettings() {
    throw new Error('Normenkaderinstellingen vereisen de backend (API-modus).')
  },
  async getAssuranceQuestionnaires() {
    return []
  },
  async getAssuranceQuestionnaire() {
    throw new Error('De Normcoach vereist de backend (API-modus).')
  },
  async startAssuranceQuestionnaire() {
    throw new Error('De Normcoach vereist de backend (API-modus).')
  },
  async answerAssuranceQuestionnaire() {
    throw new Error('De Normcoach vereist de backend (API-modus).')
  },
  async getAssuranceMonitoringStatus() {
    throw new Error('Continue assurance vereist de backend (API-modus).')
  },
  async getAssuranceRuns() {
    return []
  },
  async startAssuranceRun() {
    throw new Error('Een assurancecontrole vereist de backend (API-modus).')
  },
  async getBackups() {
    return []
  },
  async createBackup() {
    throw new Error('Back-ups vereisen de backend (API-modus).')
  },
  backupUrl() {
    return '#'
  },
  async saveBranding() {
    throw new Error('Huisstijl opslaan vereist de backend (API-modus).')
  },
  async resetBranding() {
    throw new Error('Huisstijl vereist de backend (API-modus).')
  },
  async startChatGptOAuth() {
    throw new Error('ChatGPT-koppeling vereist de backend (API-modus).')
  },
  async getChatGptOAuthStatus() {
    return { gekoppeld: false, wachtOpCallback: false }
  },
  async logoutChatGptOAuth() {
    // mock: niets te ontkoppelen
  },
  async getBackupInstellingen() {
    return { intervalUren: 24, retentie: 14, extraDoelmap: null }
  },
  async saveBackupInstellingen() {
    throw new Error('Back-upinstellingen vereisen de backend (API-modus).')
  },
  async getMailInstellingen() {
    return { smtpHost: '', smtpPoort: 587, ssl: true, gebruiker: '', heeftWachtwoord: false, afzender: '', ontvangers: '', geconfigureerd: false }
  },
  async saveMailInstellingen() {
    throw new Error('Mailinstellingen vereisen de backend (API-modus).')
  },
  async testMail() {
    throw new Error('Mail vereist de backend (API-modus).')
  },
  async getMeldingenInstellingen() {
    return { webhookUrl: '', bijSuggestie: true, bijIndienen: true, bijGoedkeuren: true, geconfigureerd: false }
  },
  async saveMeldingenInstellingen() {
    throw new Error('Meldingen vereisen de backend (API-modus).')
  },
  async testMeldingen() {
    throw new Error('Meldingen vereisen de backend (API-modus).')
  },
  async getBcInstellingen() {
    return { tenantId: '', environment: 'production', companyId: '', clientId: '', heeftSecret: false, extraEntiteit: '', geconfigureerd: false }
  },
  async saveBcInstellingen() {
    throw new Error('Business Central-instellingen vereisen de backend (API-modus).')
  },
  async bcZoek() {
    throw new Error('Business Central is niet gekoppeld (mock-modus).')
  },
  async getEntraInstellingen() {
    return { actieveAuthMode: 'local', tenantId: '', clientId: '', groupRoleMappings: {}, wachtOpHerstart: false }
  },
  async saveEntraInstellingen() {
    throw new Error('AD/Entra-instellingen vereisen de backend (API-modus).')
  },
  async getAiInstellingen() {
    return {
      provider: 'azure-openai',
      endpoint: '',
      model: '',
      mode: 'disabled',
      heeftSleutel: false,
      geconfigureerd: false,
      activationState: 'disabled',
      credentialSource: 'none',
      storedTenantCredentialPresent: false,
      legacy: false,
      productionAllowed: true,
      canTest: false,
      managedAi: {
        available: false,
        reasonCode: 'mock-no-backend',
        nextStep: 'Start de backend om Managed AI-capabilities op te halen.',
      },
      legacyOAuth: { available: false, linked: false, productionAllowed: false },
    }
  },
  async saveAiInstellingen() {
    throw new Error('AI-instellingen opslaan vereist de backend (API-modus).')
  },
  async rotateAiCredential() {
    throw new Error('AI-credentialrotatie vereist de backend (API-modus).')
  },
  async revokeAiCredential() {
    throw new Error('AI-credential intrekken vereist de backend (API-modus).')
  },
  async testAiConnection() {
    throw new Error('AI-verbinding testen vereist de backend (API-modus).')
  },
  async askAi() {
    throw new Error(
      'De AI-assistent is niet beschikbaar in mockmodus. Start de backend en kies bij Instellingen & beheer → AI-koppeling voor Managed AI of een eigen providercredential.',
    )
  },
  async analyzeProcessMaintenance() {
    throw new Error(
      'AI-procesonderhoud vereist de backend en een expliciet geconfigureerde AI-koppeling.',
    )
  },
  async getProcessMaintenanceRuns() {
    return []
  },
  async recordProcessMaintenanceRunFeedback() {
    throw new Error('AI-runfeedback vereist de backend.')
  },
  async getAudit() {
    return []
  },
  async getAdminUsers() {
    throw new Error('Gebruikersbeheer vereist de backend.')
  },
  async createAdminUser() {
    throw new Error('Gebruikersbeheer vereist de backend.')
  },
  async updateAdminUser() {
    throw new Error('Gebruikersbeheer vereist de backend.')
  },
  async setAdminPassword() {
    throw new Error('Gebruikersbeheer vereist de backend.')
  },
}

class ApiRequestError extends Error {
  readonly status: number
  readonly code?: string

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
    this.code = code
  }
}

/** API-bron: praat met de echte backend via de Vite-proxy naar :5088. */
function createApiSource(): DataSource {
  const verzoek = async (url: string, init?: RequestInit): Promise<Response> => {
    const token = getEntraToken()
    const headers = new Headers(init?.headers)
    if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`)
    const res = await fetch(url, { credentials: 'include', ...init, headers })
    if (!res.ok) {
      let bericht = `${init?.method ?? 'GET'} ${url} → ${res.status}`
      let code: string | undefined
      try {
        const body = (await res.json()) as {
          bericht?: string
          message?: string
          code?: string
        }
        if (body.bericht || body.message) bericht = body.bericht ?? body.message ?? bericht
        code = body.code
      } catch {
        // geen JSON-body; houd de statusmelding
      }
      throw new ApiRequestError(bericht, res.status, code)
    }
    return res
  }
  const vraag = async (url: string, init?: RequestInit) => {
    const res = await verzoek(url, init)
    if (res.status === 204) return null
    return res.json()
  }
  const json = (method: string, body?: unknown): RequestInit => ({
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  return {
    heeftBackend: true,
    runtime: beschrijfRuntime('api'),
    getConfig: () => vraag('/api/config'),
    getMe: async () => {
      try {
        const res = (await vraag('/api/me')) as { user: User }
        return res.user
      } catch {
        return null
      }
    },
    login: async (gebruikersnaam, wachtwoord) => {
      try {
        const res = (await vraag('/api/auth/login', json('POST', { gebruikersnaam, wachtwoord }))) as {
          user: User
        }
        return res.user
      } catch {
        return null
      }
    },
    startDevelopmentSession: async () => {
      try {
        const res = (await vraag('/api/auth/development-session', {
          method: 'POST',
          headers: { 'X-SPG-Development-Session': '1' },
        })) as { user: User }
        return res.user
      } catch {
        return null
      }
    },
    logout: async () => {
      await vraag('/api/auth/logout', { method: 'POST' })
    },
    getProcesses: () => vraag('/api/processes'),
    getProcess: async (id) => {
      try {
        return (await vraag(`/api/processes/${id}`)) as Process
      } catch (error) {
        if (error instanceof ApiRequestError && error.status === 404) return null
        throw error
      }
    },
    getWorkspaceProcesses: () => vraag('/api/workspace/processes'),
    getWorkspaceProcess: async (id) => {
      try {
        return (await vraag(`/api/workspace/processes/${id}`)) as Process
      } catch (error) {
        if (error instanceof ApiRequestError && error.status === 404) return null
        throw error
      }
    },
    saveProcess: async (p) => {
      let bestaat = false
      try {
        await vraag(`/api/workspace/processes/${p.id}`, { method: 'GET' })
        bestaat = true
      } catch (error) {
        if (!(error instanceof ApiRequestError) || error.status !== 404) throw error
      }
      return bestaat
        ? ((await vraag(`/api/processes/${p.id}`, json('PUT', p))) as Process)
        : ((await vraag('/api/processes', json('POST', p))) as Process)
    },
    deleteProcess: async (id) => {
      await vraag(`/api/processes/${id}`, { method: 'DELETE' })
    },
    getHealth: (id) => vraag(`/api/processes/${id}/health`),
    submitProcess: (id, expectedRevision) => vraag(`/api/processes/${id}/submit`, json('POST', { expectedRevision })),
    approveProcess: (id, expectedRevision) => vraag(`/api/processes/${id}/approve`, json('POST', { expectedRevision })),
    rejectProcess: (id, expectedRevision, reden) => vraag(`/api/processes/${id}/reject`, json('POST', { expectedRevision, reden })),
    getVersions: (id) => vraag(`/api/processes/${id}/versions`),
    getDiff: (id, van, naar) => vraag(`/api/processes/${id}/diff?from=${van}&to=${naar}`),
    postSuggestion: (procesId, stapId, type, tekst) =>
      vraag(`/api/processes/${procesId}/steps/${stapId}/suggestions`, json('POST', { type, tekst })),
    getSuggestions: (status) => vraag(`/api/suggestions${status ? `?status=${status}` : ''}`),
    resolveSuggestion: (id, status) => vraag(`/api/suggestions/${id}/resolve`, json('POST', { status })),
    importPdf: async (bestand) => {
      const form = new FormData()
      form.append('bestand', bestand)
      return (await vraag('/api/import/pdf', { method: 'POST', body: form })) as ImportJob
    },
    getImportJob: (jobId) => vraag(`/api/import/${jobId}`),
    commitImport: (jobId, proces) => vraag(`/api/import/${jobId}/commit`, json('POST', proces)),
    fileUrl: (id) => `/api/files/${id}`,
    exportLucidDiagram: async (proces) => {
      const res = await verzoek('/api/diagrams/lucid/export', json('POST', proces))
      return {
        bestand: await res.blob(),
        bestandsnaam: `${proces.id || 'proces'}.lucid`,
      }
    },
    importDiagramPackage: async (format, bestand, options) => {
      const form = new FormData()
      form.append('bestand', bestand)
      const route = format === 'lucid-standard' ? 'lucid' : 'visio'
      const parameters = new URLSearchParams()
      if (format === 'visio-vsdx') {
        if (options?.pageId) parameters.set('pageId', options.pageId)
        if (options?.defaultRole) parameters.set('defaultRole', options.defaultRole)
      }
      const query = parameters.size > 0 ? `?${parameters.toString()}` : ''
      return (await vraag(`/api/diagrams/${route}/import${query}`, {
        method: 'POST',
        body: form,
      })) as DiagramPackageImportResult
    },
    getVisioExportBlocker: () => vraag('/api/diagrams/visio/export-capability'),
    getIsoOverview: (norm) => vraag(`/api/iso/overview${norm ? `?norm=${norm}` : ''}`),
    isoExportUrl: (norm) => `/api/iso/export${norm ? `?norm=${norm}` : ''}`,
    getProcessIso: (id) => vraag(`/api/processes/${id}/iso`),
    saveProcessIso: async (id, config) => {
      await vraag(`/api/processes/${id}/iso`, json('PUT', config))
    },
    startAuditAssessment: (id, kaderId) =>
      vraag(`/api/processes/${id}/audit/start`, json('POST', { kaderId })),
    confirmAuditAssessment: (id, request) =>
      vraag(`/api/processes/${id}/audit/confirmations`, json('POST', request)),
    getAssuranceFrameworks: () => vraag('/api/assurance/frameworks'),
    getAssuranceSettings: () => vraag('/api/admin/assurance-settings'),
    saveAssuranceSettings: (req) =>
      vraag('/api/admin/assurance-settings', json('PUT', req)),
    getAssuranceQuestionnaires: (frameworkId, limit) => {
      const parameters = new URLSearchParams()
      if (frameworkId) parameters.set('frameworkId', frameworkId)
      if (limit) parameters.set('limit', String(limit))
      const query = parameters.size > 0 ? `?${parameters.toString()}` : ''
      return vraag(`/api/assurance/questionnaires${query}`)
    },
    getAssuranceQuestionnaire: (sessionId) =>
      vraag(`/api/assurance/questionnaires/${encodeURIComponent(sessionId)}`),
    startAssuranceQuestionnaire: (kaderId) =>
      vraag('/api/assurance/questionnaires', json('POST', { kaderId })),
    answerAssuranceQuestionnaire: (sessionId, request) =>
      vraag(
        `/api/assurance/questionnaires/${encodeURIComponent(sessionId)}/answers`,
        json('POST', request),
      ),
    getAssuranceMonitoringStatus: () => vraag('/api/assurance/monitoring/status'),
    getAssuranceRuns: (limit) =>
      vraag(`/api/assurance/runs${limit ? `?limit=${encodeURIComponent(String(limit))}` : ''}`),
    startAssuranceRun: () => vraag('/api/assurance/runs', { method: 'POST' }),
    getBackups: () => vraag('/api/admin/backups'),
    createBackup: () => vraag('/api/admin/backups', { method: 'POST' }),
    backupUrl: (naam) => `/api/admin/backups/${encodeURIComponent(naam)}`,
    saveBranding: async (b) => {
      await vraag('/api/admin/branding', json('PUT', b))
    },
    resetBranding: async () => {
      await vraag('/api/admin/branding/reset', { method: 'POST' })
    },
    startChatGptOAuth: () => vraag('/api/admin/chatgpt-oauth/start', { method: 'POST' }),
    getChatGptOAuthStatus: () => vraag('/api/admin/chatgpt-oauth/status'),
    logoutChatGptOAuth: async () => {
      await vraag('/api/admin/chatgpt-oauth/logout', { method: 'POST' })
    },
    getBackupInstellingen: () => vraag('/api/admin/backup-instellingen'),
    saveBackupInstellingen: async (req) => {
      await vraag('/api/admin/backup-instellingen', json('PUT', req))
    },
    getMailInstellingen: () => vraag('/api/admin/mail-instellingen'),
    saveMailInstellingen: async (req) => {
      await vraag('/api/admin/mail-instellingen', json('PUT', req))
    },
    testMail: () => vraag('/api/admin/mail-instellingen/test', { method: 'POST' }),
    getMeldingenInstellingen: () => vraag('/api/admin/meldingen-instellingen'),
    saveMeldingenInstellingen: async (req) => {
      await vraag('/api/admin/meldingen-instellingen', json('PUT', req))
    },
    testMeldingen: () => vraag('/api/admin/meldingen-instellingen/test', { method: 'POST' }),
    getBcInstellingen: () => vraag('/api/admin/bc-instellingen'),
    saveBcInstellingen: async (req) => {
      await vraag('/api/admin/bc-instellingen', json('PUT', req))
    },
    bcZoek: (nummer) => vraag(`/api/bc/zoek/${encodeURIComponent(nummer)}`),
    getEntraInstellingen: () => vraag('/api/admin/entra-instellingen'),
    saveEntraInstellingen: (req) => vraag('/api/admin/entra-instellingen', json('PUT', req)),
    getAiInstellingen: async () =>
      parseAiInstellingenSnapshot(await vraag('/api/admin/ai-instellingen')),
    saveAiInstellingen: async (req) =>
      parseAiInstellingenSnapshot(
        await vraag('/api/admin/ai-instellingen', json('PUT', req)),
      ),
    rotateAiCredential: async (secret) =>
      parseAiInstellingenSnapshot(
        await vraag(
          '/api/admin/ai-instellingen/credential/rotate',
          json('POST', { secret }),
        ),
      ),
    revokeAiCredential: async () => {
      await vraag('/api/admin/ai-instellingen/credential/revoke', { method: 'POST' })
    },
    testAiConnection: async () =>
      parseAiVerbindingstest(
        await vraag('/api/admin/ai-instellingen/test', { method: 'POST' }),
      ),
    askAi: async (tekst, geschiedenis) => {
      const res = (await vraag('/api/ai/vraag', json('POST', { vraag: tekst, geschiedenis }))) as { antwoord: string }
      return res.antwoord
    },
    analyzeProcessMaintenance: async (processId, request) =>
      parseProcessMaintenanceAnalysis(
        await vraag(
          `/api/processes/${encodeURIComponent(processId)}/ai/maintenance-analysis`,
          json('POST', request),
        ),
      ),
    getProcessMaintenanceRuns: async (processId, limit) =>
      parseProcessMaintenanceRunHistory(
        await vraag(
          `/api/processes/${encodeURIComponent(processId)}/ai/runs` +
            (limit ? `?limit=${encodeURIComponent(String(limit))}` : ''),
        ),
      ),
    recordProcessMaintenanceRunFeedback: async (processId, runId, request) =>
      parseProcessMaintenanceRunLedgerItem(
        await vraag(
          `/api/processes/${encodeURIComponent(processId)}/ai/runs/` +
            `${encodeURIComponent(runId)}/feedback`,
          json('POST', request),
        ),
      ),
    getAudit: (limit) => vraag(`/api/audit${limit ? `?limit=${limit}` : ''}`),
    getAdminUsers: () => vraag('/api/admin/users'),
    createAdminUser: (req) => vraag('/api/admin/users', json('POST', req)),
    updateAdminUser: (id, req) => vraag(`/api/admin/users/${id}`, json('PUT', req)),
    setAdminPassword: (id, wachtwoord) =>
      vraag(`/api/admin/users/${id}/password`, json('POST', { wachtwoord })),
  }
}

/**
 * De normale app gebruikt altijd de echte API. De voorbeelddata worden alleen
 * geactiveerd met de expliciete lokale mockmodus (`VITE_DATA_SOURCE=mock`).
 * Een productie-build kan nooit per ongeluk met voorbeelddata worden gemaakt.
 */
const bron =
  import.meta.env.DEV && import.meta.env.VITE_DATA_SOURCE === 'mock' ? 'mock' : 'api'
export const dataSource: DataSource = bron === 'api' ? createApiSource() : mockSource
