import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type {
  AuditBeoordelingStart,
  AuditBevestiging,
  AuditBevestigingRequest,
  AuditBevestigingUitkomst,
  IsoProcessConfig,
} from '@contract/iso'
import { useHasRole } from '../appState'
import type { Process } from '../contract'
import { dataSource } from '../data'
import {
  AUDIT_CONTROL_CATALOG_VERSION,
  isHandmatigeCataloguscontrole,
} from '../lib/auditControlCatalog'
import {
  PROCES_KADERS,
  controleerProcesTegenKader,
  type KaderControle,
  type KaderControleStatus,
  type ProcesKaderId,
  type ProcesKaderRapport,
} from '../lib/procesKaders'
import './ProceskaderScan.css'

type ProcesScope = 'alle' | string
type KaderScope = 'alle' | ProcesKaderId

const statusLabel: Record<KaderControleStatus, string> = {
  gevonden: 'Gevonden',
  aandacht: 'Aandacht',
  handmatig: 'Menselijke beoordeling nodig',
}

const statusIcoon: Record<KaderControleStatus, string> = {
  gevonden: '✓',
  aandacht: '!',
  handmatig: '?',
}

const uitkomstLabel: Record<AuditBevestigingUitkomst, string> = {
  voldoet: 'Voldoet volgens beoordelaar',
  'actie-nodig': 'Actie nodig',
  'niet-van-toepassing': 'Niet van toepassing',
}

function scoreKlasse(score: number): string {
  if (score >= 80) return 'goed'
  if (score >= 60) return 'redelijk'
  return 'laag'
}

function HandmatigeBeoordeling({
  controle,
  bevestiging,
  processRevision,
  kanBevestigen,
  onBevestigen,
}: {
  controle: KaderControle
  bevestiging?: AuditBevestiging
  processRevision: number
  kanBevestigen: boolean
  onBevestigen: (request: Pick<
    AuditBevestigingRequest,
    'uitkomst' | 'toelichting' | 'bewijsreferentie'
  >) => Promise<void>
}) {
  const [uitkomst, setUitkomst] = useState<AuditBevestigingUitkomst | ''>('')
  const [bewijsreferentie, setBewijsreferentie] = useState('')
  const [toelichting, setToelichting] = useState('')
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState('')
  const actueel = bevestiging?.processRevision === processRevision
  const formulierGeldig =
    uitkomst !== '' &&
    toelichting.trim().length >= 10 &&
    (uitkomst !== 'voldoet' || bewijsreferentie.trim().length > 0)

  const bevestig = async () => {
    if (!kanBevestigen || !formulierGeldig || !uitkomst) return
    setBezig(true)
    setFout('')
    try {
      await onBevestigen({
        uitkomst,
        toelichting: toelichting.trim(),
        bewijsreferentie: bewijsreferentie.trim() || undefined,
      })
      setUitkomst('')
      setBewijsreferentie('')
      setToelichting('')
    } catch (error) {
      setFout(
        error instanceof Error
          ? error.message
          : 'De handmatige beoordeling kon niet worden vastgelegd.',
      )
    } finally {
      setBezig(false)
    }
  }

  return (
    <div className="pk-handmatig">
      {bevestiging && (
        <div className={`pk-bevestiging ${actueel ? bevestiging.uitkomst : 'vervallen'}`}>
          <strong>
            {actueel
              ? uitkomstLabel[bevestiging.uitkomst]
              : `Eerdere beoordeling vervallen na proceswijziging (revisie ${bevestiging.processRevision})`}
          </strong>
          <span>
            {bevestiging.bevestigdDoor} ·{' '}
            {new Date(bevestiging.bevestigdOp).toLocaleString('nl-NL')} · procesrevisie{' '}
            {bevestiging.processRevision}
          </span>
          <span>
            <b>Assessment:</b> {bevestiging.assessmentId.slice(0, 12)}… · catalogus{' '}
            {bevestiging.catalogVersion}
          </span>
          {bevestiging.bewijsreferentie && (
            <span>
              <b>Bewijsreferentie:</b> {bevestiging.bewijsreferentie}
            </span>
          )}
          <span>
            <b>Toelichting:</b> {bevestiging.toelichting}
          </span>
          {!actueel && (
            <span>Beoordeel deze controle opnieuw tegen de actuele procesrevisie.</span>
          )}
        </div>
      )}

      {kanBevestigen ? (
        <div className="pk-beoordelingsformulier">
          <strong>Menselijke triage voor “{controle.titel}”</strong>
          <p>
            Leg je oordeel, onderbouwing en waar nodig bewijs vast. Dit is traceerbare
            auditinformatie, geen certificering.
          </p>
          <div className="pk-beoordelingsvelden">
            <label>
              Uitkomst
              <select
                value={uitkomst}
                disabled={bezig}
                onChange={(event) =>
                  setUitkomst(event.target.value as AuditBevestigingUitkomst | '')
                }
              >
                <option value="">Kies een uitkomst…</option>
                <option value="voldoet">Voldoet volgens mijn beoordeling</option>
                <option value="actie-nodig">Actie nodig</option>
                <option value="niet-van-toepassing">Niet van toepassing</option>
              </select>
            </label>
            <label>
              Bewijsreferentie{uitkomst === 'voldoet' ? ' (verplicht)' : ' (optioneel)'}
              <input
                value={bewijsreferentie}
                disabled={bezig}
                maxLength={500}
                placeholder="Bijv. document-id, URL, ticket of dossierpad"
                onChange={(event) => setBewijsreferentie(event.target.value)}
              />
            </label>
            <label className="breed">
              Toelichting (minimaal 10 tekens)
              <textarea
                value={toelichting}
                disabled={bezig}
                minLength={10}
                maxLength={2000}
                placeholder="Wat heb je beoordeeld en waarom leidt dat tot deze uitkomst?"
                onChange={(event) => setToelichting(event.target.value)}
              />
            </label>
          </div>
          {fout && <p className="pk-fout" role="alert">{fout}</p>}
          <button
            type="button"
            className="btn-primair klein"
            disabled={!formulierGeldig || bezig}
            onClick={() => void bevestig()}
          >
            {bezig ? 'Beoordeling vastleggen…' : 'Beoordeling met actor, tijd en revisie vastleggen'}
          </button>
        </div>
      ) : (
        !actueel && (
          <p className="pk-handmatig-hint">
            Start bovenaan eerst een handmatige beoordeling voor dit kader. Daarna kun je deze
            controle triëren en onderbouwd bevestigen.
          </p>
        )
      )}
    </div>
  )
}

