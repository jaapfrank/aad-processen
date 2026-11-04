import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import type {
  AssuranceFrameworkDraft,
  AssuranceFrameworkDraftCreateRequest,
} from '@contract/assurance-framework-drafts'
import { dataSource } from '../data'
import {
  createAssuranceFrameworkDraftWithAi,
  listAssuranceFrameworkDrafts,
  publishAssuranceFrameworkDraft,
  rejectAssuranceFrameworkDraft,
} from '../lib/assuranceFrameworkDraftApi'
import './AssuranceFrameworkDraftManager.css'

const leegFormulier: AssuranceFrameworkDraftCreateRequest = {
  bronUrl: '',
  bronOrganisatie: '',
  naam: '',
  editie: '',
  domein: '',
  publiekeSamenvatting: '',
  gebruiksrechtenBevestigd: false,
}

type ReviewState = Record<
  string,
  { bron: boolean; rechten: boolean; dekking: boolean }
>

function foutmelding(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'De aanvraag kon niet veilig worden verwerkt.'
}

function datumTijd(waarde?: string | null) {
  if (!waarde) return '—'
  return new Intl.DateTimeFormat('nl-NL', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(waarde))
}

export function AssuranceFrameworkDraftManager({
  onCatalogChanged,
}: {
  onCatalogChanged?: () => void | Promise<void>
}) {
  const [formulier, setFormulier] =
    useState<AssuranceFrameworkDraftCreateRequest>(leegFormulier)
  const [concepten, setConcepten] = useState<AssuranceFrameworkDraft[] | null>(null)
  const [review, setReview] = useState<ReviewState>({})
  const [afwijsredenen, setAfwijsredenen] = useState<Record<string, string>>({})
  const [aiBezig, setAiBezig] = useState(false)
  const [publicatieBezig, setPublicatieBezig] = useState('')
  const [afwijzingBezig, setAfwijzingBezig] = useState('')
  const [fout, setFout] = useState('')
  const [melding, setMelding] = useState('')

  const laad = useCallback(async () => {
    if (!dataSource.heeftBackend) {
      setConcepten([])
      return
    }
    try {
      setConcepten(await listAssuranceFrameworkDrafts())
      setFout('')
    } catch (error) {
      setConcepten([])
      setFout(foutmelding(error))
    }
  }, [])

  useEffect(() => {
    void Promise.resolve().then(laad)
  }, [laad])

  const formulierGeldig = useMemo(
    () =>
      formulier.bronUrl.trim().startsWith('https://') &&
      formulier.bronOrganisatie.trim().length >= 2 &&
      formulier.naam.trim().length >= 2 &&
      formulier.editie.trim().length >= 1 &&
      formulier.domein.trim().length >= 2 &&
      formulier.publiekeSamenvatting.trim().length >= 100 &&
      formulier.gebruiksrechtenBevestigd,
    [formulier],
  )

  const maakConcept = async (event: FormEvent) => {
    event.preventDefault()
    if (!formulierGeldig) return
    setAiBezig(true)
    setFout('')
    setMelding('')
    try {
      const gemaakt = await createAssuranceFrameworkDraftWithAi(formulier)
      setConcepten((huidig) => [gemaakt, ...(huidig ?? [])])
      setFormulier(leegFormulier)
      setMelding(
        'AI-concept aangemaakt. Controleer nu bron, rechten en iedere toetsvraag vóór publicatie.',
      )
    } catch (error) {
      setFout(foutmelding(error))
    } finally {
      setAiBezig(false)
    }
  }

  const wijzigReview = (
    draftId: string,
    veld: 'bron' | 'rechten' | 'dekking',
    waarde: boolean,
  ) => {
    setReview((huidig) => ({
      ...huidig,
      [draftId]: {
        bron: huidig[draftId]?.bron ?? false,
        rechten: huidig[draftId]?.rechten ?? false,
        dekking: huidig[draftId]?.dekking ?? false,
        [veld]: waarde,
      },
    }))
  }

  const publiceer = async (concept: AssuranceFrameworkDraft) => {
    const besluit = review[concept.draftId]
    if (!besluit?.bron || !besluit.rechten || !besluit.dekking) return
    setPublicatieBezig(concept.draftId)
    setFout('')
    setMelding('')
    try {
      const gepubliceerd = await publishAssuranceFrameworkDraft(concept.draftId, {
        expectedRevision: concept.revision,
        bronGecontroleerd: true,
        rechtenGecontroleerd: true,
        highLevelBeperkingGeaccepteerd: true,
      })
      setConcepten((huidig) =>
        (huidig ?? []).map((item) =>
          item.draftId === gepubliceerd.draftId ? gepubliceerd : item,
        ),
      )
      setReview((huidig) => {
        const volgend = { ...huidig }
        delete volgend[concept.draftId]
        return volgend
      })
      try {
        await onCatalogChanged?.()
        setMelding(
          'Kader gepubliceerd in de catalogus. Het is nog niet actief; selecteer het hierboven en sla de normscope op.',
        )
      } catch {
        setMelding(
          'Kader is gepubliceerd, maar de catalogusweergave kon niet direct worden vernieuwd. Vernieuw de pagina; publiceer niet opnieuw.',
        )
      }
    } catch (error) {
      setFout(foutmelding(error))
    } finally {
      setPublicatieBezig('')
    }
  }

  const wijsAf = async (concept: AssuranceFrameworkDraft) => {
    const reden = afwijsredenen[concept.draftId]?.trim() ?? ''
    if (reden.length < 10) return
    setAfwijzingBezig(concept.draftId)
    setFout('')
    setMelding('')
    try {
      const afgewezen = await rejectAssuranceFrameworkDraft(concept.draftId, {
        expectedRevision: concept.revision,
        reden,
      })
      setConcepten((huidig) =>
        (huidig ?? []).map((item) =>
          item.draftId === afgewezen.draftId ? afgewezen : item,
        ),
      )
      setAfwijsredenen((huidig) => {
        const volgend = { ...huidig }
        delete volgend[concept.draftId]
        return volgend
      })
      setMelding(
        'Concept afgewezen en auditbaar bewaard. Gebruik “Nieuw concept op basis hiervan” om veilig te regenereren.',
      )
    } catch (error) {
      setFout(foutmelding(error))
    } finally {
      setAfwijzingBezig('')
    }
  }

  const bereidNieuwConceptVoor = (concept: AssuranceFrameworkDraft) => {
    setFormulier({
      bronUrl: concept.bronUrl,
      bronOrganisatie: concept.bronOrganisatie,
      naam: concept.naam,
      editie: concept.editie,
      domein: concept.domein,
      publiekeSamenvatting: concept.publiekeSamenvatting,
      gebruiksrechtenBevestigd: false,
    })
    setMelding(
      'Brongegevens overgenomen. Pas de publieke samenvatting aan en bevestig de gebruiksrechten opnieuw.',
    )
    document
      .getElementById('kader-ai-intake-form')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  if (!dataSource.heeftBackend) {
    return (
      <section className="kader-intake">
        <h3>Kader met AI voorbereiden</h3>
        <div className="callout waarschuwing">
          Deze veilige intake vereist de backend en een expliciet geconfigureerde
          AI-koppeling. Mockdata publiceert nooit normenkaders.
        </div>
      </section>
    )
  }

  return (
    <section className="kader-intake">
      <header className="kader-intake-kop">
        <div>
          <span className="beheersing-kicker">Uitbreidbare catalogus</span>
          <h3>Kader met AI voorbereiden</h3>
          <p>
            AI maakt alleen een brongebonden concept met hoog-niveau
            evidencevragen. Publiceren en activeren zijn twee afzonderlijke
            menselijke besluiten. Dit is geen volledig of gecertificeerd
            normpack.
          </p>
        </div>
        <span className="kader-intake-status">Menselijke publicatie verplicht</span>
      </header>

      <div className="kader-intake-waarschuwing">
        <strong>Geen automatische bronophaling</strong>
        <span>
          De server opent de URL niet. Plak geen beschermde normtekst: schrijf
          zelf een korte, openbare samenvatting die je aantoonbaar mag gebruiken.
        </span>
      </div>

      <form
        id="kader-ai-intake-form"
        className="kader-intake-formulier"
        onSubmit={(event) => void maakConcept(event)}
      >
        <div className="kader-intake-velden">
          <label className="kader-intake-breed">
            Officiële HTTPS-bron
            <input
              type="url"
              required
              maxLength={500}
              placeholder="https://officiele-bron.example/..."
              value={formulier.bronUrl}
              onChange={(event) =>
                setFormulier({ ...formulier, bronUrl: event.target.value })
              }
            />
          </label>
          <label>
            Bronorganisatie
            <input
              required
              minLength={2}
              maxLength={160}
              placeholder="Bijvoorbeeld ISO of Europese Unie"
              value={formulier.bronOrganisatie}
              onChange={(event) =>
                setFormulier({ ...formulier, bronOrganisatie: event.target.value })
              }
            />
          </label>
          <label>
            Naam kader
            <input
              required
              minLength={2}
              maxLength={160}
              value={formulier.naam}
              onChange={(event) =>
                setFormulier({ ...formulier, naam: event.target.value })
              }
            />
          </label>
          <label>
            Editie / versie
            <input
              required
              maxLength={160}
              value={formulier.editie}
              onChange={(event) =>
                setFormulier({ ...formulier, editie: event.target.value })
              }
            />
          </label>
          <label>
            Domein
            <input
              required
              minLength={2}
              maxLength={180}
              placeholder="Bijvoorbeeld ketenbeveiliging"
              value={formulier.domein}
              onChange={(event) =>
                setFormulier({ ...formulier, domein: event.target.value })
              }
            />
          </label>
          <label className="kader-intake-breed">
            Zelfgeschreven publieke samenvatting
            <textarea
              required
              minLength={100}
              maxLength={4000}
              rows={6}
              placeholder="Beschrijf in eigen woorden doel, scope en soorten beheersing. Neem geen normartikelen, clausules of letterlijke normtekst over."
              value={formulier.publiekeSamenvatting}
              onChange={(event) =>
                setFormulier({
                  ...formulier,
                  publiekeSamenvatting: event.target.value,
                })
              }
            />
            <small>
              {formulier.publiekeSamenvatting.trim().length}/4000 tekens · minimaal
              100
            </small>
          </label>
        </div>

        <label className="kader-intake-rechten">
          <input
            type="checkbox"
            checked={formulier.gebruiksrechtenBevestigd}
            onChange={(event) =>
              setFormulier({
                ...formulier,
                gebruiksrechtenBevestigd: event.target.checked,
              })
            }
          />
          <span>
            Ik bevestig dat deze zelfgeschreven publieke samenvatting gebruikt
            mag worden en geen gekopieerde, beschermde normtekst bevat.
          </span>
        </label>

        <div className="kader-intake-acties">
          <button
            className="btn-primair"
            type="submit"
            disabled={!formulierGeldig || aiBezig}
          >
            {aiBezig ? 'AI-concept maken…' : 'Maak brongebonden AI-concept'}
          </button>
          <span>
            Fail-closed: zonder werkende AI-configuratie of geldig JSON wordt
            niets opgeslagen.
          </span>
        </div>
      </form>

      {melding && (
        <div className="callout succes" role="status">
          {melding}
        </div>
      )}
      {fout && (
        <div className="callout fout" role="alert">
          {fout}
        </div>
      )}

      <div className="kader-intake-lijst">
        <div className="kader-intake-lijstkop">
          <h4>Concepten en publicatiebesluiten</h4>
          <button className="btn-tekst" type="button" onClick={() => void laad()}>
            Vernieuwen
          </button>
        </div>
        {concepten === null ? (
          <p className="muted">Kaderconcepten laden…</p>
        ) : concepten.length === 0 ? (
          <p className="muted">Er zijn nog geen AI-kaderconcepten.</p>
        ) : (
          concepten.map((concept) => {
            const besluit = review[concept.draftId] ?? {
              bron: false,
              rechten: false,
              dekking: false,
            }
            const gepubliceerd = concept.status === 'published'
            const afgewezen = concept.status === 'rejected'
            return (
              <article
                className={`kader-conceptkaart ${
                  gepubliceerd ? 'gepubliceerd' : afgewezen ? 'afgewezen' : ''
                }`}
                key={concept.draftId}
              >
                <header>
                  <div>
                    <span>
                      {gepubliceerd
                        ? 'Gepubliceerd · niet actief'
                        : afgewezen
                          ? 'Afgewezen concept'
                          : 'Concept'}
                    </span>
                    <h5>
                      {concept.naam} <small>{concept.editie}</small>
                    </h5>
                    <p>{concept.domein}</p>
                  </div>
                  <a href={concept.bronUrl} target="_blank" rel="noreferrer">
                    Controleer officiële bron
                  </a>
                </header>

                <details>
                  <summary>
                    Bekijk publieke samenvatting en {concept.vragen.length} toetsvragen
                  </summary>
                  <div className="kader-concept-inhoud">
                    <p>{concept.publiekeSamenvatting}</p>
                    <ol>
                      {concept.vragen.map((vraag) => (
                        <li key={vraag.id}>
                          <strong>{vraag.titel}</strong>
                          <span>{vraag.vraag}</span>
                          <small>Bewijsrichting: {vraag.bewijsHint}</small>
                        </li>
                      ))}
                    </ol>
                  </div>
                </details>

                <div className="kader-concept-herkomst">
                  <span>
                    AI-herkomst: <strong>{concept.provider}</strong> / {concept.model}
                  </span>
                  <span title={concept.inputHash}>
                    Inputhash {concept.inputHash.slice(0, 12)}…
                  </span>
                  <span title={concept.outputHash}>
                    Vragenhash {concept.outputHash.slice(0, 12)}…
                  </span>
                  <span>
                    Door {concept.aangemaaktDoor} · {datumTijd(concept.aangemaaktOp)}
                  </span>
                </div>

                {gepubliceerd ? (
                  <div className="kader-concept-gepubliceerd">
                    <strong>Beschikbaar in catalogus</strong>
                    <span>
                      Gepubliceerd door {concept.gepubliceerdDoor} op{' '}
                      {datumTijd(concept.gepubliceerdOp)}. Activeer het kader apart
                      in de normscope.
                    </span>
                  </div>
                ) : afgewezen ? (
                  <div className="kader-concept-afgewezen">
                    <strong>Afgewezen door {concept.afgewezenDoor}</strong>
                    <span>
                      {datumTijd(concept.afgewezenOp)} · {concept.afwijsreden}
                    </span>
                    <button
                      className="btn-secundair"
                      type="button"
                      onClick={() => bereidNieuwConceptVoor(concept)}
                    >
                      Nieuw concept op basis hiervan
                    </button>
                  </div>
                ) : (
                  <div className="kader-concept-besluit">
                    <strong>Expliciet publicatiebesluit</strong>
                    <label>
                      <input
                        type="checkbox"
                        checked={besluit.bron}
                        onChange={(event) =>
                          wijzigReview(
                            concept.draftId,
                            'bron',
                            event.target.checked,
                          )
                        }
                      />
                      Ik heb bron, naam, editie, domein en alle vragen inhoudelijk
                      gecontroleerd.
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={besluit.rechten}
                        onChange={(event) =>
                          wijzigReview(
                            concept.draftId,
                            'rechten',
                            event.target.checked,
                          )
                        }
                      />
                      Ik heb de gebruiksrechten opnieuw gecontroleerd.
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={besluit.dekking}
                        onChange={(event) =>
                          wijzigReview(
                            concept.draftId,
                            'dekking',
                            event.target.checked,
                          )
                        }
                      />
                      Ik begrijp dat dit een custom high-level vragenlijst zonder
                      geverifieerde clausulelocators is en geen volledige
                      normdekking bewijst.
                    </label>
                    <button
                      className="btn-secundair"
                      type="button"
                      disabled={
                        !besluit.bron ||
                        !besluit.rechten ||
                        !besluit.dekking ||
                        publicatieBezig === concept.draftId
                      }
                      onClick={() => void publiceer(concept)}
                    >
                      {publicatieBezig === concept.draftId
                        ? 'Publiceren…'
                        : 'Publiceer in catalogus'}
                    </button>
                    <div className="kader-concept-afwijzen">
                      <label>
                        Afwijsreden
                        <textarea
                          rows={2}
                          minLength={10}
                          maxLength={1000}
                          placeholder="Leg uit welke vraag of bronmetadata niet bruikbaar is."
                          value={afwijsredenen[concept.draftId] ?? ''}
                          onChange={(event) =>
                            setAfwijsredenen((huidig) => ({
                              ...huidig,
                              [concept.draftId]: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <div>
                        <button
                          className="btn-tekst"
                          type="button"
                          disabled={
                            (afwijsredenen[concept.draftId]?.trim().length ?? 0) <
                              10 ||
                            afwijzingBezig === concept.draftId
                          }
                          onClick={() => void wijsAf(concept)}
                        >
                          {afwijzingBezig === concept.draftId
                            ? 'Afwijzen…'
                            : 'Concept afwijzen'}
                        </button>
                        <button
                          className="btn-tekst"
                          type="button"
                          onClick={() => bereidNieuwConceptVoor(concept)}
                        >
                          Nieuw concept voorbereiden
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                <p className="kader-concept-disclaimer">{concept.disclaimer}</p>
              </article>
            )
          })
        )}
      </div>
    </section>
  )
}
