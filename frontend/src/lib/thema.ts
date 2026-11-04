// Licht/donker thema: voorkeur van de gebruiker, bewaard per browser.
// Standaard volgt het systeem (prefers-color-scheme).

const SLEUTEL = 'spg-thema'

export type Thema = 'licht' | 'donker'

export function huidigThema(): Thema {
  const bewaard = localStorage.getItem(SLEUTEL)
  if (bewaard === 'licht' || bewaard === 'donker') return bewaard
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'donker' : 'licht'
}

export function pasThemaToe(thema: Thema): void {
  document.documentElement.dataset.thema = thema
}

export function initThema(): void {
  pasThemaToe(huidigThema())
}

export function wisselThema(): Thema {
  const nieuw: Thema = huidigThema() === 'donker' ? 'licht' : 'donker'
  localStorage.setItem(SLEUTEL, nieuw)
  pasThemaToe(nieuw)
  return nieuw
}
