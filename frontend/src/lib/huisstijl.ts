import { create } from 'zustand'

// Eigen huisstijl (white-label): naam, kleuren en logo uit /api/branding.
// Wordt vóór het renderen geladen zodat ook het inlogscherm in stijl staat.

export interface Huisstijl {
  bedrijfsnaam: string
  appNaam: string
  primaireKleur: string
  accentKleur: string
  logoDataUrl?: string | null
}

export const STANDAARD: Huisstijl = {
  bedrijfsnaam: 'PROCESGIDS',
  appNaam: 'Processen & borging',
  primaireKleur: '#ea5b0c',
  accentKleur: '#e2231a',
  logoDataUrl: null,
}

export const useHuisstijl = create<{ stijl: Huisstijl; zet: (s: Huisstijl) => void }>((set) => ({
  stijl: STANDAARD,
  zet: (stijl) => set({ stijl }),
}))

/** Donkerdere tint voor hover/links (eenvoudige RGB-schaal). */
function donkerder(hex: string, factor = 0.82): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return hex
  const n = parseInt(m[1], 16)
  const kanaal = (shift: number) => Math.round(((n >> shift) & 0xff) * factor)
  return `#${((kanaal(16) << 16) | (kanaal(8) << 8) | kanaal(0)).toString(16).padStart(6, '0')}`
}

function luminantie(hex: string): number {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) return 0
  const waarden = [0, 2, 4].map((start) => {
    const kanaal = parseInt(match[1].slice(start, start + 2), 16) / 255
    return kanaal <= 0.04045 ? kanaal / 12.92 : ((kanaal + 0.055) / 1.055) ** 2.4
  })
  return waarden[0] * 0.2126 + waarden[1] * 0.7152 + waarden[2] * 0.0722
}

export function pasHuisstijlToe(stijl: Huisstijl): void {
  const root = document.documentElement.style
  root.setProperty('--procesgids-orange', stijl.primaireKleur)
  let tekstKleur = donkerder(stijl.primaireKleur)
  for (let i = 0; i < 20 && luminantie(tekstKleur) > 0.18; i++) tekstKleur = donkerder(tekstKleur)
  root.setProperty('--procesgids-orange-dark', tekstKleur)
  root.setProperty('--on-primary', luminantie(stijl.primaireKleur) > 0.179 ? '#000000' : '#ffffff')
  root.setProperty('--procesgids-red', stijl.accentKleur)
  document.title = stijl.appNaam
  useHuisstijl.getState().zet(stijl)
}

/** Laadt de huisstijl van de server (anoniem); valt stil terug op standaard. */
export async function initHuisstijl(): Promise<void> {
  const databron =
    import.meta.env.DEV && import.meta.env.VITE_DATA_SOURCE === 'mock' ? 'mock' : 'api'
  if (databron !== 'api') {
    pasHuisstijlToe(STANDAARD)
    return
  }

  try {
    const res = await fetch('/api/branding')
    if (!res.ok) return
    const b = (await res.json()) as Huisstijl
    if (b && b.primaireKleur) pasHuisstijlToe(b)
  } catch {
    // mock-modus of server onbereikbaar: standaardstijl
  }
}
