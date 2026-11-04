import '../browser-session'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import ObsidianApp from './ObsidianApp'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ObsidianApp />
  </StrictMode>,
)
