import fs from 'node:fs/promises'

// These contracts load real application modules through SSR, but never request
// browser modules. Replace includes after config merging so the application
// config cannot start an unrelated client dependency build in the background.
export function ssrOnlyVitePlugin() {
  return {
    name: 'perdura-ssr-contract-no-client-optimizer',
    enforce: 'post',
    config(config) {
      config.optimizeDeps = { ...config.optimizeDeps, noDiscovery: true, include: [] }
    },
  }
}

export async function closeViteTestServer(vite, cacheDir, hmrServer) {
  try {
    await vite.close()
  } finally {
    hmrServer?.close()
  }
  // Vite 8 cancels its dependency build during close(), but Rolldown can still
  // finish a cache write. Node retries only transient filesystem errors here,
  // for at most 1.5 seconds of backoff; a persistent failure still fails CI.
  await fs.rm(cacheDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
