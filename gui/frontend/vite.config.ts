import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
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
        manualChunks: {
          plotly: ['plotly.js-dist-min', 'react-plotly.js'],
          pdf: ['jspdf'],
          imaging: ['html-to-image'],
          flow: ['@xyflow/react'],
        },
      },
    },
  },
})
