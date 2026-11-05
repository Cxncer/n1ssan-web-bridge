import './browser-session'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import LoadoutBuilder, { type Skin } from './LoadoutBuilder'
import skinData from './skins.json'

const normalizedPath = window.location.pathname.replace(/\/+$/, '') || '/'
const isLoadoutRoute = normalizedPath === '/loadout' || new URLSearchParams(window.location.search).get('page') === 'loadout'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isLoadoutRoute ? <LoadoutBuilder skins={skinData as Skin[]} /> : <App />}
  </StrictMode>,
)
