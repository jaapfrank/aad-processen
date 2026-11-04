import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ProcessSummary } from '../contract'
import type {
  AssuranceFramework,
  AssuranceFrameworkCatalog,
  AssuranceQuestionnaire,
  AssuranceQuestionnaireAnswerRequest,
  AssuranceQuestionnaireOutcome,
} from '@contract/assurance'
import { dataSource } from '../data'
import { useHasRole } from '../appState'
import './Normcoach.css'

const uitkomstOpties: ReadonlyArray<{
  waarde: AssuranceQuestionnaireOutcome
  label: string
  uitleg: string
}> = [
  {
    waarde: 'ja',
    label: 'Ja',
    uitleg: 'De inrichting bestaat; voeg een controleerbare bewijsreferentie toe.',
  },
  {
    waarde: 'deels',
    label: 'Gedeeltelijk',
    uitleg: 'Een deel is ingericht, maar er ontbreekt nog iets.',
  },
  {
    waarde: 'nee',
    label: 'Nee',
    uitleg: 'Dit is nog niet ingericht of aantoonbaar uitgevoerd.',
  },
  {
    waarde: 'onbekend',
    label: 'Onbekend',
    uitleg: 'Er is eerst aanvullende informatie of een eigenaar nodig.',
  },
  {
    waarde: 'nvt',
    label: 'Niet van toepassing',
    uitleg: 'Dit blijft een gemotiveerd voorstel dat formele beoordeling kan vereisen.',
  },
]

function datumTijd(waarde: string | null | undefined): string {
  if (!waarde) return '—'
  const datum = new Date(waarde)
  return Number.isNaN(datum.getTime()) ? waarde : datum.toLocaleString('nl-NL')
}

function eersteOpenVraagIndex(questionnaire: AssuranceQuestionnaire): number {
  const beantwoord = new Set(questionnaire.antwoorden.map((antwoord) => antwoord.vraagId))
  const index = questionnaire.vragen.findIndex((vraag) => !beantwoord.has(vraag.id))
  return index >= 0 ? index : 0
}

function isAfgerond(questionnaire: AssuranceQuestionnaire): boolean {
  return ['gereed', 'afgerond', 'completed', 'gesloten'].includes(
    questionnaire.status.trim().toLowerCase(),
  )
}

function vervangQuestionnaire(
  questionnaires: AssuranceQuestionnaire[],
  bijgewerkt: AssuranceQuestionnaire,
): AssuranceQuestionnaire[] {
  const resultaat = questionnaires.filter(
    (questionnaire) => questionnaire.sessionId !== bijgewerkt.sessionId,
  )
  resultaat.push(bijgewerkt)
  return resultaat.sort(
    (a, b) => new Date(b.gestartOp).getTime() - new Date(a.gestartOp).getTime(),
  )
}

function Kaderkaart({
  kader,
  openQuestionnaire,
  bezig,
  onStart,
  onHervat,
}: {
  kader: AssuranceFramework
  openQuestionnaire?: AssuranceQuestionnaire
  bezig: boolean
  onStart: (kaderId: string) => Promise<void>
  onHervat: (questionnaire: AssuranceQuestionnaire) => void
}) {
  return (
    <article className="nc-kaderkaart">
      <div className="nc-kaderkaart-kop">
        <div>
          <span className="nc-kadertype">{kader.type}</span>
          <h3>{kader.naam}</h3>
          <p>{kader.domein}</p>
        </div>
        <span className="pill pill-live">Actief</span>
      </div>
      <dl className="nc-kadermeta">
        <div>
          <dt>Editie</dt>
          <dd>{kader.editie}</dd>
        </div>
        <div>
          <dt>Vragen</dt>
          <dd>{kader.vragen.length}</dd>
        </div>
      </dl>
      <p className="nc-bron">
        Bron gecontroleerd op {kader.bronGecontroleerdOp}.{' '}
        <a href={kader.bronUrl} target="_blank" rel="noreferrer">
          Open bron bij {kader.bronOrganisatie} ↗
        </a>
      </p>
      {openQuestionnaire ? (
        <button
          type="button"
          className="btn-primair"
          onClick={() => onHervat(openQuestionnaire)}
        >
          Hervat normtoets
        </button>
      ) : (
        <button
          type="button"
          className="btn-primair"
          disabled={bezig}
          onClick={() => void onStart(kader.id)}
        >
          {bezig ? 'Normtoets starten…' : 'Start normtoets'}
        </button>
      )}
    </article>
  )
}

