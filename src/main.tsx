import './browser-session'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import LoadoutApp, { type Skin } from './LoadoutApp'
import skinData from './skins.json'
import knifeData from './obsidian/knife-skins.json'
import { selectRuntimeMode } from './runtime-mode'

const normalizedPath = window.location.pathname.replace(/\/+$/, '') || '/'
const isLoadoutRoute = normalizedPath === '/loadout' || new URLSearchParams(window.location.search).get('page') === 'loadout'

if (isLoadoutRoute) {
  void selectRuntimeMode('loadout')
}

// Loadout and Armory share one catalogue identity. Knives come from the
// expanded knife catalogue (the same source Obsidian/Armory uses); legacy
// numeric knife rows in skins.json are excluded to avoid duplicate identities.
const isKnife = (skin: Skin) => /knife|kniv/i.test(`${skin.type} ${skin.weapon}`)
const loadoutCatalogue: Skin[] = [
  ...(skinData as Skin[]).filter(skin => !isKnife(skin)),
  ...(knifeData as unknown as Skin[]),
]

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isLoadoutRoute ? <LoadoutApp skins={loadoutCatalogue} /> : <App />}
  </StrictMode>,
)
