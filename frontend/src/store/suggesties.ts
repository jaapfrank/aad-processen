import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Suggestion, SuggestionStatus } from '../contract'

// Suggesties per stap. Lokaal bewaard in mock-modus; in API-modus loopt dit
// via POST /api/processes/{id}/steps/{stepId}/suggestions (zie data.ts).

interface SuggestiesState {
  suggesties: Suggestion[]
  indienen: (s: Suggestion) => void
  bijwerken: (id: string, status: SuggestionStatus) => void
}

export const useSuggesties = create<SuggestiesState>()(
  persist(
    (set) => ({
      suggesties: [],
      indienen: (s) => set((st) => ({ suggesties: [...st.suggesties, s] })),
      bijwerken: (id, status) =>
        set((st) => ({
          suggesties: st.suggesties.map((s) => (s.id === id ? { ...s, status } : s)),
        })),
    }),
    { name: 'spg-suggesties' },
  ),
)
