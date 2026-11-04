import { useEffect, useRef, useState } from 'react'
import type {
  DiagramExportBlocker,
  DiagramPackageImportResult,
  Process,
} from '../contract'
import { dataSource } from '../data'
import {
  diagramFormatAdapters,
  diagramLayoutUitGeometrie,
  exportDrawIo,
  exportVisioVsdx,
  importDrawIo,
  normaliseerDrawIoXml,
  type DiagramImportGeometry,
} from '../lib/diagramExchange'
import './diagramUitwisseling.css'

export type DiagramUitwisselingActie = 'importeren' | 'exporteren'
export type DiagramUitwisselingFormaat = 'drawio-xml' | 'visio-vsdx' | 'lucid-standard'

interface DiagramUitwisselingProps {
  proces: Process
  /** Alleen aanwezig in een editor: import wordt nooit direct opgeslagen. */
  onImportConcept?: (proces: Process) => void
  standaardOpen?: boolean
  weergave?: 'paneel' | 'pagina'
  actie?: DiagramUitwisselingActie
  formaat?: DiagramUitwisselingFormaat
}

interface ReviewRapport {
  format: DiagramUitwisselingFormaat
  pages: Array<{ id: string; name: string; number: number; background: boolean }>
  ok: boolean
  process: Process | null
  confidence: number
  mappedItems: number
  totalItems: number
  sourceLabel: string
  geometry: DiagramImportGeometry[]
  warnings: Array<{ code: string; message: string; elementId?: string }>
  errors: Array<{ code: string; message: string; elementId?: string }>
  unmapped: Array<{ code: string; message: string; elementId?: string }>
}

function downloadBlob(naam: string, bestand: Blob): void {
  const url = URL.createObjectURL(bestand)
  const link = document.createElement('a')
  link.href = url
  link.download = naam
  link.click()
  URL.revokeObjectURL(url)
}

function downloadTekst(naam: string, mediaType: string, inhoud: string): void {
  downloadBlob(naam, new Blob([inhoud], { type: mediaType }))
}

function statusLabel(importeerbaar: boolean, exporteerbaar: boolean): string {
  if (importeerbaar && exporteerbaar) return 'Import en export beschikbaar'
  if (importeerbaar) return 'Import beschikbaar'
  if (exporteerbaar) return 'Export beschikbaar'
  return 'Nog niet beschikbaar'
}

function lokaalReview(resultaat: ReturnType<typeof importDrawIo>): ReviewRapport {
  return {
    format: 'drawio-xml',
    pages: [],
    ok: resultaat.ok,
    process: resultaat.process,
    confidence: resultaat.confidence.overall,
    mappedItems: resultaat.confidence.mappedItems,
    totalItems: resultaat.confidence.totalItems,
    geometry: resultaat.geometry,
    sourceLabel: resultaat.confidence.metadataBacked
      ? 'SPG-metadata (hoogste fidelity)'
      : 'Generieke draw.io-structuur (strikte subset)',
    warnings: resultaat.warnings,
    errors: resultaat.errors,
    unmapped: resultaat.unmapped.map((item) => ({
      code: 'unmapped-item',
      message: `${item.kind}: ${item.reason}`,
      elementId: item.externalId,
    })),
  }
}

function serverReview(resultaat: DiagramPackageImportResult): ReviewRapport {
  const mappedItems = resultaat.geometry.length
  return {
    format: resultaat.format,
    pages: resultaat.pages ?? [],
    ok: resultaat.ok,
    process: resultaat.process ?? null,
    confidence: resultaat.confidence,
    mappedItems,
    totalItems: mappedItems + resultaat.unmapped.length,
    geometry: resultaat.geometry,
    sourceLabel:
      resultaat.format === 'lucid-standard'
        ? 'Lucid Standard Import-structuur'
        : 'Vormen en verbindingen uit het Visio-bestand',
    warnings: resultaat.warnings,
    errors: resultaat.errors,
    unmapped: resultaat.unmapped,
  }
}