export function Normcoach() {
  const navigate = useNavigate()
  const magBewerken = useHasRole('bewerken')
  const magGoedkeuren = useHasRole('goedkeuren')
  const magBeheren = useHasRole('beheren')
  const magReviewen = magBewerken || magGoedkeuren || magBeheren
  const magProcesWijzigen = magBewerken || magBeheren
  const [catalogus, setCatalogus] = useState<AssuranceFrameworkCatalog>()
  const [questionnaires, setQuestionnaires] = useState<AssuranceQuestionnaire[]>([])
  const [processen, setProcessen] = useState<ProcessSummary[]>([])
  const [actieProcesId, setActieProcesId] = useState('')
  const [geselecteerdeSessionId, setGeselecteerdeSessionId] = useState<string>()
  const [vraagIndex, setVraagIndex] = useState(0)
  const [antwoordConcept, setAntwoordConcept] = useState<{
    sleutel: string; uitkomst: AssuranceQuestionnaireOutcome | ''; bewijsreferentie: string; motivatie: string
  }>()
  const [laden, setLaden] = useState(true)
  const [startendKaderId, setStartendKaderId] = useState<string>()
  const [opslaan, setOpslaan] = useState(false)
  const [fout, setFout] = useState('')
  const [antwoordFout, setAntwoordFout] = useState<{ sleutel: string; melding: string }>()
  const [melding, setMelding] = useState('')

  useEffect(() => {
    if (!magReviewen) return
    let actief = true
    void Promise.all([
      dataSource.getAssuranceFrameworks(),
      dataSource.getAssuranceQuestionnaires(undefined, 50),
      magProcesWijzigen
        ? dataSource.getWorkspaceProcesses().catch(() => [])
        : Promise.resolve<ProcessSummary[]>([]),
    ])
      .then(([frameworkCatalogus, bestaandeQuestionnaires, werkprocessen]) => {
        if (!actief) return
        const actieveKaderIds = new Set(
          frameworkCatalogus.kaders.filter((kader) => kader.actief).map((kader) => kader.id),
        )
        const zichtbareQuestionnaires = bestaandeQuestionnaires
          .filter((questionnaire) => actieveKaderIds.has(questionnaire.kaderId))
          .sort(
            (a, b) =>
              new Date(b.gestartOp).getTime() - new Date(a.gestartOp).getTime(),
          )
        setCatalogus(frameworkCatalogus)
        setQuestionnaires(zichtbareQuestionnaires)
        setProcessen(werkprocessen)

        const hervatbaar = zichtbareQuestionnaires.find(
          (questionnaire) => !isAfgerond(questionnaire),
        )
        if (hervatbaar) {
          setGeselecteerdeSessionId(hervatbaar.sessionId)
          setVraagIndex(eersteOpenVraagIndex(hervatbaar))
        }
      })
      .catch((error: unknown) => {
        if (!actief) return
        setFout(
          error instanceof Error
            ? error.message
            : 'De actieve normenkaders konden niet worden geladen.',
        )
      })
      .finally(() => {
        if (actief) setLaden(false)
      })

    return () => {
      actief = false
    }
  }, [magProcesWijzigen, magReviewen])

  const actieveKaders = useMemo(
    () => catalogus?.kaders.filter((kader) => kader.actief) ?? [],
    [catalogus],
  )
  const actieveKaderIds = useMemo(
    () => new Set(actieveKaders.map((kader) => kader.id)),
    [actieveKaders],
  )
  const zichtbareQuestionnaires = useMemo(
    () =>
      questionnaires.filter((questionnaire) =>
        actieveKaderIds.has(questionnaire.kaderId),
      ),
    [actieveKaderIds, questionnaires],
  )
  const geselecteerdeQuestionnaire = zichtbareQuestionnaires.find(
    (questionnaire) => questionnaire.sessionId === geselecteerdeSessionId,
  )
  const huidigeVraag = geselecteerdeQuestionnaire?.vragen[vraagIndex]
  const bestaandAntwoord = huidigeVraag
    ? geselecteerdeQuestionnaire?.antwoorden.find(
        (antwoord) => antwoord.vraagId === huidigeVraag.id,
      )
    : undefined
  const gapAntwoorden =
    geselecteerdeQuestionnaire?.antwoorden.filter((antwoord) =>
      ['deels', 'nee', 'onbekend'].includes(antwoord.uitkomst),
    ) ?? []

  // Een concept hoort bij precies deze sessie, vraag en opgeslagen antwoordversie.
  // Andere vragen tonen meteen hun eigen antwoord zonder een render met vorige invoer.
  const antwoordSleutel = JSON.stringify([
    geselecteerdeQuestionnaire?.sessionId, huidigeVraag?.id,
    bestaandAntwoord?.uitkomst, bestaandAntwoord?.bewijsreferentie, bestaandAntwoord?.motivatie,
  ])
  const antwoord: NonNullable<typeof antwoordConcept> = antwoordConcept?.sleutel === antwoordSleutel ? antwoordConcept : {
    sleutel: antwoordSleutel,
    uitkomst: bestaandAntwoord?.uitkomst ?? '',
    bewijsreferentie: bestaandAntwoord?.bewijsreferentie ?? '',
    motivatie: bestaandAntwoord?.motivatie ?? '',
  }
  const { uitkomst, bewijsreferentie, motivatie } = antwoord
  const wijzigAntwoord = (wijziging: Partial<Pick<typeof antwoord, 'uitkomst' | 'bewijsreferentie' | 'motivatie'>>) => {
    setAntwoordConcept({ ...antwoord, ...wijziging })
    setAntwoordFout(undefined)
  }
  const formulierFout = antwoordFout?.sleutel === antwoordSleutel ? antwoordFout.melding : ''
  const setFormulierFout = (tekst: string) => setAntwoordFout({ sleutel: antwoordSleutel, melding: tekst })

  const openQuestionnaire = (questionnaire: AssuranceQuestionnaire) => {
    setGeselecteerdeSessionId(questionnaire.sessionId)
    setVraagIndex(eersteOpenVraagIndex(questionnaire))
    setFout('')
    setMelding('')
  }

  const startQuestionnaire = async (kaderId: string) => {
    setStartendKaderId(kaderId)
    setFout('')
    try {
      const gestart = await dataSource.startAssuranceQuestionnaire(kaderId)
      setQuestionnaires((huidig) => vervangQuestionnaire(huidig, gestart))
      setGeselecteerdeSessionId(gestart.sessionId)
      setVraagIndex(eersteOpenVraagIndex(gestart))
      setMelding(`Normtoets voor ${gestart.kaderNaam} is gestart.`)
    } catch (error) {
      setFout(
        error instanceof Error
          ? error.message
          : 'De normtoets kon niet worden gestart.',
      )
    } finally {
      setStartendKaderId(undefined)
    }
  }

  const valideerAntwoord = (): string | undefined => {
    if (!uitkomst) return 'Kies eerst een uitkomst.'
    if (uitkomst === 'ja' && bewijsreferentie.trim().length === 0) {
      return 'Bij “Ja” is een controleerbare bewijsreferentie verplicht.'
    }
    if (uitkomst !== 'ja' && motivatie.trim().length < 10) {
      return 'Licht deze uitkomst toe in minimaal 10 tekens.'
    }
    return undefined
  }

  const bewaarAntwoord = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!geselecteerdeQuestionnaire || !huidigeVraag || !uitkomst) return

    const validatiefout = valideerAntwoord()
    if (validatiefout) {
      setFormulierFout(validatiefout)
      return
    }

    const request: AssuranceQuestionnaireAnswerRequest = {
      expectedRevision: geselecteerdeQuestionnaire.revision,
      vraagId: huidigeVraag.id,
      uitkomst,
      bewijsreferentie: bewijsreferentie.trim() || undefined,
      motivatie: motivatie.trim() || undefined,
    }

    setOpslaan(true)
    setFormulierFout('')
    setFout('')
    setMelding('')
    try {
      const bijgewerkt = await dataSource.answerAssuranceQuestionnaire(
        geselecteerdeQuestionnaire.sessionId,
        request,
      )
      setQuestionnaires((huidig) => vervangQuestionnaire(huidig, bijgewerkt))
      setMelding(`Antwoord op “${huidigeVraag.titel}” is traceerbaar vastgelegd.`)

      if (bijgewerkt.readiness.open > 0) {
        const beantwoord = new Set(
          bijgewerkt.antwoorden.map((antwoord) => antwoord.vraagId),
        )
        const volgendeIndex = bijgewerkt.vragen.findIndex(
          (vraag, index) => index > vraagIndex && !beantwoord.has(vraag.id),
        )
        const eersteOpen = bijgewerkt.vragen.findIndex(
          (vraag) => !beantwoord.has(vraag.id),
        )
        const doelIndex = volgendeIndex >= 0 ? volgendeIndex : eersteOpen
        if (doelIndex >= 0) setVraagIndex(doelIndex)
      }
    } catch (error) {
      setFormulierFout(
        error instanceof Error
          ? error.message
          : 'Het antwoord kon niet worden vastgelegd.',
      )
    } finally {
      setOpslaan(false)
    }
  }

  const openAlsProcesverbetering = (vraagId: string) => {
    if (!magProcesWijzigen || !geselecteerdeQuestionnaire || !actieProcesId) return
    const vraag = geselecteerdeQuestionnaire.vragen.find((item) => item.id === vraagId)
    const antwoord = geselecteerdeQuestionnaire.antwoorden.find(
      (item) => item.vraagId === vraagId,
    )
    if (!vraag || !antwoord) return
    sessionStorage.setItem(
      'spg-assurance-aanleiding',
      JSON.stringify({
        procesId: actieProcesId,
        kaderId: geselecteerdeQuestionnaire.kaderId,
        kaderNaam: geselecteerdeQuestionnaire.kaderNaam,
        vraagId,
        titel: vraag.titel,
        bericht: `${vraag.vraag} Uitkomst: ${antwoord.uitkomst}. ${
          antwoord.motivatie ? `Motivatie: ${antwoord.motivatie}` : ''
        }`,
      }),
    )
    navigate(
      `/bouwer/${encodeURIComponent(actieProcesId)}?${new URLSearchParams({
        assuranceVraag: vraagId,
        kader: geselecteerdeQuestionnaire.kaderId,
      }).toString()}`,
    )
  }

  if (!magReviewen) {
    return (
      <div className="empty">
        De Normcoach vereist de rol “bewerken”, “goedkeuren” of “beheren”.
      </div>
    )
  }

  return (
    <div className="normcoach">
      <header className="nc-paginakop">
        <div>
          <h1>Normcoach</h1>
          <p>
            Toets jullie werkwijze aan een norm en leg antwoorden en bewijs vast.
          </p>
        </div>
      </header>

      <section className="nc-disclaimer" aria-labelledby="nc-disclaimer-titel">
        <div aria-hidden="true">i</div>
        <div>
          <h2 id="nc-disclaimer-titel">Hulp bij auditvoorbereiding</h2>
          <p>
            Je beoordeelt en bevestigt zelf de uitkomsten. Een ingevulde toets is geen certificering.
          </p>
        </div>
      </section>

      {laden && <p className="muted" role="status">Actieve normenkaders laden…</p>}
      {fout && <p className="nc-fout" role="alert">{fout}</p>}

      {!laden && !fout && actieveKaders.length === 0 && (
        <section className="empty nc-leeg" aria-labelledby="nc-geen-kaders">
          <h2 id="nc-geen-kaders">Nog geen actieve normenkaders</h2>
          <p>
            Activeer eerst de kaders die voor de organisatie gelden. Alleen actieve kaders
            verschijnen in de Normcoach.
          </p>
        </section>
      )}

      {!laden && actieveKaders.length > 0 && (
        <section aria-labelledby="nc-kaders-titel">
          <div className="nc-sectiekop">
            <div>
              <h2 id="nc-kaders-titel">Actieve normenkaders</h2>
              <p className="muted">
                Kies een kader of hervat een eerder gestarte normtoets.
              </p>
            </div>
            <span>{actieveKaders.length} actief</span>
          </div>
          <div className="nc-kadergrid">
            {actieveKaders.map((kader) => {
              const open = zichtbareQuestionnaires.find(
                (questionnaire) =>
                  questionnaire.kaderId === kader.id && !isAfgerond(questionnaire),
              )
              return (
                <Kaderkaart
                  key={kader.id}
                  kader={kader}
                  openQuestionnaire={open}
                  bezig={startendKaderId === kader.id}
                  onStart={startQuestionnaire}
                  onHervat={openQuestionnaire}
                />
              )
            })}
          </div>
        </section>
      )}

      {zichtbareQuestionnaires.length > 0 && (
        <section className="nc-sessies" aria-labelledby="nc-sessies-titel">
          <div className="nc-sectiekop">
            <div>
              <h2 id="nc-sessies-titel">Normtoetsen</h2>
              <p className="muted">Hervat open werk of bekijk een afgeronde toets.</p>
            </div>
          </div>
          <div className="nc-sessielijst">
            {zichtbareQuestionnaires.map((questionnaire) => (
              <button
                type="button"
                key={questionnaire.sessionId}
                className={`nc-sessie${
                  questionnaire.sessionId === geselecteerdeSessionId ? ' actief' : ''
                }`}
                aria-pressed={questionnaire.sessionId === geselecteerdeSessionId}
                onClick={() => openQuestionnaire(questionnaire)}
              >
                <span>
                  <strong>{questionnaire.kaderNaam}</strong>
                  <small>
                    Gestart door {questionnaire.gestartDoor} ·{' '}
                    {datumTijd(questionnaire.gestartOp)}
                  </small>
                </span>
                <span className="nc-sessievoortgang">
                  {questionnaire.readiness.beantwoord} van {questionnaire.readiness.totaal}{' '}
                  beantwoord
                  <small>{questionnaire.readiness.bewijsGereed} bewijs gereed</small>
                </span>
                <span
                  className={`pill ${
                    isAfgerond(questionnaire) ? 'pill-live' : 'pill-concept'
                  }`}
                >
                  {isAfgerond(questionnaire) ? 'Afgerond' : 'Open'}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {geselecteerdeQuestionnaire && huidigeVraag && (
        <section className="nc-vraagruimte" aria-labelledby="nc-vraagruimte-titel">
          <div className="nc-toetskop">
            <div>
              <span className="nc-bovenkop">Normtoets</span>
              <h2 id="nc-vraagruimte-titel">
                {geselecteerdeQuestionnaire.kaderNaam}
              </h2>
              <p>
                Vraag {vraagIndex + 1} van {geselecteerdeQuestionnaire.vragen.length}
              </p>
            </div>
            <dl className="nc-readiness" aria-label="Voortgang en bewijs">
              <div>
                <dt>Beantwoord</dt>
                <dd>
                  {geselecteerdeQuestionnaire.readiness.beantwoord} /{' '}
                  {geselecteerdeQuestionnaire.readiness.totaal}
                </dd>
              </div>
              <div>
                <dt>Bewijs gereed</dt>
                <dd>
                  {geselecteerdeQuestionnaire.readiness.bewijsGereed} /{' '}
                  {geselecteerdeQuestionnaire.readiness.totaal}
                </dd>
              </div>
              <div>
                <dt>Open</dt>
                <dd>{geselecteerdeQuestionnaire.readiness.open}</dd>
              </div>
            </dl>
          </div>

          <div className="nc-voortgang" role="status" aria-live="polite">
            <span
              style={{
                width: `${
                  geselecteerdeQuestionnaire.readiness.totaal > 0
                    ? Math.round(
                        (geselecteerdeQuestionnaire.readiness.beantwoord /
                          geselecteerdeQuestionnaire.readiness.totaal) *
                          100,
                      )
                    : 0
                }%`,
              }}
            />
            <p>
              {geselecteerdeQuestionnaire.readiness.beantwoord} vragen beantwoord;{' '}
              {geselecteerdeQuestionnaire.readiness.bewijsGereed} met bewijs gereed. Dit is
              voortgang, geen compliancepercentage.
            </p>
          </div>

          <article className="nc-vraagkaart">
            <div className="nc-vraagkop">
              <span>Vraag {vraagIndex + 1}</span>
              {bestaandAntwoord && (
                <span className="pill pill-live">Eerder beantwoord</span>
              )}
            </div>
            <h3>{huidigeVraag.titel}</h3>
            <p className="nc-vraagtekst">{huidigeVraag.vraag}</p>
            <p className="nc-bewijshint">
              <strong>Verwacht bewijs:</strong> {huidigeVraag.bewijsHint}
            </p>

            <form onSubmit={(event) => void bewaarAntwoord(event)}>
              <fieldset disabled={opslaan || isAfgerond(geselecteerdeQuestionnaire)}>
                <legend>Welke uitkomst past bij de huidige situatie?</legend>
                <div className="nc-uitkomsten">
                  {uitkomstOpties.map((optie) => (
                    <label
                      key={optie.waarde}
                      className={`nc-uitkomst${
                        uitkomst === optie.waarde ? ' geselecteerd' : ''
                      }`}
                    >
                      <input
                        type="radio"
                        name="uitkomst"
                        value={optie.waarde}
                        checked={uitkomst === optie.waarde}
                        onChange={() => wijzigAntwoord({ uitkomst: optie.waarde })}
                      />
                      <span>
                        <strong>{optie.label}</strong>
                        <small>{optie.uitleg}</small>
                      </span>
                    </label>
                  ))}
                </div>

                <div className="nc-velden">
                  <label>
                    Bewijsreferentie{uitkomst === 'ja' ? ' (verplicht)' : ' (optioneel)'}
                    <input
                      value={bewijsreferentie}
                      maxLength={500}
                      required={uitkomst === 'ja'}
                      aria-describedby="nc-bewijs-uitleg"
                      placeholder="Bijv. document-id, URL, ticket of dossierpad"
                      onChange={(event) => wijzigAntwoord({ bewijsreferentie: event.target.value })}
                    />
                    <small id="nc-bewijs-uitleg">
                      Verwijs naar controleerbaar bewijs; de verwijzing alleen maakt de
                      maatregel nog niet effectief.
                    </small>
                  </label>
                  <label>
                    Motivatie{uitkomst && uitkomst !== 'ja' ? ' (minimaal 10 tekens)' : ' (optioneel)'}
                    <textarea
                      value={motivatie}
                      rows={5}
                      minLength={uitkomst && uitkomst !== 'ja' ? 10 : undefined}
                      maxLength={2000}
                      required={Boolean(uitkomst && uitkomst !== 'ja')}
                      placeholder="Beschrijf wat is beoordeeld, wat ontbreekt en wat de volgende stap is."
                      onChange={(event) => wijzigAntwoord({ motivatie: event.target.value })}
                    />
                  </label>
                </div>
              </fieldset>

              {formulierFout && (
                <p className="nc-fout" role="alert">
                  {formulierFout}
                </p>
              )}
              {melding && (
                <p className="nc-succes" role="status">
                  {melding}
                </p>
              )}
              {bestaandAntwoord && (
                <p className="nc-antwoordmeta">
                  Laatst vastgelegd door {bestaandAntwoord.beantwoordDoor} op{' '}
                  {datumTijd(bestaandAntwoord.beantwoordOp)}.
                </p>
              )}

              <div className="nc-vraagacties">
                <button
                  type="button"
                  className="btn-secundair"
                  disabled={vraagIndex === 0 || opslaan}
                  onClick={() => setVraagIndex((index) => Math.max(0, index - 1))}
                >
                  Vorige vraag
                </button>
                {!isAfgerond(geselecteerdeQuestionnaire) && (
                  <button type="submit" className="btn-primair" disabled={opslaan}>
                    {opslaan ? 'Antwoord vastleggen…' : 'Antwoord vastleggen en verder'}
                  </button>
                )}
                <button
                  type="button"
                  className="btn-secundair"
                  disabled={
                    vraagIndex >= geselecteerdeQuestionnaire.vragen.length - 1 || opslaan
                  }
                  onClick={() =>
                    setVraagIndex((index) =>
                      Math.min(
                        geselecteerdeQuestionnaire.vragen.length - 1,
                        index + 1,
                      ),
                    )
                  }
                >
                  Volgende vraag
                </button>
              </div>
            </form>
          </article>

          {magProcesWijzigen && gapAntwoorden.length > 0 && (
            <section className="nc-verbeterbrug" aria-labelledby="nc-verbeterbrug-titel">
              <div>
                <span className="nc-bovenkop">Van bevinding naar uitvoering</span>
                <h3 id="nc-verbeterbrug-titel">Maak een veilige conceptverbetering</h3>
                <p>
                  Koppel een afwijkend antwoord aan een proces. De editor markeert de bevinding;
                  de AI-processteward stelt daarna alleen controleerbare conceptteksten voor of
                  vraagt door als informatie ontbreekt.
                </p>
              </div>
              <label>
                Proces dat je wilt verbeteren
                <select
                  value={actieProcesId}
                  onChange={(event) => setActieProcesId(event.target.value)}
                >
                  <option value="">Kies een proces…</option>
                  {processen.map((proces) => (
                    <option key={proces.id} value={proces.id}>
                      {proces.detailproces}
                    </option>
                  ))}
                </select>
              </label>
              <ul>
                {gapAntwoorden.map((antwoord) => {
                  const vraag = geselecteerdeQuestionnaire.vragen.find(
                    (item) => item.id === antwoord.vraagId,
                  )
                  if (!vraag) return null
                  return (
                    <li key={antwoord.vraagId}>
                      <div>
                        <strong>{vraag.titel}</strong>
                        <span>Uitkomst: {antwoord.uitkomst}</span>
                      </div>
                      <button
                        className="btn-secundair"
                        type="button"
                        disabled={!actieProcesId}
                        onClick={() => openAlsProcesverbetering(antwoord.vraagId)}
                      >
                        Markeer in proceseditor
                      </button>
                    </li>
                  )
                })}
              </ul>
              <small>
                Er wordt niets automatisch live gezet. Opslaan, indienen, goedkeuren en het
                sluiten van de bevinding blijven afzonderlijke menselijke besluiten.
              </small>
            </section>
          )}

          <p className="nc-serverdisclaimer">
            {geselecteerdeQuestionnaire.readiness.disclaimer}
          </p>
        </section>
      )}
    </div>
  )
}
