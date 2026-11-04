import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { dataSource } from '../data'
import { useHasRole } from '../appState'
import type { Process, ImportJob } from '../contract'

// M6 — Import-assistent: PDF uploaden → automatische herkenning → side-by-side
// review (PDF links, herkende stapkaarten rechts, zekerheid per stap) →
// vastleggen als conceptproces (publicatie pas na goedkeuring).

/** Zekerheid per stap: uit step.bronZekerheid of uit de job-veldenlijst. */
function stapZekerheid(job: ImportJob, index: number, bronZekerheid?: number): number | undefined {
  if (bronZekerheid !== undefined) return bronZekerheid
  const velden = job.zekerheid?.filter((z) => z.veld.startsWith(`stappen[${index}]`))
  if (!velden || velden.length === 0) return undefined
  return velden.reduce((a, z) => a + z.zekerheid, 0) / velden.length
}

function ZekerheidBadge({ waarde }: { waarde?: number }) {
  if (waarde === undefined) return null
  const pct = Math.round(waarde * 100)
  const klasse = waarde >= 0.75 ? 'zk-hoog' : waarde >= 0.5 ? 'zk-middel' : 'zk-laag'
  return (
    <span className={`zk-badge ${klasse}`} title="Zekerheid van de PDF-herkenning">
      {pct}%
    </span>
  )
}

