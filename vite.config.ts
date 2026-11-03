import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Keep the existing application and Obsidian as independent HTML entry points.
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        obsidian: 'obsidian.html',
      },
    },
  },
})
