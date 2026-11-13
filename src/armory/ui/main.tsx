import '../../shared/browser-session'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import ObsidianApp from './ObsidianApp'
import { selectRuntimeMode } from '../../shared/runtime-mode'

void selectRuntimeMode('armory')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ObsidianApp />
  </StrictMode>,
)
