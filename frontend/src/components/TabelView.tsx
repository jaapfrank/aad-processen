import { Link } from 'react-router-dom'
import type { Process, Step } from '../contract'
import { typeLabel, laneNaam, laneKleur } from '../lib/proces'

/** Werkinstructie-tabel, automatisch gegenereerd uit het procesmodel. */
export function TabelView({
  proces,
  onSelect,
  highlightLane,
}: {
  proces: Process
  onSelect?: (s: Step) => void
  highlightLane?: string
}) {
  const secties =
    proces.secties.length > 0 ? proces.secties : [{ id: '', naam: proces.detailproces }]

  return (
    <>
      {secties.map((sectie) => (
        <section key={sectie.id} className="sectie">
          <h2>{sectie.naam}</h2>
          <table className="werkinstructie">
            <thead>
              <tr>
                <th>Verantwoordelijke</th>
                <th>Stap</th>
                <th>Activiteit</th>
                <th>Opmerking</th>
              </tr>
            </thead>
            <tbody>
              {proces.stappen
                .filter((s) => (sectie.id ? s.sectieId === sectie.id : true))
                .map((s) => (
                  <tr
                    key={s.id}
                    className={`${onSelect ? 'klikbaar' : ''}${highlightLane && s.laneId !== highlightLane ? ' rij-dim' : ''}`}
                    onClick={() => onSelect?.(s)}
                  >
                    <td>
                      <span className="lane-chip" style={{ borderColor: laneKleur(proces, s.laneId) }}>
                        <span className="lane-dot" style={{ background: laneKleur(proces, s.laneId) }} />
                        {laneNaam(proces, s.laneId)}
                      </span>
                    </td>
                    <td className="stap-nr">{s.nummer}</td>
                    <td>
                      <div className="act">{s.activiteit}</div>
                      {s.type !== 'actie' && (
                        <span className="type-tag">
                          {typeLabel[s.type]}
                          {s.doelLaneId ? ` → ${laneNaam(proces, s.doelLaneId)}` : ''}
                        </span>
                      )}
                      {s.toelichting && <div className="toelichting">{s.toelichting}</div>}
                      {s.naarProces && (
                        <div className="koppeling">
                          <Link to={`/proces/${s.naarProces}`} onClick={(e) => e.stopPropagation()}>
                            → {s.naarProces}
                          </Link>
                        </div>
                      )}
                    </td>
                    <td className="opm">
                      {s.opmerking}
                      {s.zijnotitie && <div className="zij">{s.zijnotitie}</div>}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
      ))}
    </>
  )
}
