import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

function browserSessionLifecycle(): Plugin {
  return {
    name: 'n1ssan-browser-session-lifecycle',
    configureServer(server) {
      let sessionWasSeen = false
      let stopping = false
      let checking = false

      const stopWebServer = () => {
        if (stopping || !sessionWasSeen) return
        stopping = true
        clearInterval(timer)
        console.log('[n1ssan Web] No browser sessions remain. Stopping Vite.')
        void server.close().finally(() => process.exit(0))
      }

      const timer = setInterval(async () => {
        if (checking || stopping) return
        checking = true
        try {
          const response = await fetch('http://127.0.0.1:3210/session/active', {
            signal: AbortSignal.timeout(1500),
            cache: 'no-store',
          })
          if (!response.ok) throw new Error(`Bridge session check returned ${response.status}`)
          const state = await response.json() as { active?: boolean }
          if (state.active === true) sessionWasSeen = true
          else if (sessionWasSeen) stopWebServer()
        } catch {
          // Once a browser session has existed, a stopped Bridge means the
          // browser workspace has ended and Vite must not remain orphaned.
          if (sessionWasSeen) stopWebServer()
        } finally {
          checking = false
        }
      }, 2_000)

      server.httpServer?.once('close', () => clearInterval(timer))
    },
  }
}

// Keep the existing application and Obsidian as independent HTML entry points.
export default defineConfig({
  plugins: [react(), browserSessionLifecycle()],
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        obsidian: 'obsidian.html',
      },
    },
  },
})
