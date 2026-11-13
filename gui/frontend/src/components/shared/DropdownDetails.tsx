import { forwardRef, useImperativeHandle, useRef, useState, type DetailsHTMLAttributes } from 'react'
import { useDismissiblePopover } from './useDismissiblePopover'

/** Use for native details that open a popup; ordinary content disclosures stay open. */
const DropdownDetails = forwardRef<HTMLDetailsElement, Omit<DetailsHTMLAttributes<HTMLDetailsElement>, 'open'>>(
  function DropdownDetails({ onToggle, onClick, ...props }, forwardedRef) {
    const ref = useRef<HTMLDetailsElement>(null)
    const [open, setOpen] = useState(false)
    useImperativeHandle(forwardedRef, () => ref.current!, [])
    useDismissiblePopover({ open, elements: () => [ref.current],
      trigger: () => ref.current?.querySelector('summary'),
      onDismiss: () => { if (ref.current) ref.current.open = false; setOpen(false) },
    })
    return <details {...props} open={open} ref={ref} data-dropdown-menu onClick={event => {
      onClick?.(event)
      const summary = event.target instanceof Element ? event.target.closest('summary') : null
      if (!event.defaultPrevented && summary && summary.parentElement === ref.current) {
        // Native toggle events are queued. Update during activation so Escape
        // immediately after a click cannot race popup registration.
        event.preventDefault()
        setOpen(value => !value)
      }
    }} onToggle={event => {
      setOpen(event.currentTarget.open)
      onToggle?.(event)
    }} />
  },
)

export default DropdownDetails
