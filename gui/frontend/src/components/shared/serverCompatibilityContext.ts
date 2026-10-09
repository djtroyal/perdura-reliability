import { createContext } from 'react'

// A standalone shortcut provider has no compatibility gate. App providers
// inherit the lock from their nearest server boundary without querying globals.
export const ServerCompatibilityLockContext = createContext(false)
