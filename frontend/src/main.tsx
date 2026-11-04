import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import './ui.css'
import App from './App.tsx'
import { AppProviders } from './providers.tsx'
import { initThema } from './lib/thema'
import { initHuisstijl } from './lib/huisstijl'

initThema()
void initHuisstijl()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AppProviders>
        <App />
      </AppProviders>
    </BrowserRouter>
  </StrictMode>,
)
