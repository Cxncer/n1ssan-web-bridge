import { APP_VERSION } from '../version'
import './AppVersion.css'

// Release badge pinned to the top-right corner of the Armory and Loadout
// workspaces. It reads the same VERSION file the release build packages.
export function AppVersion() {
  return (
    <span className="n1-version-badge" title={`n1ssan ${APP_VERSION}`} aria-label={`n1ssan release ${APP_VERSION}`}>
      {APP_VERSION}
    </span>
  )
}
