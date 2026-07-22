import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// App version, in priority order: an explicit build env (set from the git tag
// in CI / the Docker build arg) -> package.json version -> 'dev'. Exposed to the
// app as the compile-time constant __APP_VERSION__.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'))
const APP_VERSION = process.env.VITE_APP_VERSION || pkg.version || 'dev'
const APP_COMMIT = process.env.VITE_APP_COMMIT || process.env.GITHUB_SHA || 'dev'
const BUILD_TIMESTAMP = process.env.VITE_BUILD_TIMESTAMP || new Date().toISOString()
const BUILD_VERIFICATION_REPORT_SHA256 = process.env.VITE_BUILD_VERIFICATION_REPORT_SHA256 || ''
const BUILD_VERIFICATION_RUN_URL = process.env.VITE_BUILD_VERIFICATION_RUN_URL || ''

// Vite 8's Rolldown backend accepts the function form of manualChunks. Keep
// the existing vendor boundaries by mapping modules from each package to the
// same named chunk that Vite 6's object form produced.
const MANUAL_CHUNK_PACKAGES: Record<string, string[]> = {
  plotly: ['plotly.js', 'react-plotly.js'],
  pdf: ['jspdf'],
  imaging: ['html-to-image'],
  flow: ['@xyflow/react'],
  // lucide-animated ships one non-tree-shakeable module (all ~436 icons)
  // and pulls in `motion`; isolate it so it doesn't bloat the app chunk.
  'icons-animated': ['lucide-animated', 'motion'],
}

function manualChunkFor(id: string): string | undefined {
  const normalized = id.replace(/\\/g, '/')
  for (const [chunk, packages] of Object.entries(MANUAL_CHUNK_PACKAGES)) {
    if (packages.some(packageName =>
      normalized.includes(`/node_modules/${packageName}/`))) {
      return chunk
    }
  }
  return undefined
}

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
    __APP_COMMIT__: JSON.stringify(APP_COMMIT),
    __BUILD_TIMESTAMP__: JSON.stringify(BUILD_TIMESTAMP),
    __BUILD_VERIFICATION_REPORT_SHA256__: JSON.stringify(BUILD_VERIFICATION_REPORT_SHA256),
    __BUILD_VERIFICATION_RUN_URL__: JSON.stringify(BUILD_VERIFICATION_RUN_URL),
    // Plotly's has-hover dependency still references the Node-style global.
    // Browsers expose the same shared object as globalThis; Vite 8 no longer
    // injects this compatibility alias automatically.
    global: 'globalThis',
  },
  resolve: {
    // The react-plotly.js CommonJS factory imports React internally. Force it
    // and every lazily loaded plot component to share the renderer's React
    // singleton; a second optimized instance leaves resolveDispatcher() null
    // when ExportablePlotInner calls hooks.
    dedupe: ['react', 'react-dom'],
    alias: [
      // plotly.js/lib (the slim custom bundle) emits a bare `import "buffer/"`
      // side-effect import from its gl/scatter3d stack. That trailing-slash
      // specifier is not resolvable in the browser on its own, so map it (and
      // the plain form) to the installed `buffer` polyfill.
      { find: /^buffer\/$/, replacement: 'buffer' },
    ],
  },
  optimizeDeps: {
    // Plotly is behind React.lazy, so Vite's initial dependency scan cannot
    // reliably discover its CommonJS React factory. If it is optimized on
    // demand, the optimizer invalidates its hash while the browser is loading
    // ExportablePlotInner and leaves that dynamic import pointing at a removed
    // react-plotly__js_factory.js URL. Pre-bundle that small boundary up front;
    // keep Plotly's much larger trace graph in the existing lazy chunk.
    include: [
      'buffer',
      'react-plotly.js/factory',
    ],
    // The factory is CommonJS with an __esModule default. Declaring this up
    // front prevents a late interop correction from invalidating the optimized
    // dependency URL while a lazy plot is loading.
    needsInterop: ['react-plotly.js/factory'],
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
    rolldownOptions: {
      output: {
        // Split heavy vendors into separate, cacheable chunks so they are not
        // bundled into the main entry (which previously produced a single
        // ~6.4 MB chunk). Per-module code is additionally split via React.lazy.
        manualChunks: manualChunkFor,
      },
    },
  },
})
