import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import type { Process, ProcessSummary } from '../contract'
import { useHasRole } from '../appState'
import { dataSource } from '../data'
import { maakDiagramImportWerkconcept } from '../lib/uitwisseling'
import {
  DiagramUitwisseling,
  type DiagramUitwisselingActie,
  type DiagramUitwisselingFormaat,
} from '../components/DiagramUitwisseling'
import { PdfImportWerkstroom } from './Import'
import { TabelImport } from '../components/TabelImport'
import './uitwisseling.css'

type UitwisselingActie = 'importeren' | 'exporteren'
type UitwisselingFormaat = 'pdf' | 'tabel' | DiagramUitwisselingFormaat

const formaten: Array<{
  id: UitwisselingFormaat
  naam: string
  extensie: string
  uitleg: string
  kanImporteren: boolean
  kanExporteren: boolean
}> = [
  {
    id: 'visio-vsdx',
    naam: 'Microsoft Visio',
    extensie: '.vsdx',
    uitleg: 'Neem bestaande Visio-processen over. Controleer de herkende vormen en verbindingen en werk verder in de editor.',
    kanImporteren: true,
    kanExporteren: true,
  },
  {
    id: 'pdf',
    naam: 'PDF',
    extensie: '.pdf',
    uitleg: 'Laat stappen herkennen en controleer de uitkomst naast het bronbestand.',
    kanImporteren: true,
    kanExporteren: false,
  },
  {
    id: 'drawio-xml',
    naam: 'draw.io',
    extensie: '.drawio',
    uitleg: 'Lokale, semantische round-trip met stabiele proces- en stap-id’s.',
    kanImporteren: true,
    kanExporteren: true,
  },
  {
    id: 'lucid-standard',
    naam: 'Lucidchart',
    extensie: '.lucid',
    uitleg: 'Lucid Standard Import-package via de beveiligde backendadapter.',
    kanImporteren: true,
    kanExporteren: true,
  },
  {
    id: 'tabel',
    naam: 'Excel / tabel',
    extensie: '.csv, .tsv',
    uitleg: 'Herbruik stappen uit Excel, SharePoint of een systeemexport en koppel de kolommen.',
    kanImporteren: true,
    kanExporteren: false,
  },
]

const leegUitwisselingsproces: Process = {
  id: '',
  hoofdproces: '',
  detailproces: '',
  versie: 'V1.0',
  status: 'concept',
  laatsteWijziging: new Date().toISOString().slice(0, 10),
  bron: { type: 'handmatig' },
  lanes: [],
  secties: [],
  stappen: [],
}

function isActie(waarde: string | null): waarde is UitwisselingActie {
  return waarde === 'importeren' || waarde === 'exporteren'
}

function isFormaat(waarde: string | null): waarde is UitwisselingFormaat {
  return formaten.some((formaat) => formaat.id === waarde)
}

