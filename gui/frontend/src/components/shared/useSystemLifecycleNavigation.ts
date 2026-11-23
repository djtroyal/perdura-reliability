import { useEffect, useRef } from 'react'
import { useBookmarkNavigationTarget } from '../../store/bookmarks'

export function useSystemLifecycleNavigation(module: 'system' | 'faultTree', analysisId: string, open: () => void) {
  const target = useBookmarkNavigationTarget()
  const applied = useRef(0)
  useEffect(() => {
    if (!target || target.nonce === applied.current || target.source.module !== module || target.source.view !== 'lifecycle') return
    if (target.source.analysisId && target.source.analysisId !== analysisId) return
    applied.current = target.nonce
    open()
  }, [target, module, analysisId, open])
}
