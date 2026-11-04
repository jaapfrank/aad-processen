import { useMemo, useState } from 'react'
import type { Process } from '../contract'
import { herkenKolommen, leesTabel, maakTabelProces, tabelVelden, type KolomMapping, type TabelBron } from '../lib/tabelImport'

export function TabelImport({ onImport }: { onImport: (proces: Process) => void }) {
  const [bron, setBron] = useState<TabelBron>()
  const [mapping, setMapping] = useState<KolomMapping>()
  const [bestand, setBestand] = useState('')
  const [inhoud, setInhoud] = useState('')
  const [naam, setNaam] = useState('')
  const [hoofdproces, setHoofdproces] = useState('')
  const [standaardRol, setStandaardRol] = useState('')
  const [verbindRijen, setVerbindRijen] = useState(true)
  const [fout, setFout] = useState('')
  const [laden, setLaden] = useState(false)
  const resultaat = useMemo(() => bron && mapping ? maakTabelProces(bron, mapping, {
    naam, hoofdproces, standaardRol, verbindRijen, bestand,
  }) : undefined, [bron, mapping, naam, hoofdproces, standaardRol, verbindRijen, bestand])
  const heeftRoutes = mapping && (mapping.volgende >= 0 || mapping.ja >= 0 || mapping.nee >= 0)

  const lees = (tekst: string, scheiding?: string) => {
    try {
      const tabel = leesTabel(tekst, scheiding)
      setBron(tabel)
      setMapping(herkenKolommen(tabel.kolommen))
      setFout('')
    } catch (error) {
      setBron(undefined)
      setMapping(undefined)
      setFout(error instanceof Error ? error.message : 'De tabel kon niet worden gelezen.')
    }
  }
  const upload = async (file: File) => {
    setFout('')
    setBron(undefined)
    setMapping(undefined)
    setInhoud('')
    if (file.size > 2 * 1024 * 1024) { setFout('Kies een CSV- of TSV-bestand van maximaal 2 MB en 2.000 stappen.'); return }
    if (!/\.(csv|tsv|txt)$/i.test(file.name)) { setFout('Exporteer de tabel eerst als CSV of TSV. Een Excel-werkmap (.xlsx) kan hier niet direct worden gelezen.'); return }
    setLaden(true)
    try {
      const tekst = await file.text()
      setBestand(file.name)
      setNaam(file.name.replace(/\.[^.]+$/, ''))
      setInhoud(tekst)
      lees(tekst)
    } catch { setFout('Het bestand kon niet worden geopend. Kies het opnieuw.') }
    finally { setLaden(false) }
  }

  return (
    <section className="tabel-import" aria-label="Tabel importeren">
      <h3>Gebruik een bestaande tabel</h3>
      <p>Exporteer een stappenlijst uit Excel, een SharePoint-lijst of een ander systeem als CSV. Koppel hieronder de kolommen en controleer de stappen voordat je verdergaat in de editor.</p>
      <p className="muted">Eén proces per bestand, één stap per rij en kolomnamen op de eerste regel. Het bestand wordt hier in je browser gelezen.</p>
      <label className="tabel-import-bestand">CSV- of TSV-bestand
        <input type="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values" disabled={laden} onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void upload(file)
          event.target.value = ''
        }} />
      </label>
      {laden && <p role="status">Tabel lezen…</p>}
      {fout && <p role="alert" className="login-fout">{fout}</p>}
      {inhoud && <label>Scheidingsteken
        <select value={bron?.scheiding ?? ''} onChange={(event) => lees(inhoud, event.target.value || undefined)}>
          <option value="">Automatisch herkennen</option><option value=";">Puntkomma</option><option value=",">Komma</option><option value={'\t'}>Tab</option>
        </select>
      </label>}
      {bron && mapping && resultaat && <>
        <div className="tabel-import-instellingen">
          <label>Procesnaam<input value={naam} onChange={(event) => setNaam(event.target.value)} /></label>
          <label>Hoofdproces / groep<input placeholder="Bijvoorbeeld Personeel of Kwaliteit" value={hoofdproces} onChange={(event) => setHoofdproces(event.target.value)} /></label>
          <label>Rol als die in een rij ontbreekt<input placeholder="Alleen invullen als dezelfde rol verantwoordelijk is" value={standaardRol} onChange={(event) => setStandaardRol(event.target.value)} /></label>
        </div>
        <h3>Koppel de kolommen</h3>
        <div className="tabel-import-mapping">{tabelVelden.map(([veld, label]) => <label key={veld}>{label}
          <select value={mapping[veld]} onChange={(event) => setMapping({ ...mapping, [veld]: Number(event.target.value) })}>
            <option value={-1}>Niet aanwezig</option>
            {bron.kolommen.map((kolom, i) => <option value={i} key={i}>{i + 1}. {kolom}</option>)}
          </select>
        </label>)}</div>
        <label className="tabel-import-volgorde">
          <input type="checkbox" disabled={Boolean(heeftRoutes)} checked={Boolean(verbindRijen && !heeftRoutes)} onChange={(event) => setVerbindRijen(event.target.checked)} />
          De rijen vormen samen één route in deze volgorde; voeg een start en afronding toe waar die ontbreken.
        </label>
        {heeftRoutes && <p className="muted">De gekoppelde vervolgkolommen bepalen de route. Gebruik daarin exact de waarden uit de kolom Stapnummer / ID.</p>}
        <h3>Controleer de eerste stappen</h3>
        <p>{bron.rijen.length} stappen · {resultaat.proces.lanes.length} rollen · {bestand}</p>
        <div className="tabel-import-preview"><table>
          <thead><tr>{bron.kolommen.map((kolom, i) => <th key={i}>{kolom}</th>)}</tr></thead>
          <tbody>{bron.rijen.slice(0, 8).map((rij, i) => <tr key={i}>{rij.map((waarde, j) => <td key={j}>{waarde || '—'}</td>)}</tr>)}</tbody>
        </table></div>
        {resultaat.fouten.length > 0 && <div role="alert"><h4>Los dit eerst op</h4><ul>{resultaat.fouten.slice(0, 20).map((melding) => <li key={melding}>{melding}</li>)}</ul>
          {resultaat.fouten.length > 20 && <p>En {resultaat.fouten.length - 20} andere fouten. Controleer de brontabel.</p>}
        </div>}
        {resultaat.waarschuwingen.length > 0 && <div role="note"><h4>Controleer in de editor</h4><ul>{resultaat.waarschuwingen.slice(0, 10).map((melding) => <li key={melding}>{melding}</li>)}</ul></div>}
        <button className="btn-primair" disabled={resultaat.fouten.length > 0} onClick={() => onImport(resultaat.proces)}>Open {bron.rijen.length} stappen als concept in de editor</button>
      </>}
    </section>
  )
}
