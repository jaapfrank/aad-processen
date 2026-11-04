import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// "Procesheld" — persoonlijk punten- en badgesysteem dat het gebruik van de
// gids leuk maakt. Bewust lokaal per browser (geen ranglijst, geen afrekenen):
// het beloont leren en verbeteren, niet onderlinge competitie.

export type PuntActie = 'route' | 'route-oefening' | 'suggestie' | 'proces-bekeken' | 'proces-gebouwd'

export const PUNTEN: Record<PuntActie, number> = {
  route: 10,
  'route-oefening': 5,
  suggestie: 15,
  'proces-bekeken': 2,
  'proces-gebouwd': 20,
}

export interface Badge {
  id: string
  icon: string
  naam: string
  omschrijving: string
}

export const BADGES: Badge[] = [
  { id: 'eerste-route', icon: '🏁', naam: 'Eerste route', omschrijving: 'Je eerste route afgerond in de begeleide modus.' },
  { id: 'routinier', icon: '🏆', naam: 'Routinier', omschrijving: '10 routes afgerond — jij kent de weg.' },
  { id: 'verkenner', icon: '🧭', naam: 'Procesverkenner', omschrijving: '10 verschillende processen bekeken.' },
  { id: 'verbeteraar', icon: '💡', naam: 'Verbeteraar', omschrijving: '5 suggesties ingediend — processen worden beter door jou.' },
  { id: 'bouwer', icon: '🏗️', naam: 'Bouwer', omschrijving: 'Je eerste proces gebouwd of bewerkt.' },
  { id: 'sprinter', icon: '⚡', naam: 'Sprinter', omschrijving: '3 routes op één dag afgerond.' },
]

export const NIVEAUS: Array<{ vanaf: number; naam: string; icon: string }> = [
  { vanaf: 0, naam: 'Starter', icon: '🌱' },
  { vanaf: 50, naam: 'Kenner', icon: '📘' },
  { vanaf: 150, naam: 'Expert', icon: '🎯' },
  { vanaf: 300, naam: 'Procesheld', icon: '🦸' },
]

export const niveauVoor = (punten: number) =>
  [...NIVEAUS].reverse().find((n) => punten >= n.vanaf) ?? NIVEAUS[0]

interface PuntenState {
  punten: number
  routes: number
  suggesties: number
  gebouwd: number
  bekeken: string[]
  routesVandaag: { datum: string; aantal: number }
  badges: string[]
  /** Laatst verdiende badge, voor de felicitatie-toast. */
  laatsteBadge: Badge | null
  kenToe: (actie: PuntActie, procesId?: string) => void
  wisToast: () => void
}

export const usePunten = create<PuntenState>()(
  persist(
    (set, get) => ({
      punten: 0,
      routes: 0,
      suggesties: 0,
      gebouwd: 0,
      bekeken: [],
      routesVandaag: { datum: '', aantal: 0 },
      badges: [],
      laatsteBadge: null,
      wisToast: () => set({ laatsteBadge: null }),
      kenToe: (actie, procesId) => {
        const s = get()
        // "Proces bekeken" telt alleen de eerste keer per proces.
        if (actie === 'proces-bekeken' && (!procesId || s.bekeken.includes(procesId))) return

        const vandaag = new Date().toISOString().slice(0, 10)
        const routesVandaag =
          actie === 'route' || actie === 'route-oefening'
            ? { datum: vandaag, aantal: (s.routesVandaag.datum === vandaag ? s.routesVandaag.aantal : 0) + 1 }
            : s.routesVandaag

        const next = {
          punten: s.punten + PUNTEN[actie],
          routes: s.routes + (actie === 'route' || actie === 'route-oefening' ? 1 : 0),
          suggesties: s.suggesties + (actie === 'suggestie' ? 1 : 0),
          gebouwd: s.gebouwd + (actie === 'proces-gebouwd' ? 1 : 0),
          bekeken: actie === 'proces-bekeken' && procesId ? [...s.bekeken, procesId] : s.bekeken,
          routesVandaag,
        }

        // Nieuwe badges bepalen.
        const verdiend = new Set(s.badges)
        const check = (id: string, voorwaarde: boolean) => {
          if (voorwaarde && !verdiend.has(id)) verdiend.add(id)
        }
        check('eerste-route', next.routes >= 1)
        check('routinier', next.routes >= 10)
        check('verkenner', next.bekeken.length >= 10)
        check('verbeteraar', next.suggesties >= 5)
        check('bouwer', next.gebouwd >= 1)
        check('sprinter', routesVandaag.aantal >= 3)

        const nieuw = [...verdiend].find((id) => !s.badges.includes(id))
        set({
          ...next,
          badges: [...verdiend],
          laatsteBadge: nieuw ? BADGES.find((b) => b.id === nieuw) ?? null : s.laatsteBadge,
        })
      },
    }),
    { name: 'spg-punten' },
  ),
)
