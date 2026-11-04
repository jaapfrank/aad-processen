import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// Favoriete processen (per browser), zodat veelgebruikte routes bovenaan staan.

interface FavorietenState {
  ids: string[]
  wissel: (id: string) => void
}

export const useFavorieten = create<FavorietenState>()(
  persist(
    (set) => ({
      ids: [],
      wissel: (id) =>
        set((s) => ({
          ids: s.ids.includes(id) ? s.ids.filter((x) => x !== id) : [...s.ids, id],
        })),
    }),
    { name: 'spg-favorieten' },
  ),
)
