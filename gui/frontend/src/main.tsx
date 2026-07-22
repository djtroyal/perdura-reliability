import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { KeyboardShortcutProvider } from './components/shared/KeyboardShortcuts'
import { installDynamicImportRecovery } from './components/shared/dynamicImportRecovery'
import ServerCompatibilityBoundary from './components/shared/ServerCompatibilityBoundary'

const uninstallDynamicImportRecovery = installDynamicImportRecovery()
if (import.meta.hot) import.meta.hot.dispose(uninstallDynamicImportRecovery)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ServerCompatibilityBoundary>
      <KeyboardShortcutProvider>
        <App />
      </KeyboardShortcutProvider>
    </ServerCompatibilityBoundary>
  </StrictMode>,
)
