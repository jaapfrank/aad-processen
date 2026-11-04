import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AssuranceSettingsPanel } from '../components/AssuranceSettingsPanel'
import { dataSource } from '../data'
import { useApp, useHasRole } from '../appState'
import type { Role, Suggestion, SuggestionStatus } from '../contract'
import type { AuditEntry } from '@contract/model'
import type { LocalUser, LocalUserCreateRequest } from '@contract/model'
import { BackupBeheer, EntraBeheer, BcBeheer, MeldingenBeheer, HuisstijlBeheer } from '../components/BeheerExtra'
import {
  bepaalAiBeheerweergave,
  isApiProvider,
  leesBackendRuntime,
  type AiInstellingenSnapshot,
  type AiMode,
  type AiProvider,
  type AiVerbindingstest,
} from '../lib/beheerModel'

const alleRollen: Role[] = ['kijken', 'suggesties', 'bewerken', 'goedkeuren', 'beheren']
type AiProductkeuze = AiMode | 'chatgpt-oauth'

function chatGptModelOfStandaard(model: string): string {
  const kandidaat = model.trim()
  return kandidaat.startsWith('gpt-') && !kandidaat.includes(' ') ? kandidaat : 'gpt-5.5'
}

function RollenKiezer({ waarde, onChange }: { waarde: Role[]; onChange: (r: Role[]) => void }) {
  return (
    <div className="rollen-kiezer">
      {alleRollen.map((r) => (
        <label key={r} className="rol-optie">
          <input
            type="checkbox"
            checked={waarde.includes(r)}
            onChange={(e) =>
              onChange(e.target.checked ? [...waarde, r] : waarde.filter((x) => x !== r))
            }
          />
          {r}
        </label>
      ))}
    </div>
  )
}

