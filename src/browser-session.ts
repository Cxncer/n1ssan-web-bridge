// One heartbeat per browser tab. The Bridge expires abandoned sessions after 30 seconds.
const BRIDGE = 'http://127.0.0.1:3210'
const sessionId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
  ? crypto.randomUUID()
  : `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`

async function heartbeat(): Promise<void> {
  try {
    await fetch(`${BRIDGE}/session/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
      cache: 'no-store',
      keepalive: true,
    })
  } catch {
    // A transient local Bridge restart is recovered by the next heartbeat.
  }
}

void heartbeat()
window.setInterval(() => { void heartbeat() }, 5_000)
