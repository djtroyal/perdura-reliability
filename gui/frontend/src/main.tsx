import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { KeyboardShortcutProvider } from './components/shared/KeyboardShortcuts'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <KeyboardShortcutProvider>
      <App />
    </KeyboardShortcutProvider>
  </StrictMode>,
)
