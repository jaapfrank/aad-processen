import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useApp } from './appState'
import { Layout } from './components/Layout'
import { Login } from './pages/Login'
import { Overzicht } from './pages/Overzicht'
import { ProcesDetail } from './pages/ProcesDetail'

// Secundaire pagina's lazy: kleinere startbundel, snellere eerste lading.
const Atlas = lazy(() => import('./pages/Atlas').then((m) => ({ default: m.Atlas })))
const Zoeken = lazy(() => import('./pages/Zoeken').then((m) => ({ default: m.Zoeken })))
const Begeleid = lazy(() => import('./pages/Begeleid').then((m) => ({ default: m.Begeleid })))
const Bouwer = lazy(() => import('./pages/Bouwer').then((m) => ({ default: m.Bouwer })))
const Iso = lazy(() => import('./pages/Iso').then((m) => ({ default: m.Iso })))
const Beheer = lazy(() => import('./pages/Beheer').then((m) => ({ default: m.Beheer })))
const ImportPagina = lazy(() => import('./pages/Import').then((m) => ({ default: m.ImportPagina })))
const Uitwisseling = lazy(() => import('./pages/Uitwisseling').then((m) => ({ default: m.Uitwisseling })))
const Gids = lazy(() => import('./pages/Gids').then((m) => ({ default: m.Gids })))
const Punten = lazy(() => import('./pages/Punten').then((m) => ({ default: m.Punten })))
const Kiosk = lazy(() => import('./pages/Kiosk').then((m) => ({ default: m.Kiosk })))
const Ai = lazy(() => import('./pages/Ai').then((m) => ({ default: m.Ai })))
const AiDiagram = lazy(() => import('./pages/AiDiagram').then((m) => ({ default: m.AiDiagram })))
const Dashboard = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })))
const Beheersing = lazy(() =>
  import('./pages/Beheersing').then((m) => ({ default: m.Beheersing })),
)
const Normcoach = lazy(() =>
  import('./pages/Normcoach').then((m) => ({ default: m.Normcoach })),
)

const laden = <p className="muted app-laden">Laden…</p>

export default function App() {
  const { loading, user, startupError, retryStartup } = useApp()

  if (loading) return laden
  if (startupError) {
    return (
      <div className="login-scherm">
        <section className="login-kaart" role="alert">
          <h1>Server niet bereikbaar</h1>
          <p>{startupError}</p>
          <button className="btn-primair" type="button" onClick={retryStartup}>
            Opnieuw proberen
          </button>
          {import.meta.env.DEV && (
            <p className="muted">
              Start lokaal eerst de backend op poort 5088. De app schakelt nooit automatisch over
              op voorbeelddata.
            </p>
          )}
        </section>
      </div>
    )
  }
  if (!user) return <Login />

  return (
    <Suspense fallback={laden}>
      <Routes>
        <Route path="kiosk" element={<Kiosk />} />
        <Route element={<Layout />}>
          <Route index element={<Overzicht />} />
          <Route path="beheersing" element={<Beheersing />} />
          <Route path="normcoach" element={<Normcoach />} />
          <Route path="proces/:id" element={<ProcesDetail />} />
          <Route path="atlas" element={<Atlas />} />
          <Route path="zoeken" element={<Zoeken />} />
          <Route path="begeleid" element={<Begeleid />} />
          <Route path="bouwer" element={<Bouwer />} />
          <Route path="bouwer/:id" element={<Bouwer />} />
          <Route path="iso" element={<Iso />} />
          <Route path="import" element={<ImportPagina />} />
          <Route path="uitwisseling" element={<Uitwisseling />} />
          <Route path="beheer" element={<Beheer />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="gids" element={<Gids />} />
          <Route path="punten" element={<Punten />} />
          <Route path="ai" element={<Ai />} />
          <Route path="ai-diagram" element={<AiDiagram />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  )
}
