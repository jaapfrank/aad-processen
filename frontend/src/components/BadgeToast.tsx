import { useEffect } from 'react'
import { usePunten } from '../store/punten'

/** Felicitatie-toast bij een nieuw verdiende badge; verdwijnt vanzelf. */
export function BadgeToast() {
  const { laatsteBadge, wisToast } = usePunten()

  useEffect(() => {
    if (!laatsteBadge) return
    const timer = setTimeout(wisToast, 5000)
    return () => clearTimeout(timer)
  }, [laatsteBadge, wisToast])

  if (!laatsteBadge) return null

  return (
    <div className="badge-toast" role="status" onClick={wisToast}>
      <span className="badge-toast-icon">{laatsteBadge.icon}</span>
      <div>
        <strong>Badge verdiend: {laatsteBadge.naam}!</strong>
        <div className="muted">{laatsteBadge.omschrijving}</div>
      </div>
    </div>
  )
}