function KaderResultaat({
  rapport,
  standaardOpen,
  bevestigingen,
  processRevision,
  beoordeling,
  kanProcesWijzigen,
  onBevestigen,
}: {
  rapport: ProcesKaderRapport
  standaardOpen: boolean
  bevestigingen: AuditBevestiging[]
  processRevision: number
  beoordeling?: AuditBeoordelingStart
  kanProcesWijzigen: boolean
  onBevestigen: (request: AuditBevestigingRequest) => Promise<void>
}) {
  const kanBevestigen =
    beoordeling?.kaderId === rapport.kader.id &&
    beoordeling.processRevision === processRevision &&
    beoordeling.catalogVersion === AUDIT_CONTROL_CATALOG_VERSION

  return (
    <details className="pk-resultaat" open={standaardOpen}>
      <summary>
        <span>
          <strong>{rapport.kader.naam}</strong>
          <small>{rapport.kader.editie} · {rapport.kader.domein}</small>
        </span>
        <span
          className={`pk-score ${scoreKlasse(rapport.score)}`}
          aria-label={`${rapport.score} procent modeldekking`}
        >
          {rapport.score}%
        </span>
      </summary>

      <div className="pk-resultaat-inhoud">
        <div className="pk-tellingen" aria-label="Samenvatting controles">
          <span className="gevonden">✓ {rapport.gevonden} gevonden</span>
          <span className="aandacht">! {rapport.aandacht} aandacht</span>
          <span className="handmatig">? {rapport.handmatig} menselijk te beoordelen</span>
        </div>

        <ul className="pk-controles">
          {rapport.controles.map((controle) => (
            <li key={controle.id} className={`pk-controle ${controle.status}`}>
              <span className="pk-controle-icoon" aria-hidden="true">
                {statusIcoon[controle.status]}
              </span>
              <div>
                <div className="pk-controle-kop">
                  <strong>{controle.titel}</strong>
                  <span>{controle.categorie} · {statusLabel[controle.status]}</span>
                </div>
                <p>{controle.bevinding}</p>
                {controle.advies && <p className="pk-advies">Volgende stap: {controle.advies}</p>}
                {controle.status === 'handmatig' && (
                  <HandmatigeBeoordeling
                    controle={controle}
                    bevestiging={bevestigingen.find(
                      (item) =>
                        item.kaderId.toLowerCase() === rapport.kader.id &&
                        item.controleId.toLowerCase() === controle.id.toLowerCase(),
                    )}
                    processRevision={processRevision}
                    kanBevestigen={
                      kanBevestigen &&
                      isHandmatigeCataloguscontrole(
                        rapport.kader.id,
                        controle.id,
                      )
                    }
                    onBevestigen={(request) =>
                      onBevestigen({
                        ...request,
                        assessmentId: beoordeling!.assessmentId,
                        expectedRevision: processRevision,
                        kaderId: rapport.kader.id,
                        controleId: controle.id,
                      })
                    }
                  />
                )}
                {kanProcesWijzigen && controle.status !== 'gevonden' && (
                  <Link
                    className="pk-editoractie"
                    to={`/bouwer/${encodeURIComponent(rapport.procesId)}?${new URLSearchParams({
                      kader: rapport.kader.id,
                      controle: controle.id,
                      ...(controle.stapIds?.[0] ? { stap: controle.stapIds[0] } : {}),
                    }).toString()}`}
                    aria-label={`Open bevinding ${controle.titel} in de proceseditor`}
                  >
                    ⚑ Open {(controle.stapIds?.length ?? 0) === 0
                      ? 'procesbevinding'
                      : controle.stapIds!.length === 1
                        ? 'gekoppelde stap'
                        : `${controle.stapIds!.length} gekoppelde stappen`} in editor
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>

        <p className="pk-bron">
          Editie en status gecontroleerd op {rapport.kader.bronGecontroleerdOp.split('-').reverse().join('-')}.{' '}
          <a href={rapport.kader.bronUrl} target="_blank" rel="noreferrer">
            Open de officiële {rapport.kader.bronOrganisatie}-bron ↗
          </a>
        </p>
      </div>
    </details>
  )
}

export function ProceskaderScan({
  actieveKaderIds,
}: {
  actieveKaderIds?: readonly string[]
}) {
  const magBewerken = useHasRole('bewerken')
  const magGoedkeuren = useHasRole('goedkeuren')
  const magBeheren = useHasRole('beheren')
  const magBeoordelen = magBewerken || magGoedkeuren || magBeheren
  const magProcesWijzigen = magBewerken || magBeheren
  const [processen, setProcessen] = useState<Process[]>([])
  const [procesScope, setProcesScope] = useState<ProcesScope>('alle')
  const [gekozenKaderScope, setKaderScope] = useState<KaderScope>('alle')
  const [laden, setLaden] = useState(true)
  const [fout, setFout] = useState<string>()
  const [isoResultaat, setIsoResultaat] = useState<{
    procesId: string
    config: IsoProcessConfig | null
    fout?: string
  }>()
  const [beoordeling, setBeoordeling] = useState<AuditBeoordelingStart>()
  const [beoordelingBezig, setBeoordelingBezig] = useState(false)
  const [beoordelingMelding, setBeoordelingMelding] = useState<{
    procesId: string
    kaderId: ProcesKaderId
    tekst: string
  }>()
  const beschikbareKaders = useMemo(() => {
    if (!actieveKaderIds) return [...PROCES_KADERS]
    const actief = new Set(actieveKaderIds.map((id) => id.toLowerCase()))
    return PROCES_KADERS.filter((kader) => actief.has(kader.id))
  }, [actieveKaderIds])

  const kaderScope: KaderScope = beschikbareKaders.some((kader) => kader.id === gekozenKaderScope)
    ? gekozenKaderScope : 'alle'

  useEffect(() => {
    let actief = true
    void dataSource
      .getWorkspaceProcesses()
      .then(async (samenvattingen) => {
        const geladenProcessen = await Promise.all(
          samenvattingen.map((proces) => dataSource.getWorkspaceProcess(proces.id)),
        )
        if (!actief) return
        setProcessen(
          geladenProcessen
            .filter((proces): proces is Process => Boolean(proces))
            .sort((a, b) => a.detailproces.localeCompare(b.detailproces, 'nl-NL')),
        )
      })
      .catch((error: unknown) => {
        if (actief) {
          setFout(error instanceof Error ? error.message : 'De processen konden niet worden geladen.')
        }
      })
      .finally(() => {
        if (actief) setLaden(false)
      })
    return () => {
      actief = false
    }
  }, [])

  useEffect(() => {
    if (procesScope === 'alle') return
    let actief = true
    void dataSource
      .getProcessIso(procesScope)
      .then((config) => {
        if (actief) setIsoResultaat({ procesId: procesScope, config })
      })
      .catch((error: unknown) => {
        if (actief) {
          setIsoResultaat({
            procesId: procesScope,
            config: null,
            fout:
              error instanceof Error
                ? error.message
                : 'De bestaande auditbeoordelingen konden niet worden geladen.',
          })
        }
      })
    return () => {
      actief = false
    }
  }, [procesScope])

  const kaders = useMemo(
    () =>
      kaderScope === 'alle'
        ? beschikbareKaders
        : beschikbareKaders.filter((kader) => kader.id === kaderScope),
    [beschikbareKaders, kaderScope],
  )

  const rapporten = useMemo(
    () =>
      processen.flatMap((proces) =>
        kaders.map((kader) => controleerProcesTegenKader(proces, kader.id)),
      ),
    [processen, kaders],
  )

  const geselecteerdProces =
    procesScope === 'alle'
      ? undefined
      : processen.find((proces) => proces.id === procesScope)
  const geselecteerdeRapporten = geselecteerdProces
    ? rapporten.filter((rapport) => rapport.procesId === geselecteerdProces.id)
    : []
  const processRevision = geselecteerdProces?.revision ?? 1
  const isoConfig =
    geselecteerdProces && isoResultaat?.procesId === geselecteerdProces.id
      ? isoResultaat.config
      : null
  const isoLaden = Boolean(
    geselecteerdProces && isoResultaat?.procesId !== geselecteerdProces.id,
  )
  const actieveBeoordeling =
    geselecteerdProces &&
    kaderScope !== 'alle' &&
    beoordeling?.procesId === geselecteerdProces.id &&
    beoordeling.kaderId === kaderScope
      ? beoordeling
      : undefined
  const actieveBeoordelingMelding =
    geselecteerdProces &&
    kaderScope !== 'alle' &&
    beoordelingMelding?.procesId === geselecteerdProces.id &&
    beoordelingMelding.kaderId === kaderScope
      ? beoordelingMelding.tekst
      : ''

  const startBeoordeling = async () => {
    if (
      !geselecteerdProces ||
      kaderScope === 'alle' ||
      !dataSource.heeftBackend ||
      !magBeoordelen
    ) {
      return
    }
    setBeoordelingBezig(true)
    setBeoordelingMelding(undefined)
    try {
      const gestart = await dataSource.startAuditAssessment(
        geselecteerdProces.id,
        kaderScope,
      )
      setBeoordeling(gestart)
      setBeoordelingMelding({
        procesId: gestart.procesId,
        kaderId: gestart.kaderId as ProcesKaderId,
        tekst: `Beoordeling gestart door ${gestart.gestartDoor} op ${new Date(gestart.gestartOp).toLocaleString('nl-NL')} voor procesrevisie ${gestart.processRevision}.`,
      })
    } catch (error) {
      setBeoordelingMelding({
        procesId: geselecteerdProces.id,
        kaderId: kaderScope,
        tekst:
          error instanceof Error
            ? error.message
            : 'De handmatige beoordeling kon niet starten.',
      })
    } finally {
      setBeoordelingBezig(false)
    }
  }

  const bevestigControle = async (request: AuditBevestigingRequest) => {
    if (!geselecteerdProces) return
    const bevestiging = await dataSource.confirmAuditAssessment(
      geselecteerdProces.id,
      request,
    )
    setIsoResultaat((huidig) => {
      const config =
        huidig?.procesId === geselecteerdProces.id ? huidig.config : null
      return {
        procesId: geselecteerdProces.id,
        config: {
          procesId: geselecteerdProces.id,
          mappings: config?.mappings ?? [],
          governance: config?.governance,
          auditBevestigingen: [
            ...(config?.auditBevestigingen ?? []).filter(
              (item) =>
                item.kaderId.toLowerCase() !== bevestiging.kaderId.toLowerCase() ||
                item.controleId.toLowerCase() !== bevestiging.controleId.toLowerCase(),
            ),
            bevestiging,
          ],
        },
      }
    })
    setBeoordelingMelding({
      procesId: geselecteerdProces.id,
      kaderId: bevestiging.kaderId as ProcesKaderId,
      tekst: `Beoordeling vastgelegd door ${bevestiging.bevestigdDoor} op ${new Date(bevestiging.bevestigdOp).toLocaleString('nl-NL')} voor procesrevisie ${bevestiging.processRevision}.`,
    })
  }

  return (
    <section className="be-blok pk-scan" aria-labelledby="pk-titel">
      <div className="pk-kop">
        <div>
          <h2 id="pk-titel">Proceskader-controle</h2>
          <p>
            Controleer of processen aansluiten op jullie gekozen normen.
          </p>
        </div>
        {!laden && (
          <span className="pk-bereik">
            {processen.length} processen · {beschikbareKaders.length} kaders in scope
          </span>
        )}
      </div>

      <div className="pk-uitleg" role="note">
        De scan toont mogelijke aandachtspunten. Een inhoudelijke beoordeling en bewijs uit de praktijk blijven nodig.
      </div>

      <div className="pk-filters">
        <label>
          Bereik
          <select
            value={procesScope}
            onChange={(event) => setProcesScope(event.target.value)}
            disabled={laden}
          >
            <option value="alle">Alle processen — overzicht</option>
            {processen.map((proces) => (
              <option key={proces.id} value={proces.id}>
                {proces.detailproces}
              </option>
            ))}
          </select>
        </label>
        <label>
          Kader
          <select
            value={kaderScope}
            onChange={(event) => setKaderScope(event.target.value as KaderScope)}
          >
            <option value="alle">Alle {beschikbareKaders.length} proceskaders in scope</option>
            {beschikbareKaders.map((kader) => (
              <option key={kader.id} value={kader.id}>
                {kader.naam} — {kader.domein}
              </option>
            ))}
          </select>
        </label>
      </div>

      {laden && <p className="muted">Procesmodellen controleren…</p>}
      {fout && (
        <p className="pk-fout" role="alert">
          Controle mislukt: {fout}
        </p>
      )}
      {!laden && !fout && beschikbareKaders.length === 0 && (
        <p className="empty">
          De gekozen kaders hebben nog geen automatische procesmodelscan. Gebruik de Normcoach
          voor de organisatiebrede toets of activeer in Instellingen een ondersteund ISO- of
          BPMN-proceskader.
        </p>
      )}
      {!laden && !fout && processen.length === 0 && (
        <p className="empty">Er zijn nog geen werkprocessen om te controleren.</p>
      )}

      {!laden &&
        !fout &&
        beschikbareKaders.length > 0 &&
        processen.length > 0 &&
        procesScope === 'alle' && (
        <>
          <div className="pk-kaderkaarten">
            {kaders.map((kader) => {
              const regels = rapporten.filter((rapport) => rapport.kader.id === kader.id)
              const gemiddelde = Math.round(
                regels.reduce((totaal, rapport) => totaal + rapport.score, 0) /
                  Math.max(regels.length, 1),
              )
              const aandacht = regels.reduce(
                (totaal, rapport) => totaal + rapport.aandacht,
                0,
              )
              const handmatig = regels.reduce(
                (totaal, rapport) => totaal + rapport.handmatig,
                0,
              )
              return (
                <button
                  key={kader.id}
                  type="button"
                  className="pk-kaderkaart"
                  onClick={() => setKaderScope(kader.id)}
                  title={`Toon alleen ${kader.naam}`}
                >
                  <span>
                    <strong>{kader.naam}</strong>
                    <small>{kader.editie}</small>
                  </span>
                  <span className={`pk-score ${scoreKlasse(gemiddelde)}`}>{gemiddelde}%</span>
                  <em>
                    {aandacht} aandacht · {handmatig} menselijk te beoordelen
                  </em>
                </button>
              )
            })}
          </div>

          <div className="pk-matrix-wrap">
            <table className="pk-matrix">
              <thead>
                <tr>
                  <th>Proces</th>
                  {kaders.map((kader) => <th key={kader.id}>{kader.naam}</th>)}
                </tr>
              </thead>
              <tbody>
                {processen.map((proces) => (
                  <tr key={proces.id}>
                    <th>
                      <button type="button" onClick={() => setProcesScope(proces.id)}>
                        {proces.detailproces}
                      </button>
                      <small>{proces.status} · {proces.versie}</small>
                    </th>
                    {kaders.map((kader) => {
                      const rapport = rapporten.find(
                        (item) =>
                          item.procesId === proces.id && item.kader.id === kader.id,
                      )
                      return (
                        <td key={kader.id}>
                          {rapport && (
                            <button
                              type="button"
                              className={`pk-matrix-score ${scoreKlasse(rapport.score)}`}
                              onClick={() => {
                                setProcesScope(proces.id)
                                setKaderScope(kader.id)
                              }}
                              aria-label={`${proces.detailproces}, ${kader.naam}: ${rapport.score} procent modeldekking, ${rapport.aandacht} aandachtspunten`}
                            >
                              {rapport.score}%
                              <small>
                                {rapport.aandacht} aandacht · {rapport.handmatig} menselijk
                              </small>
                            </button>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="pk-score-uitleg">
            Modeldekking is het aandeel automatisch controleerbare signalen dat in het procesmodel
            is gevonden. Handmatige beoordelingen tellen niet mee in dit percentage.
          </p>
        </>
      )}

      {!laden && !fout && beschikbareKaders.length > 0 && geselecteerdProces && (
        <>
          <div className="pk-proceskop">
            <div>
              <button type="button" className="pk-terug" onClick={() => setProcesScope('alle')}>
                ← Alle processen
              </button>
              <h3>{geselecteerdProces.detailproces}</h3>
              <span>{geselecteerdProces.status} · {geselecteerdProces.versie}</span>
            </div>
            <div className="pk-procesacties">
              <button
                className="btn-primair klein"
                type="button"
                disabled={
                  kaderScope === 'alle' ||
                  beoordelingBezig ||
                  !dataSource.heeftBackend ||
                  !magBeoordelen
                }
                title={
                  kaderScope === 'alle'
                    ? 'Kies eerst één kader.'
                    : !dataSource.heeftBackend
                      ? 'Handmatige beoordelingen vereisen de backend-API.'
                      : !magBeoordelen
                        ? 'De rol bewerken, goedkeuren of beheren is vereist.'
                        : undefined
                }
                onClick={() => void startBeoordeling()}
              >
                {kaderScope === 'alle'
                  ? 'Kies eerst één kader'
                  : beoordelingBezig
                    ? 'Beoordeling starten…'
                    : actieveBeoordeling
                      ? 'Beoordeling opnieuw starten'
                      : 'Start handmatige beoordeling'}
              </button>
              <Link className="btn-secundair klein" to={`/proces/${geselecteerdProces.id}`}>
                Bekijken
              </Link>
              {magProcesWijzigen && (
                <Link
                  className="btn-secundair klein"
                  to={`/bouwer/${geselecteerdProces.id}${
                    kaderScope === 'alle'
                      ? ''
                      : `?${new URLSearchParams({ kader: kaderScope }).toString()}`
                  }`}
                >
                  Aandachtspunten oplossen
                </Link>
              )}
            </div>
          </div>
          <div className="pk-auditstatus" role="status">
            <strong>Handmatige audittriage</strong>
            <span>
              {kaderScope === 'alle'
                ? 'Kies één kader om controles traceerbaar te beoordelen.'
                : actieveBeoordeling
                  ? `${actieveBeoordelingMelding} Assessment ${actieveBeoordeling.assessmentId.slice(0, 12)}… verloopt op ${new Date(actieveBeoordeling.verlooptOp).toLocaleString('nl-NL')}; catalogus ${actieveBeoordeling.catalogVersion}. Dit is geen certificeringsbesluit.`
                  : actieveBeoordelingMelding ||
                    'Start de beoordeling om uitkomst, uitleg en bewijs per handmatige controle vast te leggen. Dit is geen certificeringsbesluit.'}
            </span>
          </div>
          {isoLaden && <p className="muted">Eerdere beoordelingen laden…</p>}
          {geselecteerdProces &&
            isoResultaat?.procesId === geselecteerdProces.id &&
            isoResultaat.fout && (
              <p className="pk-fout" role="alert">{isoResultaat.fout}</p>
            )}

          <div className="pk-resultaten">
            {geselecteerdeRapporten.map((rapport) => (
              <KaderResultaat
                key={rapport.kader.id}
                rapport={rapport}
                standaardOpen={geselecteerdeRapporten.length === 1}
                bevestigingen={isoConfig?.auditBevestigingen ?? []}
                processRevision={processRevision}
                beoordeling={actieveBeoordeling}
                kanProcesWijzigen={magProcesWijzigen}
                onBevestigen={bevestigControle}
              />
            ))}
          </div>
        </>
      )}
    </section>
  )
}
