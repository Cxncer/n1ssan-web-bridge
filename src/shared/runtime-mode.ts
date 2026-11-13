const BRIDGE_URL = 'http://127.0.0.1:3210'

export type RuntimeMode = 'loadout' | 'armory'

/**
 * Selects which dataset the native runtime consumes. Loadout and Armory are
 * mutually exclusive: the DLL applies only the active mode's file.
 */
export async function selectRuntimeMode(mode: RuntimeMode): Promise<void> {
  try {
    await fetch(`${BRIDGE_URL}/runtime-mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    })
  } catch {
    // The Bridge may not be running (offline preview); the mode is best-effort.
  }
}
