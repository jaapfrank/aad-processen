import { NavLink, useLocation } from 'react-router-dom'
import { useHasRole } from '../appState'
import { useRef, useState } from 'react'

interface NavItem {
  to: string
  label: string
  icon: string
  end?: boolean
  /** Vereiste rol; zonder rol wordt het item verborgen (alleen-lezen modus). */
  rol?: 'bewerken' | 'beheren' | 'reviewen'
}

interface NavGroep {
  label: string
  items: NavItem[]
}

const groepen: NavGroep[] = [
  {
    label: 'Mijn werk',
    items: [
      { to: '/dashboard', label: 'Procesmanager', icon: '◉', rol: 'reviewen' },
      { to: '/', label: 'Processen', icon: '🗂️', end: true },
      { to: '/begeleid', label: 'Stap voor stap', icon: '▶️' },
      { to: '/zoeken', label: 'Zoeken', icon: '🔎' },
    ],
  },
  {
    label: 'Normen & borging',
    items: [
      { to: '/normcoach', label: 'Normcoach', icon: '◆', rol: 'reviewen' },
      { to: '/beheersing', label: 'Beheersing', icon: '◉', rol: 'reviewen' },
      { to: '/iso', label: 'Normen & audits', icon: '🛡️' },
      { to: '/beheer?tab=normen', label: 'Normenkader', icon: '⚑', rol: 'beheren' },
    ],
  },
  {
    label: 'Ontwerpen & verbeteren',
    items: [
      { to: '/atlas', label: 'Procesatlas', icon: '🧭' },
      { to: '/ai', label: 'AI-assistent', icon: '🤖' },
      { to: '/ai-diagram', label: 'AI-procesontwerp', icon: '✨', rol: 'bewerken' },
      { to: '/bouwer', label: 'Proceseditor', icon: '✏️', rol: 'bewerken' },
      { to: '/uitwisseling', label: 'Import & export', icon: '⇄', rol: 'bewerken' },
    ],
  },
  {
    label: 'Beheer & hulp',
    items: [
      { to: '/beheer', label: 'Instellingen', icon: '⚙️', rol: 'bewerken' },
      { to: '/punten', label: 'Mijn voortgang', icon: '🏅' },
      { to: '/kiosk', label: 'Kiosk', icon: '📺' },
      { to: '/gids', label: 'Gids', icon: '📖' },
    ],
  },
]

export function Sidebar() {
  const magBewerken = useHasRole('bewerken')
  const magGoedkeuren = useHasRole('goedkeuren')
  const magBeheren = useHasRole('beheren')
  const locatie = useLocation()
  const [openLocatie, setOpenLocatie] = useState<string | null>(null)
  const menuKnop = useRef<HTMLButtonElement>(null)
  const menuOpen = openLocatie === locatie.key

  const isZichtbaar = (it: NavItem) => {
    if (it.rol === 'bewerken') return magBewerken || magBeheren
    if (it.rol === 'beheren') return magBeheren
    if (it.rol === 'reviewen') return magBewerken || magGoedkeuren || magBeheren
    return true
  }

  const isQueryActief = (it: NavItem) => {
    const [pad, query = ''] = it.to.split('?')
    if (!query) {
      if (it.to === '/beheer') {
        return locatie.pathname === '/beheer' && locatie.search !== '?tab=normen'
      }
      return null
    }
    return locatie.pathname === pad && locatie.search === `?${query}`
  }

  return (
    <nav className="sidebar" aria-label="Hoofdnavigatie" onKeyDown={(event) => {
      if (event.key === 'Escape' && menuOpen) { setOpenLocatie(null); menuKnop.current?.focus() }
    }}>
      <button ref={menuKnop} className="sidebar-toggle" type="button" aria-expanded={menuOpen}
        aria-controls="sidebar-links" onClick={() => setOpenLocatie(menuOpen ? null : locatie.key)}>
        <span aria-hidden="true">☰</span> Menu <span aria-hidden="true">{menuOpen ? '−' : '+'}</span>
      </button>
      <div id="sidebar-links" className={`sidebar-links${menuOpen ? ' is-open' : ''}`}>
      {groepen.map((groep) => {
        const items = groep.items.filter(isZichtbaar)
        if (items.length === 0) return null
        return (
          <div className="nav-groep" key={groep.label}>
            <span className="nav-groep-label">{groep.label}</span>
            {items.map((it) => (
              <NavLink
                key={it.to}
                to={it.to}
                end={it.end}
                className={({ isActive }) => {
                  const queryActief = isQueryActief(it)
                  const actief = queryActief === null ? isActive : queryActief
                  return `nav-item${actief ? ' active' : ''}`
                }}
              >
                <span className="nav-icon" aria-hidden="true">
                  {it.icon}
                </span>
                <span className="nav-label">{it.label}</span>
              </NavLink>
            ))}
          </div>
        )
      })}
      </div>
    </nav>
  )
}