export function DiagramUitwisseling({
  proces,
  onImportConcept,
  standaardOpen = true,
  weergave = 'paneel',
  actie,
  formaat,
}: DiagramUitwisselingProps) {
  const drawIoInput = useRef<HTMLInputElement>(null)
  const packageInput = useRef<HTMLInputElement>(null)
  const rapportRef = useRef<HTMLElement>(null)
  const meldingRef = useRef<HTMLParagraphElement>(null)
  const uploadFormatRef = useRef<'lucid-standard' | 'visio-vsdx'>(formaat === 'visio-vsdx' ? 'visio-vsdx' : 'lucid-standard')
  const [rapport, setRapport] = useState<ReviewRapport | null>(null)
  const [bestandsnaam, setBestandsnaam] = useState('')
  const gekozenBestand = useRef<File | null>(null)
  const [paginaId, setPaginaId] = useState('')
  const [geanalyseerdePagina, setGeanalyseerdePagina] = useState('')
  const [standaardRol, setStandaardRol] = useState('')
  const [keuzeGewijzigd, setKeuzeGewijzigd] = useState(false)
  const [melding, setMelding] = useState('')
  const [meldingSoort, setMeldingSoort] = useState<'status' | 'fout'>('status')
  const [bezig, setBezig] = useState(false)
  const [open, setOpen] = useState(standaardOpen)
  const [visioBlokkade, setVisioBlokkade] = useState<DiagramExportBlocker | null>(null)
  const toonImport = actie !== 'exporteren'
  const toonExport = actie !== 'importeren'
  const zichtbareAdapters = formaat
    ? diagramFormatAdapters.filter((adapter) => adapter.capability.format === formaat)
    : diagramFormatAdapters

  const wisMelding = () => setMelding('')
  const meldStatus = (tekst: string) => {
    setMeldingSoort('status')
    setMelding(tekst)
  }
  const meldFout = (tekst: string) => {
    setMeldingSoort('fout')
    setMelding(tekst)
  }

  useEffect(() => {
    if (!rapport) return
    window.requestAnimationFrame(() => rapportRef.current?.focus())
  }, [rapport])

  useEffect(() => {
    if (!melding || meldingSoort !== 'fout') return
    window.requestAnimationFrame(() => meldingRef.current?.focus())
  }, [melding, meldingSoort])

  useEffect(() => {
    if (!dataSource.heeftBackend) return
    void dataSource
      .getVisioExportBlocker()
      .then(setVisioBlokkade)
      .catch(() => undefined)
  }, [])

  const exporteerDrawIo = () => {
    wisMelding()
    const resultaat = exportDrawIo(proces)
    if (
      !resultaat.ok ||
      typeof resultaat.content !== 'string' ||
      !resultaat.fileName ||
      !resultaat.mediaType
    ) {
      meldFout(resultaat.errors.map((fout) => fout.message).join(' ') || 'Exporteren is mislukt.')
      return
    }
    downloadTekst(resultaat.fileName, resultaat.mediaType, resultaat.content)
    meldStatus(
      resultaat.warnings.length
        ? `draw.io-bestand gemaakt met ${resultaat.warnings.length} waarschuwing(en).`
        : 'draw.io-bestand gemaakt. Wijzigingen kunnen later semantisch worden teruggeïmporteerd.',
    )
  }

  const exporteerVisio = () => {
    wisMelding()
    const resultaat = exportVisioVsdx(proces)
    if (
      !resultaat.ok ||
      !(resultaat.content instanceof Uint8Array) ||
      !resultaat.fileName ||
      !resultaat.mediaType
    ) {
      meldFout(resultaat.errors.map((fout) => fout.message).join(' ') || 'Visio-export is mislukt.')
      return
    }
    downloadBlob(
      resultaat.fileName,
      new Blob([resultaat.content], { type: resultaat.mediaType }),
    )
    meldStatus(
      resultaat.warnings.length
        ? `Macro-vrij Visio-bestand gemaakt. ${resultaat.warnings[0].message}`
        : 'Macro-vrij, bewerkbaar Visio-bestand gemaakt.',
    )
  }

  const leesDrawIo = async (bestand: File) => {
    wisMelding()
    setRapport(null)
    setBestandsnaam(bestand.name)
    if (bestand.size > 10_000_000) {
      meldFout('Dit bestand is groter dan de veilige importlimiet van 10 MB.')
      return
    }
    try {
      setRapport(lokaalReview(importDrawIo(await normaliseerDrawIoXml(await bestand.text()))))
    } catch (fout) {
      meldFout(fout instanceof Error ? fout.message : 'Het bestand kon niet worden gelezen.')
    }
  }

  const exporteerLucid = async () => {
    wisMelding()
    setBezig(true)
    try {
      const resultaat = await dataSource.exportLucidDiagram(proces)
      downloadBlob(resultaat.bestandsnaam, resultaat.bestand)
      meldStatus(
        'Lucid Standard Import-bestand gemaakt. Lucidchart importeert dit als een nieuw, bewerkbaar document.',
      )
    } catch (fout) {
      meldFout(fout instanceof Error ? fout.message : 'Lucid-export is mislukt.')
    } finally {
      setBezig(false)
    }
  }

  const leesPackage = async (
    bestand: File,
    format: 'lucid-standard' | 'visio-vsdx',
    options?: { pageId?: string; defaultRole?: string },
  ) => {
    wisMelding()
    setRapport(null)
    setBestandsnaam(bestand.name)
    gekozenBestand.current = bestand
    setKeuzeGewijzigd(false)
    if (!options) { setPaginaId(''); setStandaardRol('') }
    if (bestand.size > 50 * 1024 * 1024) {
      meldFout('Dit bestand is groter dan de veilige importlimiet van 50 MB.')
      return
    }
    const verwachteExtensie = format === 'visio-vsdx' ? '.vsdx' : '.lucid'
    if (!bestand.name.toLowerCase().endsWith(verwachteExtensie)) {
      meldFout(`Kies een ${verwachteExtensie}-bestand.` + (format === 'visio-vsdx' ? ' Sla een ouder Visio-bestand (.vsd) eerst in Visio op als .vsdx.' : ''))
      return
    }
    setBezig(true)
    try {
      const ontvangen = serverReview(await dataSource.importDiagramPackage(format, bestand, options))
      setRapport(ontvangen)
      const paginas = ontvangen.pages.filter((pagina) => !pagina.background)
      const geanalyseerd = options?.pageId ?? (paginas.length === 1 ? paginas[0].id : '')
      setGeanalyseerdePagina(geanalyseerd)
      if (!options?.pageId && paginas.length === 1) setPaginaId(paginas[0].id)
    } catch (fout) {
      meldFout(fout instanceof Error ? fout.message : 'De package kon niet worden geanalyseerd.')
    } finally {
      setBezig(false)
    }
  }

  const kiesPackage = (format: 'lucid-standard' | 'visio-vsdx') => {
    uploadFormatRef.current = format
    if (packageInput.current) {
      packageInput.current.accept = format === 'visio-vsdx' ? '.vsdx' : '.lucid'
      packageInput.current.click()
    }
  }

  const neemOver = () => {
    if (!rapport?.ok || !rapport.process || !onImportConcept || keuzeGewijzigd) return
    const diagramLayout = diagramLayoutUitGeometrie(rapport.geometry)
    const concept: Process = {
      ...structuredClone(rapport.process),
      ...(diagramLayout ? { diagramLayout } : {}),
      status: 'concept',
      revision: undefined,
      laatsteWijziging: new Date().toISOString().slice(0, 10),
      bron: {
        ...structuredClone(rapport.process.bron),
        type: rapport.format === 'visio-vsdx' ? 'visio-import' : 'diagram-import',
        bestand: bestandsnaam,
        importDatum: new Date().toISOString().slice(0, 10),
        importZekerheid: rapport.confidence,
      },
    }
    onImportConcept(concept)
    meldStatus(
      'Import als concept in de bouwer gezet. Controleer de visualisatie en gezondheid; opslaan blijft een aparte actie.',
    )
    setRapport(null)
  }

  const beschikbarePaginas = rapport?.pages.filter((pagina) => !pagina.background) ?? []
  const paginaVereist = rapport?.errors.some((item) => item.code === 'page-selection-required') ?? false
  const rolVereist = (rapport?.errors.some((item) => item.code === 'roles-missing') ?? false) && paginaId === geanalyseerdePagina
  const aanvullingNodig = paginaVereist || rolVereist

  const inhoud = (
    <div className="dx-inhoud">
        <div className="dx-formaten">
          {zichtbareAdapters.map((adapter) => {
            const isDrawIo = adapter.capability.format === 'drawio-xml'
            const isLucid = adapter.capability.format === 'lucid-standard'
            const kanImporteren =
              toonImport &&
              Boolean(onImportConcept) &&
              (adapter.capability.localImport || (!isDrawIo && dataSource.heeftBackend))
            const kanExporteren =
              toonExport &&
              (adapter.capability.localExport || (isLucid && dataSource.heeftBackend))

            return (
              <article key={adapter.capability.format} className="dx-formaat">
                <div className="dx-formaat-kop">
                  <strong>{adapter.capability.label}</strong>
                  <span className={kanImporteren || kanExporteren ? 'dx-status dx-gereed' : 'dx-status'}>
                    {statusLabel(kanImporteren, kanExporteren)}
                  </span>
                </div>
                <p>{!isDrawIo && !isLucid && toonImport
                  ? 'Je controleert de herkende stappen, rollen en routes voordat je het proces opslaat.'
                  : adapter.capability.explanation}</p>
                {!isDrawIo && !isLucid && toonImport && <details className="ui-help"><summary>Bestandsvereisten</summary><p>Maximaal 50 MB. Sla een ouder .vsd-bestand eerst in Visio op als .vsdx. De import controleert of de vormen, rollen en verbindingen bruikbaar zijn.</p></details>}

                {isDrawIo ? (
                  <div className="bm-acties">
                    {toonExport && (
                      <button type="button" className="btn-secundair" onClick={exporteerDrawIo}>
                        ⬇️ Exporteer .drawio
                      </button>
                    )}
                    {toonImport && onImportConcept && (
                      <>
                        <button
                          type="button"
                          className="btn-secundair"
                          onClick={() => drawIoInput.current?.click()}
                        >
                          ⬆️ Importeer .drawio
                        </button>
                        <input
                          ref={drawIoInput}
                          className="dx-bestand"
                          type="file"
                          accept=".drawio,.xml,application/xml,text/xml"
                          onChange={(event) => {
                            const bestand = event.target.files?.[0]
                            if (bestand) void leesDrawIo(bestand)
                            event.target.value = ''
                          }}
                        />
                      </>
                    )}
                  </div>
                ) : isLucid ? (
                  <div className="bm-acties">
                    {toonExport && (
                      <button
                        type="button"
                        className="btn-secundair"
                        disabled={!dataSource.heeftBackend || bezig}
                        onClick={() => void exporteerLucid()}
                      >
                        ⬇️ Exporteer .lucid
                      </button>
                    )}
                    {toonImport && onImportConcept && (
                      <button
                        type="button"
                        className="btn-secundair"
                        disabled={!dataSource.heeftBackend || bezig}
                        onClick={() => kiesPackage('lucid-standard')}
                      >
                        ⬆️ Importeer .lucid
                      </button>
                    )}
                  </div>
                ) : (
                  <>
                    {toonImport && onImportConcept && (
                      <button
                        type="button"
                        className="btn-secundair"
                        disabled={!dataSource.heeftBackend || bezig}
                        onClick={() => kiesPackage('visio-vsdx')}
                      >
                        {bezig ? 'Visio-bestand analyseren…' : 'Kies Visio-bestand (.vsdx)'}
                      </button>
                    )}
                    {toonExport && (
                      <>
                        <p className="dx-beperking">
                          {visioBlokkade?.requiresValidatedTemplate === false
                            ? visioBlokkade.message
                            : 'Macro-vrije éénpagina-VSDX met lanes, procesvormen, beslissingen en gelijmde connectors. Geen Visio-installatie of voorbeeldbestand nodig.'}
                        </p>
                        <button type="button" className="btn-secundair" onClick={exporteerVisio}>
                          ⬇️ Exporteer .vsdx
                        </button>
                      </>
                    )}
                  </>
                )}
              </article>
            )
          })}
        </div>

        <input
          ref={packageInput}
          className="dx-bestand"
          type="file"
          accept={formaat === "visio-vsdx" ? ".vsdx" : formaat === "lucid-standard" ? ".lucid" : ".lucid,.vsdx"}
          disabled={bezig}
          onChange={(event) => {
            const bestand = event.target.files?.[0]
            if (bestand) void leesPackage(bestand, uploadFormatRef.current)
            event.target.value = ''
          }}
        />

        {bezig && <p role="status" aria-live="polite" className="dx-melding">{bestandsnaam ? `${bestandsnaam} wordt geanalyseerd. De herkende stappen en aandachtspunten verschijnen hieronder.` : "Bestand verwerken…"}</p>}

        {rapport && (
          <section
            ref={rapportRef}
            className="dx-rapport"
            aria-labelledby="dx-review-titel"
            tabIndex={-1}
          >
            <p
              className="dx-review-status"
              role={rapport.ok || aanvullingNodig ? 'status' : 'alert'}
              aria-live={rapport.ok || aanvullingNodig ? 'polite' : 'assertive'}
            >
              {aanvullingNodig
                ? 'Vul de importkeuzes hieronder aan en analyseer dezelfde Visio-pagina opnieuw.'
                : rapport.ok
                ? 'Importanalyse gereed. Controleer de dekking en bevindingen voordat je het werkconcept overneemt.'
                : 'Importanalyse bevat blokkerende fouten. Het bestand kan niet als werkconcept worden overgenomen.'}
            </p>
            <div>
              <span className="kicker">Importreview</span>
              <h3 id="dx-review-titel">{bestandsnaam}</h3>
              <p>
                Semantische dekking: <strong>{Math.round(rapport.confidence * 100)}%</strong> ·{' '}
                {rapport.mappedItems} van {rapport.totalItems} elementen gekoppeld.
              </p>
              <p className="muted">Interpretatiebron: {rapport.sourceLabel}.</p>
              {rapport.process && <p><strong>{rapport.process.detailproces}</strong> · {rapport.process.stappen.length} stappen · {rapport.process.lanes.length} rollen. Controleer rollen, besliskeuzes en ontbrekende onderdelen in het concept.</p>}
            </div>
            {rapport.format === 'visio-vsdx' && ((rapport.pages.length > 1) || aanvullingNodig || standaardRol) && (
              <section className="dx-visio-keuzes" aria-label="Visio importkeuzes">
                <h4>Welke pagina en rollen wil je overnemen?</h4>
                {rapport.pages.length > 1 && <label>Visio-pagina
                  <select aria-label="Visio-pagina" value={paginaId} disabled={bezig} onChange={(event) => { setPaginaId(event.target.value); setStandaardRol(''); setKeuzeGewijzigd(true) }}>
                    <option value="">Kies een pagina…</option>
                    {rapport.pages.map((pagina) => <option key={pagina.id} value={pagina.id} disabled={pagina.background}>{pagina.number}. {pagina.name}{pagina.background ? " (achtergrond, niet importeerbaar)" : ""}</option>)}
                  </select>
                </label>}
                {(rolVereist || standaardRol) && <label>Verantwoordelijke rol voor dit diagram
                  <input value={standaardRol} maxLength={120} disabled={bezig} placeholder="Bijvoorbeeld: Proceseigenaar of Technicus" onChange={(event) => { setStandaardRol(event.target.value); setKeuzeGewijzigd(true) }} />
                  <span className="muted">Vul dit alleen in als dezelfde rol verantwoordelijk is voor alle stappen. Verdeel de rollen anders eerst in Visio.</span>
                </label>}
                {keuzeGewijzigd && <p role="status">Je importkeuzes zijn gewijzigd. Analyseer opnieuw voordat je een concept overneemt.</p>}
                <button type="button" className="btn-primair" disabled={bezig || ((paginaVereist || beschikbarePaginas.length > 1) && !paginaId) || (rolVereist && !standaardRol.trim())} onClick={() => {
                  if (gekozenBestand.current) void leesPackage(gekozenBestand.current, 'visio-vsdx', { ...(paginaId ? { pageId: paginaId } : {}), ...(standaardRol.trim() ? { defaultRole: standaardRol.trim() } : {}) })
                }}>Analyseer deze pagina opnieuw</button>
              </section>
            )}
            {rapport.errors.length > 0 && (
              <ul className="gezond-lijst">
                {rapport.errors.map((fout) => (
                  <li key={`${fout.code}-${fout.elementId ?? ''}`} className="gi-fout">
                    {fout.message}
                  </li>
                ))}
              </ul>
            )}
            {rapport.warnings.length > 0 && (
              <ul className="gezond-lijst">
                {rapport.warnings.map((waarschuwing) => (
                  <li
                    key={`${waarschuwing.code}-${waarschuwing.elementId ?? ''}`}
                    className="gi-waarschuwing"
                  >
                    {waarschuwing.message}
                  </li>
                ))}
              </ul>
            )}
            {rapport.unmapped.length > 0 && (
              <div className="dx-onherkend">
                <h4>Niet overgenomen onderdelen ({rapport.unmapped.length})</h4>
                <p>Deze onderdelen zijn niet automatisch als processtap geïnterpreteerd. Controleer ze aan de hand van je bronbestand.</p>
                <ul>{rapport.unmapped.map((item, index) => <li key={item.code + ':' + (item.elementId ?? index)}>{item.elementId && <strong>{item.elementId}: </strong>}{item.message}</li>)}</ul>
              </div>
            )}
            {rapport.ok && rapport.process && onImportConcept && (
              <button type="button" className="btn-primair" disabled={keuzeGewijzigd} onClick={neemOver}>
                Gebruik als gecontroleerd werkconcept
              </button>
            )}
          </section>
        )}

        {melding && (
          <p
            ref={meldingRef}
            className={`dx-melding${meldingSoort === 'fout' ? ' fout' : ''}`}
            role={meldingSoort === 'fout' ? 'alert' : 'status'}
            aria-live={meldingSoort === 'fout' ? 'assertive' : 'polite'}
            tabIndex={-1}
          >
            {melding}
          </p>
        )}
        <p className="muted dx-voet">
          Controleer het resultaat vóór het opslaan. Niet-herkende onderdelen worden apart vermeld.
        </p>
    </div>
  )

  if (weergave === 'pagina') {
    return (
      <section className="dx-paneel dx-pagina" aria-label="Diagram importeren of exporteren">
        {inhoud}
      </section>
    )
  }

  return (
    <details
      className="dx-paneel"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span>⇄ Diagramuitwisseling</span>
        <span className="muted">draw.io · Visio · Lucidchart</span>
      </summary>
      {inhoud}
    </details>
  )
}