export function Uitwisseling() {
  const magBewerken = useHasRole('bewerken')
  const magBeheren = useHasRole('beheren')
  const navigate = useNavigate()
  const [zoekParameters, setZoekParameters] = useSearchParams()
  const gevraagdeActie = zoekParameters.get('actie')
  const gevraagdeFormaat = zoekParameters.get('formaat')
  const processId = zoekParameters.get('processId') ?? ''
  const actie: UitwisselingActie = isActie(gevraagdeActie) ? gevraagdeActie : 'importeren'
  const kandidaatFormaat: UitwisselingFormaat = isFormaat(gevraagdeFormaat)
    ? gevraagdeFormaat
    : actie === 'importeren'
      ? 'visio-vsdx'
      : 'drawio-xml'
  const formaat: UitwisselingFormaat =
    actie === 'exporteren' && (kandidaatFormaat === 'pdf' || kandidaatFormaat === 'tabel') ? 'drawio-xml' : kandidaatFormaat
  const [processen, setProcessen] = useState<ProcessSummary[] | null>(null)
  const [proces, setProces] = useState<Process | null>(null)
  const [procesFout, setProcesFout] = useState<{
    processId: string
    melding: string
  } | null>(null)

  useEffect(() => {
    let actief = true
    void dataSource
      .getWorkspaceProcesses()
      .then(async (items) => {
        if (!actief) return
        setProcessen(items)
        if (!processId) {
          setProces(null)
          setProcesFout(null)
          return
        }
        const geladen = await dataSource.getWorkspaceProcess(processId)
        if (!actief) return
        setProces(geladen)
        setProcesFout(
          geladen
            ? null
            : {
                processId,
                melding: `Proces “${processId}” is niet gevonden in de huidige werkruimte.`,
              },
        )
      })
      .catch((fout: unknown) => {
        if (!actief) return
        setProcessen([])
        setProces(null)
        setProcesFout({
          processId,
          melding: fout instanceof Error ? fout.message : 'Processen laden mislukt.',
        })
      })
    return () => {
      actief = false
    }
  }, [processId])

  if (!magBewerken && !magBeheren) {
    return <div className="empty">Importeren en exporteren vereist de rol “bewerken”.</div>
  }

  const wijzigKeuze = (
    wijziging: Partial<{
      actie: UitwisselingActie
      formaat: UitwisselingFormaat
      processId: string
    }>,
  ) => {
    const volgende = new URLSearchParams(zoekParameters)
    for (const [sleutel, waarde] of Object.entries(wijziging)) {
      if (waarde) volgende.set(sleutel, waarde)
      else volgende.delete(sleutel)
    }
    setZoekParameters(volgende, { replace: true })
  }

  const neemImportOver = (geimporteerd: Process) => {
    const doelProces = processId && proces?.id === processId ? proces : undefined
    if (processId && !doelProces) return
    if (processId && dataSource.heeftBackend && doelProces?.revision === undefined) return
    const werkconcept = maakDiagramImportWerkconcept(geimporteerd, doelProces)
    const doelId = werkconcept.id
    navigate(doelId ? `/bouwer/${encodeURIComponent(doelId)}` : '/bouwer', {
      state: { diagramImportConcept: werkconcept },
    })
  }

  const diagramFormaat = formaat === 'pdf' || formaat === 'tabel' ? null : formaat
  const gekozenFormaat = formaten.find((item) => item.id === formaat)!
  const doelProces = processId && proces?.id === processId ? proces : null
  const huidigeProcesFout =
    procesFout?.processId === processId ? procesFout.melding : ''
  const doelProcesLaden = Boolean(processId) && !doelProces && !huidigeProcesFout
  const doelRevisionOntbreekt =
    Boolean(processId) &&
    dataSource.heeftBackend &&
    Boolean(doelProces) &&
    doelProces?.revision === undefined
  const kanDiagramUitvoeren =
    !processId || (Boolean(doelProces) && !doelRevisionOntbreekt)

  return (
    <div className="ux-pagina">
      <header className="ux-kop">
        <div>
          <h1>Import &amp; export</h1>
          <p className="muted">
            Neem een bestaand proces over of download een bewerkbaar diagram.
          </p>
        </div>
        {processId && (
          <Link className="btn-secundair" to={`/bouwer/${encodeURIComponent(processId)}`}>
            ← Terug naar procesbouwer
          </Link>
        )}
      </header>

      <section className="ux-stap" aria-labelledby="ux-richting">
        <div className="ux-stapnummer" aria-hidden="true">
          1
        </div>
        <fieldset>
          <legend id="ux-richting">Wat wil je doen?</legend>
          <div className="ux-richting">
            <label className={actie === 'importeren' ? 'actief' : ''}>
              <input
                type="radio"
                name="uitwisseling-actie"
                checked={actie === 'importeren'}
                onChange={() =>
                  wijzigKeuze({
                    actie: 'importeren',
                    formaat: kandidaatFormaat === 'pdf' ? 'pdf' : kandidaatFormaat,
                  })
                }
              />
              <strong>Importeren</strong>
            </label>
            <label className={actie === 'exporteren' ? 'actief' : ''}>
              <input
                type="radio"
                name="uitwisseling-actie"
                checked={actie === 'exporteren'}
                onChange={() =>
                  wijzigKeuze({
                    actie: 'exporteren',
                    formaat: kandidaatFormaat === 'pdf' || kandidaatFormaat === 'tabel' ? 'drawio-xml' : kandidaatFormaat,
                  })
                }
              />
              <strong>Exporteren</strong>
            </label>
          </div>
        </fieldset>
      </section>

      <section className="ux-stap" aria-labelledby="ux-formaat">
        <div className="ux-stapnummer" aria-hidden="true">
          2
        </div>
        <div>
          <h2 id="ux-formaat">Kies een formaat</h2>
          <div className="ux-formaten">
            {formaten.map((item) => {
              const beschikbaar =
                actie === 'importeren' ? item.kanImporteren : item.kanExporteren
              return (
                <button
                  key={item.id}
                  type="button"
                  className={formaat === item.id ? 'actief' : ''}
                  aria-pressed={formaat === item.id}
                  aria-disabled={!beschikbaar}
                  disabled={!beschikbaar}
                  onClick={() =>
                    wijzigKeuze({
                      formaat: item.id,
                      ...(['pdf', 'tabel'].includes(item.id) ? { processId: '' } : {}),
                    })
                  }
                >
                  <span className="ux-formaat-kop">
                    <strong>{item.naam}</strong>
                    <code>{item.extensie}</code>
                  </span>
                  {!beschikbaar && <em>Niet beschikbaar voor {actie === 'importeren' ? 'import' : 'export'}</em>}
                </button>
              )
            })}
          </div>
        </div>
      </section>

      {formaat !== 'pdf' && formaat !== 'tabel' && (
        <details className="ux-doel" open={actie === 'exporteren' || Boolean(processId)}>
          <summary id="ux-proces">
            {actie === 'exporteren' ? 'Welk proces wil je downloaden?' : processId ? 'Import in bestaand proces' : 'Optioneel: import in bestaand proces'}
          </summary>
          <div>
            <p className="muted">
              {actie === 'exporteren'
                ? 'De export wordt gemaakt van de actuele werkversie.'
                : 'Start een nieuw proces of bewerk een bestaande versie. Je controleert de inhoud vóór het opslaan.'}
            </p>
            <label className="ux-proceskeuze">
              Proces
              <select
                value={processId}
                disabled={processen === null}
                onChange={(event) => wijzigKeuze({ processId: event.target.value })}
              >
                <option value="">
                  {actie === 'exporteren' ? 'Selecteer een proces…' : 'Nieuw proces uit bestand'}
                </option>
                {(processen ?? []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.detailproces} · {item.versie}
                  </option>
                ))}
              </select>
            </label>
            {doelProcesLaden && (
              <p className="muted" role="status">
                Proces laden…
              </p>
            )}
            {huidigeProcesFout && (
              <p className="login-fout" role="alert">
                {huidigeProcesFout}
              </p>
            )}
            {doelRevisionOntbreekt && (
              <p className="login-fout" role="alert">
                De procesversie kon niet worden gecontroleerd. Vernieuw de pagina voordat je importeert.
              </p>
            )}
          </div>
        </details>
      )}

      <section className="ux-uitvoering" aria-labelledby="ux-uitvoering">
        <div className="ux-uitvoering-kop">
          <span className="ux-stapnummer" aria-hidden="true">
            {formaat === 'pdf' || formaat === 'tabel' ? 3 : 4}
          </span>
          <div>
            <h2 id="ux-uitvoering">
              {actie === 'importeren' ? 'Kies je bestand' : 'Download je bestand'}
            </h2>
            <p className="muted">
              {gekozenFormaat.naam} · {gekozenFormaat.extensie}
            </p>
          </div>
        </div>

        {formaat === 'tabel' ? (
          <TabelImport onImport={(geimporteerd) => navigate('/bouwer', { state: { diagramImportConcept: geimporteerd } })} />
        ) : formaat === 'pdf' ? (
          <>
            <aside className="ux-pdf-veilig" role="note">
              <strong>Je PDF wordt een nieuw concept.</strong>
              <span>
                Controleer de herkenning voordat je het proces opslaat.
              </span>
            </aside>
            <PdfImportWerkstroom ingebed />
          </>
        ) : doelProcesLaden ? (
          <div className="empty" role="status">
            Proces laden…
          </div>
        ) : huidigeProcesFout || doelRevisionOntbreekt ? (
          <div className="empty">Los eerst de procescontext hierboven op.</div>
        ) : actie === 'exporteren' && !doelProces ? (
          <div className="empty">Selecteer eerst het proces dat je wilt exporteren.</div>
        ) : (
          <DiagramUitwisseling
            key={`${actie}:${formaat}:${processId}:${doelProces?.revision ?? "nieuw"}`}
            proces={doelProces ?? leegUitwisselingsproces}
            onImportConcept={
              actie === 'importeren' && kanDiagramUitvoeren ? neemImportOver : undefined
            }
            weergave="pagina"
            actie={actie as DiagramUitwisselingActie}
            formaat={diagramFormaat ?? undefined}
          />
        )}
      </section>
    </div>
  )
}
