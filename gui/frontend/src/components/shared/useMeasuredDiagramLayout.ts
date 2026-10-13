import { useCallback, useEffect, useRef, type MutableRefObject } from 'react'
import { getProjectState } from '../../store/project'
import type { DiagramLayoutOptions } from './adaptiveDiagramLayout.mjs'

/** Apply the new card sizing before reading React Flow's observed dimensions.
 * Project/folio changes and superseding commands cancel the pending layout. */
export function useMeasuredDiagramLayout(
  apply: (options: DiagramLayoutOptions) => void,
  prepare: (options: DiagramLayoutOptions) => void,
  folioId: string,
  pending: MutableRefObject<boolean>,
) {
  const latest = useRef({ apply, prepare, folioId })
  latest.current = { apply, prepare, folioId }
  const sequence = useRef(0)
  useEffect(() => () => { sequence.current++; pending.current = false }, [])
  return useCallback((options: DiagramLayoutOptions) => {
    const request = ++sequence.current
    const project = getProjectState()
    const origin = latest.current.folioId
    const current = () => request === sequence.current && latest.current.folioId === origin
      && getProjectState().identity.projectId === project.identity.projectId
      && getProjectState().revision === project.revision
    pending.current = true
    latest.current.prepare(options)
    const measured = (remaining: number) => requestAnimationFrame(() => {
      if (!current()) { if (request === sequence.current) pending.current = false; return }
      if (remaining) measured(remaining - 1)
      else { pending.current = false; latest.current.apply(options) }
    })
    measured(2)
  }, [])
}