function GebruikersBeheer() {
  const [gebruikers, setGebruikers] = useState<LocalUser[] | null>(null)
  const [fout, setFout] = useState('')
  const [nieuw, setNieuw] = useState<LocalUserCreateRequest>({
    gebruikersnaam: '',
    naam: '',
    wachtwoord: '',
    rollen: ['kijken', 'suggesties'],
  })
  const [toonNieuw, setToonNieuw] = useState(false)

  const laad = async () => {
    try {
      setGebruikers(await dataSource.getAdminUsers())
      setFout('')
    } catch (e) {
      setGebruikers([])
      setFout(e instanceof Error ? e.message : 'Laden mislukt.')
    }
  }
  useEffect(() => {
    void dataSource
      .getAdminUsers()
      .then(setGebruikers)
      .catch((e: unknown) => {
        setGebruikers([])
        setFout(e instanceof Error ? e.message : 'Laden mislukt.')
      })
  }, [])

  const maakAan = async () => {
    setFout('')
    try {
      await dataSource.createAdminUser(nieuw)
      setToonNieuw(false)
      setNieuw({ gebruikersnaam: '', naam: '', wachtwoord: '', rollen: ['kijken', 'suggesties'] })
      await laad()
    } catch (e) {
      setFout(e instanceof Error ? e.message : 'Aanmaken mislukt.')
    }
  }

  const wijzig = async (u: LocalUser, deel: Partial<Pick<LocalUser, 'naam' | 'email' | 'rollen' | 'actief'>>) => {
    setFout('')
    try {
      await dataSource.updateAdminUser(u.id, {
        naam: deel.naam ?? u.naam,
        email: deel.email ?? u.email,
        rollen: deel.rollen ?? u.rollen,
        actief: deel.actief ?? u.actief,
      })
      await laad()
    } catch (e) {
      setFout(e instanceof Error ? e.message : 'Wijzigen mislukt.')
    }
  }

  const wachtwoord = async (u: LocalUser) => {
    const ww = window.prompt(`Nieuw wachtwoord voor ${u.gebruikersnaam}:`)
    if (!ww) return
    setFout('')
    try {
      await dataSource.setAdminPassword(u.id, ww)
    } catch (e) {
      setFout(e instanceof Error ? e.message : 'Wachtwoord wijzigen mislukt.')
    }
  }

  if (gebruikers === null) return <p className="muted">Laden…</p>

  return (
    <section>
      {fout && <p className="login-fout">{fout}</p>}
      {!dataSource.heeftBackend ? (
        <div className="empty">
          Gebruikersbeheer werkt alleen met de backend (API-modus). In mock-modus is er één
          voorbeeldgebruiker.
        </div>
      ) : (
        <>
          <table className="werkinstructie">
            <thead>
              <tr>
                <th>Gebruikersnaam</th>
                <th>Naam</th>
                <th>Rollen</th>
                <th>Actief</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {gebruikers.map((u) => (
                <tr key={u.id}>
                  <td className="stap-nr">{u.gebruikersnaam}</td>
                  <td>{u.naam}</td>
                  <td>
                    <RollenKiezer waarde={u.rollen} onChange={(rollen) => void wijzig(u, { rollen })} />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={u.actief}
                      onChange={(e) => void wijzig(u, { actief: e.target.checked })}
                    />
                  </td>
                  <td>
                    <button className="btn-tekst" onClick={() => void wachtwoord(u)}>
                      🔑 wachtwoord
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {toonNieuw ? (
            <div className="be-blok nieuw-gebruiker">
              <h2>Nieuwe gebruiker</h2>
              <div className="be-form">
                <label>
                  Gebruikersnaam
                  <input
                    value={nieuw.gebruikersnaam}
                    onChange={(e) => setNieuw({ ...nieuw, gebruikersnaam: e.target.value })}
                  />
                </label>
                <label>
                  Naam
                  <input value={nieuw.naam} onChange={(e) => setNieuw({ ...nieuw, naam: e.target.value })} />
                </label>
                <label>
                  E-mail (optioneel)
                  <input
                    value={nieuw.email ?? ''}
                    onChange={(e) => setNieuw({ ...nieuw, email: e.target.value || undefined })}
                  />
                </label>
                <label>
                  Wachtwoord
                  <input
                    type="password"
                    value={nieuw.wachtwoord}
                    onChange={(e) => setNieuw({ ...nieuw, wachtwoord: e.target.value })}
                  />
                </label>
              </div>
              <RollenKiezer waarde={nieuw.rollen} onChange={(rollen) => setNieuw({ ...nieuw, rollen })} />
              <div className="bm-acties">
                <button
                  className="btn-primair"
                  disabled={!nieuw.gebruikersnaam || !nieuw.naam || !nieuw.wachtwoord}
                  onClick={() => void maakAan()}
                >
                  Aanmaken
                </button>
                <button className="btn-tekst" onClick={() => setToonNieuw(false)}>
                  Annuleren
                </button>
              </div>
            </div>
          ) : (
            <button className="btn-secundair" onClick={() => setToonNieuw(true)}>
              + Nieuwe gebruiker
            </button>
          )}
        </>
      )}
    </section>
  )
}

const suggestieLabel: Record<string, string> = {
  'klopt-niet': 'Klopt niet',
  mist: 'Mist iets',
  onduidelijk: 'Onduidelijk',
  'werkt-anders': 'Werkt anders',
}

function SuggestieBeheer() {
  const [items, setItems] = useState<Suggestion[] | null>(null)
  const [filter, setFilter] = useState<SuggestionStatus | ''>('open')
  const [fout, setFout] = useState('')

  const laad = async (f: SuggestionStatus | '') => {
    try {
      setItems(await dataSource.getSuggestions(f || undefined))
      setFout('')
    } catch (e) {
      setItems([])
      setFout(e instanceof Error ? e.message : 'Laden mislukt.')
    }
  }
  useEffect(() => {
    void dataSource
      .getSuggestions(filter || undefined)
      .then(setItems)
      .catch((e: unknown) => {
        setItems([])
        setFout(e instanceof Error ? e.message : 'Laden mislukt.')
      })
  }, [filter])

  const afhandelen = async (s: Suggestion, status: SuggestionStatus) => {
    try {
      await dataSource.resolveSuggestion(s.id, status)
      await laad(filter)
    } catch (e) {
      setFout(e instanceof Error ? e.message : 'Afhandelen mislukt.')
    }
  }

  if (items === null) return <p className="muted">Laden…</p>

  return (
    <section>
      <div className="bm-acties">
        <select className="rol-filter" value={filter} onChange={(e) => setFilter(e.target.value as SuggestionStatus | '')}>
          <option value="">Alle statussen</option>
          <option value="open">Open</option>
          <option value="in-behandeling">In behandeling</option>
          <option value="verwerkt">Verwerkt</option>
          <option value="afgewezen">Afgewezen</option>
        </select>
      </div>
      {fout && <p className="login-fout">{fout}</p>}
      {items.length === 0 ? (
        <div className="empty">Geen suggesties{filter ? ` met status "${filter}"` : ''}.</div>
      ) : (
        <table className="werkinstructie">
          <thead>
            <tr>
              <th>Proces / stap</th>
              <th>Type</th>
              <th>Suggestie</th>
              <th>Door</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((s) => (
              <tr key={s.id}>
                <td>
                  <Link to={`/proces/${s.procesId}`}>{s.procesId}</Link>
                  {s.stapId && <div className="zij">stap {s.stapId}</div>}
                </td>
                <td>
                  <span className="type-tag">{suggestieLabel[s.type] ?? s.type}</span>
                </td>
                <td>{s.tekst}</td>
                <td>{s.doorGebruiker}</td>
                <td>
                  <span className={`pill ${s.status === 'open' ? 'pill-in-review' : 'pill-concept'}`}>{s.status}</span>
                </td>
                <td>
                  {(s.status === 'open' || s.status === 'in-behandeling') && (
                    <span className="be-stap-knoppen">
                      <button title="Verwerkt" onClick={() => void afhandelen(s, 'verwerkt')}>✅</button>
                      <button title="Afwijzen" onClick={() => void afhandelen(s, 'afgewezen')}>❌</button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

const auditActieLabel: Record<string, string> = {
  'audit.review.start': 'Handmatige beoordeling gestart',
  'audit.confirmation.record': 'Beoordeling vastgelegd',
  'iso.update': 'ISO-koppeling bijgewerkt',
}

function leesAuditDetails(details?: string | null): Record<string, unknown> | null {
  if (!details) return null
  try {
    const parsed = JSON.parse(details) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function auditBewijsSamenvatting(entry: AuditEntry): string {
  const details = leesAuditDetails(entry.details)
  if (entry.actie === 'audit.review.start') {
    const kader = typeof details?.kaderId === 'string' ? details.kaderId : 'onbekend kader'
    const revisie =
      typeof details?.processRevision === 'number' ? details.processRevision : 'onbekend'
    return `${kader} · procesrevisie ${revisie} · menselijke triage, geen certificering`
  }
  if (entry.actie === 'audit.confirmation.record') {
    const kader = typeof details?.kaderId === 'string' ? details.kaderId : 'onbekend kader'
    const controle =
      typeof details?.controleId === 'string' ? details.controleId : 'onbekende controle'
    const uitkomst =
      typeof details?.uitkomst === 'string' ? details.uitkomst : 'onbekende uitkomst'
    const bewijs =
      typeof details?.bewijsreferentie === 'string' && details.bewijsreferentie.trim()
        ? ` · bewijs ${details.bewijsreferentie}`
        : ' · geen bewijsreferentie'
    const revisie =
      typeof details?.processRevision === 'number' ? details.processRevision : 'onbekend'
    return `${kader} / ${controle} · ${uitkomst}${bewijs} · procesrevisie ${revisie}`
  }
  return details ? 'Wijzigingsdetails zijn in de auditlog geregistreerd.' : '—'
}

function AuditLog() {
  const [items, setItems] = useState<AuditEntry[] | null>(null)
  const [fout, setFout] = useState('')

  useEffect(() => {
    void dataSource
      .getAudit(200)
      .then(setItems)
      .catch((e: unknown) => {
        setItems([])
        setFout(e instanceof Error ? e.message : 'Laden mislukt.')
      })
  }, [])

  if (items === null) return <p className="muted">Laden…</p>

  return (
    <section className="audit-log">
      <h2>Auditlog &amp; menselijke beoordelingen</h2>
      <p className="muted">
        Actor en tijd komen van de server. Een kaderbeoordeling legt triage en bewijs vast, maar is
        geen certificeringsbesluit.
      </p>
      {fout && <p className="login-fout">{fout}</p>}
      {!dataSource.heeftBackend ? (
        <div className="empty">De audit-log wordt door de backend bijgehouden (API-modus).</div>
      ) : items.length === 0 ? (
        <div className="empty">Nog geen audit-regels.</div>
      ) : (
        <table className="werkinstructie">
          <thead>
            <tr>
              <th>Wanneer</th>
              <th>Wie</th>
              <th>Actie</th>
              <th>Doel</th>
              <th>Resultaat / bewijs</th>
            </tr>
          </thead>
          <tbody>
            {items.map((e) => (
              <tr key={e.id}>
                <td>{new Date(e.op).toLocaleString('nl-NL')}</td>
                <td>{e.doorGebruiker}</td>
                <td>
                  <span className="type-tag">{auditActieLabel[e.actie] ?? e.actie}</span>
                </td>
                <td>{e.entiteitType} · {e.entiteitId}</td>
                <td className="audit-bewijs">{auditBewijsSamenvatting(e)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

function RuntimeBeheer() {
  const { config } = useApp()
  const runtime = dataSource.runtime
  const backendRuntime = leesBackendRuntime(config)
  const runtimeContractOntbreekt = runtime.heeftBackend && !backendRuntime
  const runtimeIsDemo = runtime.gebruiktVoorbeelddata || backendRuntime?.isDemo === true
  const runtimeLabel = runtime.gebruiktVoorbeelddata
    ? runtime.label
    : backendRuntime?.isDemo
      ? 'Geïsoleerde backenddemo met synthetische data'
      : runtime.label
  const runtimeBeschrijving = runtime.gebruiktVoorbeelddata
    ? runtime.beschrijving
    : backendRuntime?.isDemo
      ? 'Expliciet deploymentprofiel met backend en demo-fixtures; geen impliciete fallback.'
      : runtime.beschrijving

  return (
    <section className="be-blok nieuw-gebruiker runtime-beheer">
      <h2>Omgeving</h2>
      <div
        className={`runtime-source-panel ${runtimeIsDemo ? 'mock' : 'api'}`}
        role="status"
        aria-label={`Actieve gegevensbron: ${runtimeLabel}`}
      >
        <strong>{runtimeLabel} actief</strong>
        <span>{runtimeBeschrijving}</span>
      </div>

      <dl className="runtime-details">
        <div>
          <dt>Gegevensbron</dt>
          <dd>
            {backendRuntime?.dataSource === 'demo-fixtures'
              ? 'Backend demo-fixtures'
              : backendRuntime?.dataSource === 'database'
                ? 'Backenddatabase'
                : runtime.korteLabel}
          </dd>
        </div>
        <div>
          <dt>Backend</dt>
          <dd>{runtime.heeftBackend ? 'Verbonden via API' : 'Niet gebruikt'}</dd>
        </div>
        <div>
          <dt>Authenticatie</dt>
          <dd>
            {config ? (config.authMode === 'entra' ? 'Microsoft Entra ID' : 'Lokaal') : 'Onbekend'}
          </dd>
        </div>
        <div>
          <dt>Opslag</dt>
          <dd>
            {config ? (config.storage === 'db' ? 'Database' : 'Lokale opslag') : 'Onbekend'}
          </dd>
        </div>
        <div>
          <dt>Tenanttype</dt>
          <dd>{backendRuntime?.tenantType ?? (runtime.heeftBackend ? 'Onbekend' : 'Geen tenant')}</dd>
        </div>
        <div>
          <dt>Runtimeprofiel</dt>
          <dd>
            {backendRuntime
              ? `${backendRuntime.profile} · ${backendRuntime.mode} · ${backendRuntime.environment}`
              : 'Alleen lokale buildconfiguratie bekend'}
          </dd>
        </div>
      </dl>

      {runtimeContractOntbreekt && (
        <p className="login-fout" role="alert">
          De backend levert nog geen geldig runtimeprofiel. De frontend schakelt niet terug naar
          mockdata; tenant- en demostatus blijven onbekend.
        </p>
      )}
      <aside className="runtime-contract-note">
        <strong>Geen tenant-schakelaar</strong>
        <p>
          Deze pagina is alleen-lezen. Een beheerder kan een productieomgeving hier niet naar
          mockdata omzetten. Een verkoopbare klantdemo hoort een echte, geïsoleerde tenant met
          backend te zijn; deze lokale mockmodus is uitsluitend voor ontwikkeling en regressietests.
        </p>
      </aside>
    </section>
  )
}

function AiInstellingen() {
  const heeftBackend = dataSource.heeftBackend
  const [vorm, setVorm] = useState<{
    provider: AiProvider
    endpoint: string
    apiKey: string
    model: string
    mode: AiMode
  }>({ provider: 'azure-openai', endpoint: '', apiKey: '', model: '', mode: 'disabled' })
  const [status, setStatus] = useState<AiInstellingenSnapshot | null>(null)
  const [verbindingstest, setVerbindingstest] = useState<AiVerbindingstest | null>(null)
  const [melding, setMelding] = useState('')
  const [laadFout, setLaadFout] = useState('')
  const [laadstatus, setLaadstatus] = useState<
    'niet-beschikbaar' | 'laden' | 'klaar' | 'fout'
  >(heeftBackend ? 'laden' : 'niet-beschikbaar')
  const [oauth, setOauth] = useState<{
    gekoppeld: boolean
    accountId?: string
    wachtOpCallback: boolean
  } | null>(null)
  const [koppelen, setKoppelen] = useState(false)
  const [opslaanBezig, setOpslaanBezig] = useState(false)
  const [testenBezig, setTestenBezig] = useState(false)
  const [intrekkenBezig, setIntrekkenBezig] = useState(false)
  const lokaleOauthBeschikbaar = status?.legacyOAuth.available === true

  const laadAiInstellingen = useCallback(async () => {
    if (!heeftBackend) {
      setLaadstatus('niet-beschikbaar')
      return
    }
    setLaadstatus('laden')
    setLaadFout('')
    try {
      const opgeslagen = await dataSource.getAiInstellingen()
      setVorm({
        provider:
          opgeslagen.provider === 'disabled' || opgeslagen.provider === 'invalid'
            ? 'azure-openai'
            : opgeslagen.provider,
        endpoint: opgeslagen.endpoint,
        apiKey: '',
        model: opgeslagen.model,
        mode: opgeslagen.mode,
      })
      setStatus(opgeslagen)
      setLaadstatus('klaar')
    } catch (e) {
      setStatus(null)
      setLaadstatus('fout')
      setLaadFout(e instanceof Error ? e.message : 'AI-instellingen laden mislukt.')
    }
  }, [heeftBackend])

  const laadOauth = useCallback(async () => {
    if (!lokaleOauthBeschikbaar) {
      setOauth(null)
      return
    }
    try {
      setOauth(await dataSource.getChatGptOAuthStatus())
    } catch {
      setOauth(null)
    }
  }, [lokaleOauthBeschikbaar])

  useEffect(() => {
    if (!heeftBackend) return
    void dataSource
      .getAiInstellingen()
      .then((opgeslagen) => {
        setVorm({
          provider:
            opgeslagen.provider === 'disabled' || opgeslagen.provider === 'invalid'
              ? 'azure-openai'
              : opgeslagen.provider,
          endpoint: opgeslagen.endpoint,
          apiKey: '',
          model: opgeslagen.model,
          mode: opgeslagen.mode,
        })
        setStatus(opgeslagen)
        setLaadstatus('klaar')
      })
      .catch((e: unknown) => {
        setStatus(null)
        setLaadstatus('fout')
        setLaadFout(e instanceof Error ? e.message : 'AI-instellingen laden mislukt.')
      })
  }, [heeftBackend])

  useEffect(() => {
    if (!lokaleOauthBeschikbaar) return
    void dataSource
      .getChatGptOAuthStatus()
      .then(setOauth)
      .catch(() => setOauth(null))
  }, [lokaleOauthBeschikbaar])

  // De lokale OAuth-callback komt buiten het huidige browservenster binnen; poll tot hij bevestigd is.
  useEffect(() => {
    if (!lokaleOauthBeschikbaar || !koppelen) return
    let controles = 0
    let opeenvolgendeFouten = 0
    let afgerond = false
    const timer = setInterval(() => {
      if (afgerond) return
      controles += 1
      if (controles > 150) {
        afgerond = true
        setKoppelen(false)
        setMelding('De koppelpoging is na vijf minuten verlopen. Probeer opnieuw.')
        return
      }
      void dataSource
        .getChatGptOAuthStatus()
        .then((s) => {
          opeenvolgendeFouten = 0
          setOauth(s)
          if (!s.gekoppeld) return
          afgerond = true
          setKoppelen(false)
          void dataSource
            .saveAiInstellingen({
              provider: 'chatgpt',
              model: chatGptModelOfStandaard(vorm.model),
              mode: 'byo',
            })
            .then(laadAiInstellingen)
            .then(() =>
              setMelding(
                'Inloggen met ChatGPT is gelukt. Het lokale account en de providerinstellingen zijn opgeslagen.',
              ),
            )
            .catch((e: unknown) =>
              setMelding(
                e instanceof Error
                  ? e.message
                  : 'De lokale OAuth-sessie is aanwezig, maar de provider kon niet worden opgeslagen.',
              ),
            )
        })
        .catch(() => {
          opeenvolgendeFouten += 1
          if (opeenvolgendeFouten < 3) return
          afgerond = true
          setKoppelen(false)
          setMelding('De koppelstatus kon niet worden opgehaald. Controleer de backend en probeer opnieuw.')
        })
    }, 2000)
    return () => clearInterval(timer)
  }, [koppelen, laadAiInstellingen, lokaleOauthBeschikbaar, vorm.model])

  const koppelChatGpt = async () => {
    if (!lokaleOauthBeschikbaar) return
    setMelding('')
    setKoppelen(true)
    try {
      const { authorizationUrl } = await dataSource.startChatGptOAuth()
      window.open(authorizationUrl, '_blank', 'noopener')
      setMelding(
        'Rond het inloggen met ChatGPT af in het geopende venster. Deze pagina herkent de koppeling daarna automatisch.',
      )
    } catch (e) {
      setKoppelen(false)
      setMelding(e instanceof Error ? e.message : 'Koppelen starten mislukt.')
    }
  }

  const opslaan = async () => {
    if (
      !heeftBackend ||
      laadstatus !== 'klaar' ||
      (vorm.mode === 'managed' && status?.managedAi.available !== true)
    ) {
      return
    }
    setMelding('')
    setOpslaanBezig(true)
    setVerbindingstest(null)
    const nieuweSleutel =
      vorm.mode === 'byo' && isApiProvider(vorm.provider) ? vorm.apiKey.trim() : ''
    // Een credential blijft alleen zo lang als nodig in invoerstate staan en
    // wordt ook bij een mislukte request niet opnieuw in de DOM gezet.
    setVorm((huidig) => ({ ...huidig, apiKey: '' }))
    try {
      await dataSource.saveAiInstellingen({
        mode: vorm.mode,
        provider: vorm.mode === 'disabled' ? undefined : vorm.provider,
        endpoint:
          vorm.mode !== 'disabled' && vorm.provider === 'azure-openai'
            ? vorm.endpoint.trim()
            : undefined,
        model: vorm.mode === 'disabled' ? undefined : vorm.model.trim(),
        apiKey: nieuweSleutel || undefined,
      })
      await laadAiInstellingen()
      setMelding(
        vorm.mode === 'disabled'
          ? 'AI is persistent uitgeschakeld. Nieuwe AI-aanroepen worden door de backend geweigerd.'
          : vorm.mode === 'managed'
            ? 'Managed AI is geactiveerd met het centrale platformprofiel. Test de verbinding voordat je de status als verbonden beschouwt.'
          : vorm.provider === 'chatgpt'
            ? 'De instellingen voor het gekoppelde ChatGPT-account zijn opgeslagen.'
          : `${nieuweSleutel ? 'Credential veilig vervangen en configuratie opgeslagen.' : 'Configuratie opgeslagen; bestaande credential behouden.'} Test de verbinding voordat je de status als verbonden beschouwt.`,
      )
    } catch (e) {
      setMelding(e instanceof Error ? e.message : 'Opslaan mislukt.')
    } finally {
      setOpslaanBezig(false)
    }
  }

  const testVerbinding = async () => {
    if (
      !status?.canTest ||
      status.activationState !== 'active' ||
      vorm.mode !== status.mode ||
      vorm.provider !== status.provider ||
      vorm.model.trim() !== status.model ||
      (vorm.provider === 'azure-openai' && vorm.endpoint.trim() !== status.endpoint)
    ) {
      return
    }
    setMelding('')
    setTestenBezig(true)
    setVerbindingstest(null)
    try {
      const resultaat = await dataSource.testAiConnection()
      setVerbindingstest(resultaat)
      setMelding('Verbinding server-side getest. Provider en model reageerden succesvol.')
    } catch (e) {
      setMelding(e instanceof Error ? e.message : 'Verbindingstest mislukt.')
    } finally {
      setTestenBezig(false)
    }
  }

  const trekCredentialIn = async () => {
    if (!status?.storedTenantCredentialPresent) return
    if (
      !window.confirm(
        'Credential intrekken? De AI-configuratie wordt direct fail-closed en kan pas na een nieuwe credential weer actief worden.',
      )
    ) {
      return
    }
    setMelding('')
    setIntrekkenBezig(true)
    setVerbindingstest(null)
    try {
      await dataSource.revokeAiCredential()
      await laadAiInstellingen()
      setMelding(
        'Opgeslagen organisatiecredential verwijderd. Een centraal platformcredential is niet gewijzigd.',
      )
    } catch (e) {
      setMelding(e instanceof Error ? e.message : 'Credential intrekken mislukt.')
    } finally {
      setIntrekkenBezig(false)
    }
  }

  const ontkoppelChatGpt = async () => {
    if (!lokaleOauthBeschikbaar) return
    setMelding('')
    try {
      await dataSource.logoutChatGptOAuth()
      await laadOauth()
      await laadAiInstellingen()
      setMelding(
        'Uitloggen is gelukt. Het ChatGPT-account is niet meer aan deze lokale installatie gekoppeld.',
      )
    } catch (e) {
      setMelding(e instanceof Error ? e.message : 'Ontkoppelen mislukt.')
    }
  }

  const weergave = bepaalAiBeheerweergave(status, verbindingstest)
  const formulierKlaar = heeftBackend && laadstatus === 'klaar' && !opslaanBezig
  const managedBeschikbaar = status?.managedAi.available === true
  const isChatGptOauthModus = vorm.mode === 'byo' && vorm.provider === 'chatgpt'
  const chatGptGekoppeld = oauth?.gekoppeld ?? status?.legacyOAuth.linked === true
  const geselecteerdeProductmodus: AiProductkeuze = isChatGptOauthModus
    ? 'chatgpt-oauth'
    : vorm.mode
  const bestaandeSleutelPast =
    status?.storedTenantCredentialPresent === true &&
    status.storedTenantCredentialProvider === vorm.provider &&
    isApiProvider(vorm.provider)
  const heeftVereisteVelden =
    vorm.mode === 'disabled' ||
    (vorm.mode === 'managed' && managedBeschikbaar) ||
    (isChatGptOauthModus &&
      lokaleOauthBeschikbaar &&
      chatGptGekoppeld &&
      vorm.model.trim().length > 0) ||
    (vorm.mode === 'byo' &&
      isApiProvider(vorm.provider) &&
      vorm.model.trim().length > 0 &&
      (vorm.provider !== 'azure-openai' || vorm.endpoint.trim().length > 0) &&
      (Boolean(bestaandeSleutelPast) || vorm.apiKey.trim().length > 0))
  const kanOpslaan = formulierKlaar && heeftVereisteVelden
  const configuratieOngewijzigd =
    status != null &&
    vorm.mode === status.mode &&
    vorm.provider === status.provider &&
    vorm.model.trim() === status.model &&
    (vorm.provider !== 'azure-openai' || vorm.endpoint.trim() === status.endpoint) &&
    vorm.apiKey.length === 0

  return (
    <section className="be-blok nieuw-gebruiker ai-instellingen">
      <h2>AI-koppeling</h2>
      {!heeftBackend && <p className="ai-mode-banner mock">Demoomgeving: externe koppelingen zijn hier niet beschikbaar.</p>}

      <div className="ai-status-grid" aria-label="AI-configuratiestatus">
        <div>
          <span>Huidige modus</span>
          <strong>{weergave.modusLabel}</strong>
        </div>
        <div>
          <span>Status</span>
          <strong className={`ai-status ${weergave.status}`}>{weergave.statusLabel}</strong>
        </div>
        <div>
          <span>Toegang</span>
          <strong>
            {status?.provider === 'chatgpt'
              ? status.legacyOAuth.linked
                ? 'ChatGPT-account gekoppeld'
                : 'ChatGPT-account niet gekoppeld'
              : status?.storedTenantCredentialPresent && !status.heeftSleutel
                ? `Organisatiecredential voor ${status.storedTenantCredentialProvider ?? 'onbekende provider'} opgeslagen · huidige modus gebruikt hem niet`
              : status?.credentialSource === 'server-configuration' && status.heeftSleutel
                ? 'Platformcredential · niet terugleesbaar'
              : status?.heeftSleutel
                ? status.credentialFingerprint ?? 'Geregistreerd · niet terugleesbaar'
                : 'Ontbreekt'}
          </strong>
        </div>
        <div>
          <span>Verbindingstest</span>
          <strong>
            {verbindingstest
              ? new Date(verbindingstest.testedAt).toLocaleString('nl-NL')
              : status?.canTest
                ? 'Nog uitvoeren'
                : 'Niet beschikbaar voor huidige configuratie'}
          </strong>
        </div>
      </div>
      <p className="muted ai-status-uitleg">{weergave.toelichting}</p>
      {status?.credentialUpdatedAt && (
        <p className="muted ai-status-uitleg">
          Laatste credentialrotatie:{' '}
          {new Date(status.credentialUpdatedAt).toLocaleString('nl-NL')} · bron:{' '}
          {status.credentialSource === 'tenant-protected'
            ? 'organisatiecredential'
            : status.credentialSource === 'server-configuration'
              ? 'platformconfiguratie'
              : status.credentialSource}
        </p>
      )}

      <h3>Hoe wil je AI gebruiken?</h3>
      <div className="ai-productmodi">
        {(
          [
            ['disabled', 'Uit', 'Geen AI-functies gebruiken.'],
            ['managed', 'Centraal geregeld', 'De beheerder verzorgt de AI-toegang.'],
            ['byo', 'Eigen API-sleutel', 'Verbind de AI-provider van je organisatie.'],
            [
              'chatgpt-oauth',
              'ChatGPT-account (OAuth)',
              'Lokaal inloggen met een ChatGPT-account, zonder API-sleutel.',
            ],
          ] as const
        ).map(([productmodus, label, uitleg]) => {
          const nietBeschikbaar =
            (productmodus === 'managed' && !managedBeschikbaar) ||
            (productmodus === 'chatgpt-oauth' && !lokaleOauthBeschikbaar)
          const uitgeschakeld = !formulierKlaar || nietBeschikbaar
          return (
            <label
              key={productmodus}
              className={[
                geselecteerdeProductmodus === productmodus ? 'actief' : '',
                nietBeschikbaar ? 'niet-beschikbaar' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              aria-disabled={uitgeschakeld}
              title={
                nietBeschikbaar
                  ? productmodus === 'managed'
                    ? status?.managedAi.nextStep || 'Managed AI is niet ingericht.'
                    : 'Deze OAuth-koppeling is alleen beschikbaar in een expliciet toegestane lokale installatie.'
                  : undefined
              }
            >
              <input
                type="radio"
                name="ai-mode"
                value={productmodus}
                checked={geselecteerdeProductmodus === productmodus}
                disabled={uitgeschakeld}
                onChange={() => {
                  if (nietBeschikbaar) return
                  if (productmodus === 'chatgpt-oauth') {
                    setVorm({
                      ...vorm,
                      mode: 'byo',
                      provider: 'chatgpt',
                      endpoint: '',
                      apiKey: '',
                      model: chatGptModelOfStandaard(vorm.model),
                    })
                  } else if (productmodus === 'byo') {
                    setVorm({
                      ...vorm,
                      mode: 'byo',
                      provider: isApiProvider(vorm.provider)
                        ? vorm.provider
                        : status?.storedTenantCredentialProvider ?? 'openai',
                      apiKey: '',
                    })
                  } else {
                    setVorm({ ...vorm, mode: productmodus, apiKey: '' })
                  }
                  setVerbindingstest(null)
                }}
              />
              <strong>{label}</strong>
              <span>{uitleg}</span>
              <em>
                {productmodus === 'managed'
                  ? managedBeschikbaar
                    ? 'Beschikbaar'
                    : 'Niet beschikbaar'
                  : productmodus === 'chatgpt-oauth'
                    ? lokaleOauthBeschikbaar
                      ? chatGptGekoppeld
                        ? 'Gekoppeld'
                        : 'Lokaal beschikbaar'
                      : 'Niet beschikbaar'
                  : 'Ondersteund'}
              </em>
            </label>
          )
        })}
      </div>
      {status && !managedBeschikbaar && vorm.mode === 'managed' && (
        <div className="ai-managed-unavailable" role="note">
          <strong>Managed AI is in deze omgeving niet ingericht.</strong>
          <span>{status.managedAi.nextStep}</span>
          <small>
            Je kunt AI uit laten, een eigen providercredential gebruiken
            {lokaleOauthBeschikbaar ? ' of in deze lokale installatie met ChatGPT inloggen.' : '.'}
          </small>
        </div>
      )}

      {laadstatus === 'laden' && <p className="muted">AI-instellingen laden…</p>}
      {laadstatus === 'fout' && (
        <div className="ai-load-error" role="alert">
          <strong>Configuratie is vergrendeld.</strong>
          <span>{laadFout}</span>
          <button className="btn-secundair" type="button" onClick={() => void laadAiInstellingen()}>
            Opnieuw laden
          </button>
        </div>
      )}

      <h3>{isChatGptOauthModus ? 'ChatGPT-account' : 'Providerconfiguratie'}</h3>
      {vorm.mode === 'managed' ? (
        <div className="ai-platformprofiel">
          <strong>Centraal platformprofiel</strong>
          <span>
            Provider, model, endpoint en credential worden door de platformbeheerder vastgesteld
            en zijn hier niet te wijzigen.
          </span>
          <small>
            {managedBeschikbaar
              ? `Profiel beschikbaar${status?.provider && status.provider !== 'disabled' ? ` · ${status.provider} · ${status.model}` : ''}.`
              : status?.managedAi.nextStep ?? 'Laat een platformbeheerder Managed AI inrichten.'}
          </small>
        </div>
      ) : vorm.mode === 'disabled' ? (
        <p className="muted">
          AI staat uit. Kies een andere productmodus om een provider of ChatGPT-account in te
          stellen.
        </p>
      ) : !isChatGptOauthModus ? (
        <p className="muted">
          Je opgeslagen sleutel blijft verborgen. Laat het veld leeg om de bestaande sleutel te behouden.
        </p>
      ) : null}
      {vorm.mode === 'byo' && !isChatGptOauthModus && (
        <div className="be-form">
          <label>
            Provider
            <select
              value={vorm.provider}
              disabled={!formulierKlaar}
              onChange={(e) => {
                setVorm({ ...vorm, provider: e.target.value as AiProvider, apiKey: '' })
                setVerbindingstest(null)
              }}
            >
              <option value="azure-openai">Azure OpenAI (aanbevolen)</option>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic (Claude)</option>
            </select>
          </label>
          <label>
            Model / deployment
            <input
              value={vorm.model}
              disabled={!formulierKlaar}
              placeholder="door beheer vastgesteld model/deployment"
              onChange={(e) => {
                setVorm({ ...vorm, model: e.target.value })
                setVerbindingstest(null)
              }}
            />
          </label>
          {vorm.provider === 'azure-openai' && (
            <label className="breed">
              Azure-endpoint
              <input
                value={vorm.endpoint}
                disabled={!formulierKlaar}
                placeholder="https://<resource>.openai.azure.com"
                onChange={(e) => {
                  setVorm({ ...vorm, endpoint: e.target.value })
                  setVerbindingstest(null)
                }}
              />
            </label>
          )}
          <label className="breed">
            {bestaandeSleutelPast ? 'Nieuwe API-sleutel (optioneel)' : 'API-sleutel'}
            <input
              type="password"
              value={vorm.apiKey}
              autoComplete="new-password"
              spellCheck={false}
              disabled={!formulierKlaar}
              placeholder={
                bestaandeSleutelPast
                  ? 'Leeg laten om de huidige sleutel te behouden'
                  : 'Voer je API-sleutel in'
              }
              onChange={(e) => {
                setVorm({ ...vorm, apiKey: e.target.value })
                setVerbindingstest(null)
              }}
            />
          </label>
        </div>
      )}
      {vorm.mode === 'byo' && vorm.provider === 'openai' && (
        <p className="muted">
          Nog geen sleutel?{' '}
          <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">
            API-sleutel maken in OpenAI Platform ↗
          </a>
        </p>
      )}

      {isChatGptOauthModus && !lokaleOauthBeschikbaar && (
        <p className="login-fout" role="alert">
          ChatGPT-accountkoppeling is niet beschikbaar in deze omgeving. Deze modus moet door de
          installatiebeheerder expliciet voor lokaal gebruik zijn toegestaan.
        </p>
      )}

      {isChatGptOauthModus && lokaleOauthBeschikbaar && (
        <div className="be-blok oauth-blok">
          <strong className="oauth-label">Lokale accountkoppeling</strong>
          <p className="muted">
            Gebruik je ChatGPT-account op deze computer. Voor een gehoste bedrijfsomgeving kies je
            een eigen API-sleutel of centraal geregelde toegang.
          </p>
          <label className="oauth-model">
            Model
            <input
              value={vorm.model}
              disabled={!formulierKlaar}
              placeholder="gpt-5.5"
              onChange={(e) => {
                setVorm({ ...vorm, model: e.target.value })
                setVerbindingstest(null)
              }}
            />
          </label>
          {chatGptGekoppeld ? (
            <div className="bm-acties">
              <span className="pill pill-live">
                Verbonden met ChatGPT
                {oauth?.accountId ? ` · account ${oauth.accountId.slice(0, 8)}…` : ''}
              </span>
              <button
                className="btn-secundair"
                disabled={laadstatus !== 'klaar'}
                onClick={() => void ontkoppelChatGpt()}
              >
                Uitloggen
              </button>
            </div>
          ) : (
            <div className="bm-acties">
              <button
                className="btn-primair"
                disabled={laadstatus !== 'klaar' || koppelen}
                onClick={() => void koppelChatGpt()}
              >
                {koppelen ? 'Wachten op ChatGPT…' : 'Inloggen met ChatGPT'}
              </button>
              {koppelen && <span className="muted">Rond het inloggen af in het geopende venster…</span>}
            </div>
          )}
        </div>
      )}
      <div className="bm-acties">
        <button
          className="btn-primair"
          disabled={!kanOpslaan}
          title={
            vorm.mode === 'managed' && !managedBeschikbaar
              ? status?.managedAi.nextStep
              : undefined
          }
          onClick={() => void opslaan()}
        >
          {opslaanBezig
            ? 'Opslaan…'
            : vorm.mode === 'disabled'
              ? 'AI uitschakelen'
              : isChatGptOauthModus
                ? 'ChatGPT-instellingen opslaan'
              : vorm.apiKey.trim()
                ? status?.heeftSleutel
                  ? 'Credential vervangen en opslaan'
                  : 'Credential registreren en opslaan'
                : 'Configuratie opslaan'}
        </button>
        <button
          className="btn-secundair"
          type="button"
          disabled={
            !status?.canTest ||
            status.activationState !== 'active' ||
            !configuratieOngewijzigd ||
            testenBezig ||
            opslaanBezig
          }
          onClick={() => void testVerbinding()}
        >
          {testenBezig ? 'Verbinding testen…' : 'Verbinding testen'}
        </button>
        {!isChatGptOauthModus && (
          <button
            className="btn-secundair"
            type="button"
            disabled={
              !status?.storedTenantCredentialPresent ||
              intrekkenBezig ||
              opslaanBezig
            }
            title={
              !status?.storedTenantCredentialPresent &&
              status?.credentialSource === 'server-configuration'
                ? 'Een centraal platformcredential kan niet vanuit de tenant worden ingetrokken.'
                : undefined
            }
            onClick={() => void trekCredentialIn()}
          >
            {intrekkenBezig
              ? 'Organisatiecredential verwijderen…'
              : 'Opgeslagen organisatiecredential verwijderen'}
          </button>
        )}
        {melding && <span className="muted">{melding}</span>}
      </div>
      <p className="ai-contract-gap">
        <strong>Veiligheidsgrens:</strong>{' '}
        {isChatGptOauthModus
          ? 'OAuth-tokens blijven versleuteld op de lokale backend en worden nooit naar de browser teruggestuurd. De accountstatus wordt verbonden na een bevestigde OAuth-callback; de aparte verbindingstest controleert ook een echte modelaanroep.'
          : 'secrets worden alleen write-only verzonden en nooit teruggelezen. Een API-providerconfiguratie wordt pas als verbonden getoond nadat de server-side test in deze beheersessie is geslaagd.'}{' '}
        Beleid, budgetten en modelrouting volgen in een latere sprint.
      </p>
    </section>
  )
}

function AiToegangGeblokkeerd() {
  return (
    <section className="be-blok nieuw-gebruiker ai-instellingen ai-vergrendeld">
      <h2>🔒 AI-providerbeheer</h2>
      <p>
        Voor het instellen van OpenAI, Azure OpenAI, Anthropic of de lokale ChatGPT/Codex-koppeling
        is de rol <strong>beheren</strong> vereist.
      </p>
      <p className="muted">
        Je kunt de AI-assistent wel gebruiken zodra een beheerder de organisatiekoppeling heeft
        ingesteld. Vraag een beheerder om deze pagina te openen met een beheeraccount.
      </p>
      <div className={`ai-mode-banner ${dataSource.heeftBackend ? 'api' : 'mock'}`}>
        <strong>
          {dataSource.heeftBackend ? 'Backend-API actief' : 'Lokale demo met mockdata actief'}
        </strong>
        {!dataSource.heeftBackend && (
          <span> In deze lokale mockmodus zijn externe koppelingen niet beschikbaar.</span>
        )}
      </div>
    </section>
  )
}

type BeheerTab =
  | 'runtime'
  | 'normen'
  | 'suggesties'
  | 'gebruikers'
  | 'audit'
  | 'ai'
  | 'backups'
  | 'entra'
  | 'bc'
  | 'meldingen'
  | 'huisstijl'

const beheerTabs: BeheerTab[] = [
  'runtime',
  'normen',
  'suggesties',
  'gebruikers',
  'audit',
  'ai',
  'backups',
  'entra',
  'bc',
  'meldingen',
  'huisstijl',
]

function isBeheerTab(waarde: string | null): waarde is BeheerTab {
  return waarde !== null && beheerTabs.includes(waarde as BeheerTab)
}

export function Beheer() {
  const { config } = useApp()
  const magBeheren = useHasRole('beheren')
  const magBewerken = useHasRole('bewerken')
  const [zoekParameters, setZoekParameters] = useSearchParams()
  const tabUitUrl = zoekParameters.get('tab')
  const urlTabToegankelijk =
    isBeheerTab(tabUitUrl) &&
    (tabUitUrl === 'runtime' ||
      tabUitUrl === 'ai' ||
      (tabUitUrl === 'suggesties' && magBewerken) ||
      (magBeheren && (tabUitUrl !== 'gebruikers' || config?.authMode === 'local')))
  const tab: BeheerTab = urlTabToegankelijk ? tabUitUrl : 'runtime'
  const setTab = (volgende: BeheerTab) =>
    setZoekParameters({ tab: volgende }, { replace: true })

  const onderdelen: [BeheerTab, string][] = [
    ['runtime', 'Omgeving'],
    ...(magBeheren ? [['normen', 'Normenkaders']] as [BeheerTab, string][] : []),
    ['ai', '🤖 AI-koppeling' + (!magBeheren ? ' 🔒' : '')],
    ...(magBewerken ? [['suggesties', '💬 Suggesties']] as [BeheerTab, string][] : []),
    ...(magBeheren && config?.authMode === 'local' ? [['gebruikers', '👥 Gebruikers']] as [BeheerTab, string][] : []),
    ...(magBeheren ? [
      ['audit', '📜 Audit-log'], ['backups', '💾 Back-ups'], ['entra', '🔐 AD/Entra'],
      ['bc', '🔗 Business Central'], ['meldingen', '🔔 Meldingen'], ['huisstijl', '🎨 Huisstijl'],
    ] as [BeheerTab, string][] : []),
  ]

  if (!magBeheren && !magBewerken)
    return <div className="empty">Je hebt geen beheer- of redactierechten.</div>

  return (
    <div>
      <h1>Instellingen</h1>
      <p className="muted beheer-intro">
        Beheer gebruikers, normen, AI en de inrichting van je organisatie.
      </p>
      <label className="beheer-mobiel-keuze" htmlFor="beheer-onderdeel">
        Onderdeel
        <select id="beheer-onderdeel" aria-label="Onderdeel" value={tab} onChange={(event) => setTab(event.target.value as BeheerTab)}>
          {onderdelen.map(([waarde, label]) => <option key={waarde} value={waarde}>{label}</option>)}
        </select>
      </label>
      <div className="view-toggle beheer-tabs" aria-label="Instellingenonderdelen">
        {onderdelen.map(([waarde, label]) => (
          <button key={waarde} className={tab === waarde ? 'active' : ''} aria-pressed={tab === waarde} onClick={() => setTab(waarde)}>{label}</button>
        ))}
      </div>
      {tab === 'runtime' ? (
        <RuntimeBeheer />
      ) : tab === 'normen' && magBeheren ? (
        <AssuranceSettingsPanel />
      ) : tab === 'huisstijl' && magBeheren ? (
        <HuisstijlBeheer />
      ) : tab === 'meldingen' && magBeheren ? (
        <MeldingenBeheer />
      ) : tab === 'bc' && magBeheren ? (
        <BcBeheer />
      ) : tab === 'backups' && magBeheren ? (
        <BackupBeheer />
      ) : tab === 'entra' && magBeheren ? (
        <EntraBeheer />
      ) : tab === 'ai' ? (
        magBeheren ? <AiInstellingen /> : <AiToegangGeblokkeerd />
      ) : tab === 'audit' && magBeheren ? (
        <AuditLog />
      ) : tab === 'suggesties' && magBewerken ? (
        <SuggestieBeheer />
      ) : (
        <GebruikersBeheer />
      )}
    </div>
  )
}
