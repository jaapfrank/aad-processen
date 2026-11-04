import { useEffect, useState } from 'react'
import { dataSource } from '../data'
import type { IsoNorm, ProcessSummary } from '../contract'
import type { IsoMapping, IsoProcessConfig } from '@contract/iso'

const normen: Array<{ id: IsoNorm; label: string }> = [
  { id: 'iso27001', label: 'ISO 27001' },
  { id: 'iso9001', label: 'ISO 9001' },
  { id: 'iso14001', label: 'ISO 14001' },
]

/** Paneel om een proces aan normen/clausules/eigenaar/reviews te koppelen. */
export function IsoKoppeling({
  onOpgeslagen,
  actieveKaderIds,
}: {
  onOpgeslagen: () => void
  actieveKaderIds?: readonly string[]
}) {
  const [processen, setProcessen] = useState<ProcessSummary[]>([])
  const [procesId, setProcesId] = useState('')
  const [config, setConfig] = useState<IsoProcessConfig | null>(null)
  const [melding, setMelding] = useState('')
  const [bezig, setBezig] = useState(false)

  useEffect(() => {
    void dataSource.getProcesses().then(setProcessen)
  }, [])

  useEffect(() => {
    if (!procesId) return
    void dataSource
      .getProcessIso(procesId)
      .then((c) => setConfig({ procesId, mappings: c.mappings ?? [], governance: c.governance }))
      .catch(() => setConfig({ procesId, mappings: [] }))
  }, [procesId])

  // Toon alleen de config van het gekozen proces (voorkomt verouderde weergave).
  const actueel = config && config.procesId === procesId ? config : null
  const zichtbareNormen = actieveKaderIds
    ? normen.filter((norm) => actieveKaderIds.includes(norm.id))
    : normen

  const mappingVoor = (norm: IsoNorm): IsoMapping | undefined =>
    actueel?.mappings.find((m) => m.norm === norm)

  const zetNorm = (norm: IsoNorm, aan: boolean) => {
    if (!actueel) return
    const rest = actueel.mappings.filter((m) => m.norm !== norm)
    setConfig({
      ...actueel,
      mappings: aan ? [...rest, { norm, rol: 'kern', clausules: [] }] : rest,
    })
  }

  const wijzigMapping = (norm: IsoNorm, deel: Partial<IsoMapping>) => {
    if (!actueel) return
    setConfig({
      ...actueel,
      mappings: actueel.mappings.map((m) => (m.norm === norm ? { ...m, ...deel } : m)),
    })
  }

  const wijzigGovernance = (deel: Partial<NonNullable<IsoProcessConfig['governance']>>) => {
    if (!actueel) return
    setConfig({ ...actueel, governance: { ...actueel.governance, ...deel } })
  }

  const opslaan = async () => {
    if (!actueel) return
    setBezig(true)
    setMelding('')
    try {
      await dataSource.saveProcessIso(actueel.procesId, actueel)
      setMelding('✓ Koppeling opgeslagen.')
      onOpgeslagen()
    } catch (e) {
      setMelding(e instanceof Error ? e.message : 'Opslaan mislukt.')
    } finally {
      setBezig(false)
    }
  }

  return (
    <section className="be-blok iso-koppeling">
      <h2>⚙️ Proces aan normen koppelen</h2>
      <p className="muted">
        Kies een proces en leg vast voor welke norm(en) het nodig is, met clausules, eigenaar en
        reviewdata. Dit vult de auditmatrix en de borging-signalen.
      </p>

      <select className="rol-filter" value={procesId} onChange={(e) => setProcesId(e.target.value)}>
        <option value="">— kies een proces —</option>
        {processen.map((p) => (
          <option key={p.id} value={p.id}>
            {p.detailproces}
          </option>
        ))}
      </select>

      {actueel && (
        <>
          <div className="iso-normen-config">
            {zichtbareNormen.map((n) => {
              const m = mappingVoor(n.id)
              return (
                <div key={n.id} className={`iso-norm-rij${m ? ' actief' : ''}`}>
                  <label className="rol-optie">
                    <input
                      type="checkbox"
                      checked={Boolean(m)}
                      onChange={(e) => zetNorm(n.id, e.target.checked)}
                    />
                    <strong>{n.label}</strong>
                  </label>
                  {m && (
                    <>
                      <select
                        value={m.rol}
                        onChange={(e) => wijzigMapping(n.id, { rol: e.target.value as IsoMapping['rol'] })}
                      >
                        <option value="kern">kern</option>
                        <option value="ondersteunend">ondersteunend</option>
                      </select>
                      <input
                        placeholder="clausules, bv. 8.2, 8.5"
                        value={(m.clausules ?? []).join(', ')}
                        onChange={(e) =>
                          wijzigMapping(n.id, {
                            clausules: e.target.value
                              .split(',')
                              .map((c) => c.trim())
                              .filter(Boolean),
                          })
                        }
                      />
                    </>
                  )}
                </div>
              )
            })}
          </div>

          <div className="be-form iso-governance">
            <label>
              Proceseigenaar
              <input
                value={actueel.governance?.eigenaar ?? ''}
                placeholder="bv. Teamleider Service"
                onChange={(e) => wijzigGovernance({ eigenaar: e.target.value || undefined })}
              />
            </label>
            <label>
              Laatste review
              <input
                type="date"
                value={actueel.governance?.laatsteReview ?? ''}
                onChange={(e) => wijzigGovernance({ laatsteReview: e.target.value || undefined })}
              />
            </label>
            <label>
              Volgende review
              <input
                type="date"
                value={actueel.governance?.volgendeReview ?? ''}
                onChange={(e) => wijzigGovernance({ volgendeReview: e.target.value || undefined })}
              />
            </label>
          </div>

          <div className="bm-acties">
            <button className="btn-primair" disabled={bezig} onClick={() => void opslaan()}>
              💾 Koppeling opslaan
            </button>
            {melding && <span className="muted">{melding}</span>}
          </div>
        </>
      )}
    </section>
  )
}
