import { useHuisstijl } from '../lib/huisstijl'

/** Merkweergave (logo of tekstmerk) — overal hetzelfde, volgt de huisstijl. */
export function Merk() {
  const { stijl } = useHuisstijl()
  return (
    <>
      {stijl.logoDataUrl ? (
        <img className="brand-logo" src={stijl.logoDataUrl} alt={stijl.bedrijfsnaam} />
      ) : (
        <span className="brand-mark">{stijl.bedrijfsnaam}</span>
      )}
      <span className="brand-title">{stijl.appNaam}</span>
    </>
  )
}
