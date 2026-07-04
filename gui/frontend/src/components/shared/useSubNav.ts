import { useEffect, useRef } from 'react'

/** Target sub-tab handed down after an undo/redo (see store `NAV_MAP`/`useSubNav`). */
export interface SubNav { sub: string; nonce: number }

/**
 * When a container module receives a fresh sub-nav target (a new `nonce`), apply
 * it once via `apply`, switching to the submodule whose change is being
 * undone/redone. De-duped by nonce so re-renders don't re-fire.
 */
export function useApplySubNav(navSub: SubNav | null | undefined, apply: (sub: string) => void) {
  const seen = useRef(0)
  useEffect(() => {
    if (!navSub || navSub.nonce === seen.current) return
    seen.current = navSub.nonce
    apply(navSub.sub)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navSub])
}
