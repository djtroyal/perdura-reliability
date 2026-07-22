/// <reference types="vite/client" />

// Injected at build time by vite.config.ts.
declare const __APP_VERSION__: string
declare const __APP_COMMIT__: string
declare const __BUILD_TIMESTAMP__: string
declare const __BUILD_VERIFICATION_REPORT_SHA256__: string
declare const __BUILD_VERIFICATION_RUN_URL__: string

interface Window {
  __PERDURA_EXPORT_SHOWCASE__?: () => unknown
  __PERDURA_LOAD_SHOWCASE__?: (captureId: string) => Promise<boolean>
}