export function PdfImportWerkstroom({ ingebed = false }: { ingebed?: boolean }) {
  const navigate = useNavigate()
  const magBewerken = useHasRole('bewerken')
  const bestandInput = useRef<HTMLInputElement>(null)
  const reviewRef = useRef<HTMLDivElement>(null)
  const foutRef = useRef<HTMLParagraphElement>(null)
  const [job, setJob] = useState<ImportJob | null>(null)
  const [concept, setConcept] = useState<Process | null>(null)
  const [fout, setFout] = useState('')
  const [bezig, setBezig] = useState(false)
  const [alleenLaag, setAlleenLaag] = useState(false)

  /** Job bijwerken; zodra gereed het conceptproces overnemen voor review. */
  const ontvangJob = (j: ImportJob) => {
    setJob(j)
    if (j.status === 'gereed' && j.conceptProces)
      setConcept((prev) => prev ?? structuredClone(j.conceptProces!))
  }

  // Poll de job tot die gereed of mislukt is.
  useEffect(() => {
    if (!job || job.status === 'gereed' || job.status === 'mislukt') return
    const timer = setInterval(() => {
      void dataSource
        .getImportJob(job.id)
        .then(ontvangJob)
        .catch((e: unknown) => setFout(e instanceof Error ? e.message : 'Job ophalen mislukt.'))
    }, 1500)
    return () => clearInterval(timer)
  }, [job])

  useEffect(() => {
    if (!fout) return
    window.requestAnimationFrame(() => foutRef.current?.focus())
  }, [fout])

  useEffect(() => {
    if (job?.status !== 'gereed' || !concept) return
    window.requestAnimationFrame(() => reviewRef.current?.focus())
  }, [concept, job?.status])

  const laneNaam = (laneId: string) =>
    concept?.lanes.find((l) => l.id === laneId)?.naam ?? laneId

  const zichtbareStappen = useMemo(() => {
    if (!concept || !job) return []
    return concept.stappen
      .map((s, i) => ({ stap: s, index: i, zekerheid: stapZekerheid(job, i, s.bronZekerheid) }))
      .filter((x) => !alleenLaag || (x.zekerheid !== undefined && x.zekerheid < 0.75))
  }, [concept, job, alleenLaag])

  if (!magBewerken)
    return <div className="empty">PDF-import vereist de rol "bewerken".</div>

  const upload = async (bestand: File) => {
    setFout('')
    setBezig(true)
    setConcept(null)
    try {
      ontvangJob(await dataSource.importPdf(bestand))
    } catch (e) {
      setFout(e instanceof Error ? e.message : 'Upload mislukt.')
    } finally {
      setBezig(false)
    }
  }

  const wijzigStap = (index: number, deel: Partial<Process['stappen'][number]>) => {
    if (!concept) return
    const stappen = [...concept.stappen]
    stappen[index] = { ...stappen[index], ...deel }
    setConcept({ ...concept, stappen })
  }

  const verwijderStap = (index: number) => {
    if (!concept) return
    setConcept({ ...concept, stappen: concept.stappen.filter((_, i) => i !== index) })
  }

  const legVast = async () => {
    if (!job || !concept) return
    setFout('')
    setBezig(true)
    try {
      const opgeslagen = await dataSource.commitImport(job.id, concept)
      navigate(`/bouwer/${opgeslagen.id}`)
    } catch (e) {
      setFout(e instanceof Error ? e.message : 'Vastleggen mislukt.')
    } finally {
      setBezig(false)
    }
  }

  return (
    <div className="import-pagina">
      {!ingebed && (
        <>
          <h1>PDF-import</h1>
          <p className="muted">
            Upload een proces-PDF; de assistent herkent stappen en zet ze klaar als
            concept-stapkaarten. Jij controleert en corrigeert — niets gaat live zonder
            goedkeuring.
          </p>
        </>
      )}

      {!dataSource.heeftBackend && (
        <div className="empty">PDF-import vereist de backend. Start de app in API-modus.</div>
      )}

      {dataSource.heeftBackend && !job && (
        <div className="import-upload">
          <input
            ref={bestandInput}
            type="file"
            accept="application/pdf"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void upload(f)
            }}
          />
          <button className="btn-primair" disabled={bezig} onClick={() => bestandInput.current?.click()}>
            {bezig ? 'Bezig…' : '📥 Kies een PDF'}
          </button>
        </div>
      )}

      {fout && (
        <p ref={foutRef} className="login-fout" role="alert" tabIndex={-1}>
          {fout}
        </p>
      )}

      {job && job.status !== 'gereed' && job.status !== 'mislukt' && (
        <div className="be-blok" role="status" aria-live="polite">
          <p>
            ⏳ Bezig met herkennen van <strong>{job.bestandsnaam}</strong>…{' '}
            {job.voortgang !== undefined && `${job.voortgang}%`}
          </p>
          <div className="bm-voortgang-balk">
            <div className="bm-voortgang-vulling" style={{ width: `${job.voortgang ?? 30}%` }} />
          </div>
        </div>
      )}

      {job?.status === 'mislukt' && (
        <div className="empty" role="alert">
          Import mislukt: {job.fout ?? 'onbekende fout'}.{' '}
          <button className="btn-tekst" onClick={() => setJob(null)}>
            Opnieuw proberen
          </button>
        </div>
      )}

      {job?.status === 'gereed' && concept && (
        <>
          <p className="import-gereed" role="status" aria-live="polite">
            PDF-herkenning gereed. Controleer de procesgegevens en stapkaarten voordat je het
            concept vastlegt.
          </p>
          <div className="import-kop">
            <div className="be-form import-meta">
              <label>
                Hoofdproces
                <input
                  value={concept.hoofdproces}
                  onChange={(e) => setConcept({ ...concept, hoofdproces: e.target.value })}
                />
              </label>
              <label>
                Detailproces
                <input
                  value={concept.detailproces}
                  onChange={(e) => setConcept({ ...concept, detailproces: e.target.value })}
                />
              </label>
              <label>
                Versie
                <input
                  value={concept.versie}
                  onChange={(e) => setConcept({ ...concept, versie: e.target.value })}
                />
              </label>
            </div>
            <div className="bm-acties">
              <label className="rol-optie">
                <input type="checkbox" checked={alleenLaag} onChange={(e) => setAlleenLaag(e.target.checked)} />
                Alleen lage zekerheid (&lt;75%)
              </label>
              <button className="btn-primair" disabled={bezig} onClick={() => void legVast()}>
                ✓ Vastleggen als concept ({concept.stappen.length} stappen)
              </button>
              <button className="btn-tekst" onClick={() => { setJob(null); setConcept(null) }}>
                Annuleren
              </button>
            </div>
          </div>

          <div
            ref={reviewRef}
            className="import-review"
            aria-label="PDF-importreview"
            tabIndex={-1}
          >
            <div className="import-pdf">
              {job.paginaAfbeeldingen?.length && !job.paginaAfbeeldingen[0].includes('?page=') ? (
                <div className="import-paginas">
                  {job.paginaAfbeeldingen.map((url, i) => (
                    <img key={url} src={url} alt={`PDF-pagina ${i + 1}`} loading="lazy" />
                  ))}
                </div>
              ) : job.bronBestandId ? (
                <object
                  data={dataSource.fileUrl(job.bronBestandId)}
                  type="application/pdf"
                  aria-label="Originele PDF"
                >
                  <p className="muted">
                    PDF-weergave niet beschikbaar.{' '}
                    <a href={dataSource.fileUrl(job.bronBestandId)} target="_blank" rel="noreferrer">
                      Open de PDF
                    </a>
                  </p>
                </object>
              ) : (
                <div className="empty">Geen bronbestand beschikbaar.</div>
              )}
            </div>

            <div className="import-kaarten">
              {zichtbareStappen.map(({ stap, index, zekerheid }) => (
                <div
                  key={stap.id}
                  className={`import-kaart${zekerheid !== undefined && zekerheid < 0.5 ? ' laag' : ''}`}
                >
                  <div className="import-kaart-kop">
                    <span className="stap-nr">{stap.nummer}</span>
                    <span className="lane-chip">{laneNaam(stap.laneId)}</span>
                    <ZekerheidBadge waarde={zekerheid} />
                    <button className="panel-close" title="Stap verwijderen" onClick={() => verwijderStap(index)}>
                      ×
                    </button>
                  </div>
                  <textarea
                    rows={2}
                    value={stap.activiteit}
                    onChange={(e) => wijzigStap(index, { activiteit: e.target.value })}
                  />
                  {stap.opmerking !== undefined && (
                    <textarea
                      rows={2}
                      className="import-opm"
                      placeholder="Opmerking"
                      value={stap.opmerking}
                      onChange={(e) => wijzigStap(index, { opmerking: e.target.value })}
                    />
                  )}
                </div>
              ))}
              {zichtbareStappen.length === 0 && (
                <div className="empty">Geen stappen{alleenLaag ? ' met lage zekerheid' : ''}.</div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/** Bestaande route behouden voor bookmarks en directe PDF-importlinks. */
export function ImportPagina() {
  return <PdfImportWerkstroom />
}
