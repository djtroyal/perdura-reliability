import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// App version, in priority order: an explicit build env (set from the git tag
// in CI / the Docker build arg) -> package.json version -> 'dev'. Exposed to the
// app as the compile-time constant __APP_VERSION__.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'))
const APP_VERSION = process.env.VITE_APP_VERSION || pkg.version || 'dev'

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  resolve: {
    alias: [
      // plotly.js/lib (the slim custom bundle) emits a bare `import "buffer/"`
      // side-effect import from its gl/scatter3d stack. That trailing-slash
      // specifier is not resolvable in the browser on its own, so map it (and
      // the plain form) to the installed `buffer` polyfill.
      { find: /^buffer\/$/, replacement: 'buffer' },
    ],
  },
  optimizeDeps: {
    include: ['buffer'],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Split heavy vendors into separate, cacheable chunks so they are not
        // bundled into the main entry (which previously produced a single
        // ~6.4 MB chunk). Per-module code is additionally split via React.lazy.
        manualChunks(id) {
          if (id.includes('plotly.js')) return 'plotly';
          if (id.includes('jspdf')) return 'pdf';
          if (id.includes('html-to-image')) return 'imaging';
          if (id.includes('@xyflow/react')) return 'flow';
          // lucide-animated ships one non-tree-shakeable module (all ~436 icons)
          // and pulls in `motion`; isolate it so it doesn't bloat the app chunk.
          if (id.includes('lucide-animated') || id.includes('/motion/')) return 'icons-animated';
        },
      },
    },
  },
})
