import { HelpCircle } from 'lucide-react'

/**
 * A form label with an optional hover tooltip (info icon). The tip shows as a
 * native browser tooltip on the icon and the label, so it works everywhere
 * without extra portals or positioning logic.
 */
export default function InfoLabel({
  children, tip, className = '', htmlFor,
}: {
  children: React.ReactNode
  tip?: string
  className?: string
  htmlFor?: string
}) {
  return (
    <label
      htmlFor={htmlFor}
      title={tip}
      className={`flex items-center gap-1 text-xs font-medium text-gray-700 mb-1 ${className}`}
    >
      <span>{children}</span>
      {tip && (
        <HelpCircle
          size={11}
          className="text-gray-300 hover:text-blue-500 cursor-help flex-shrink-0"
        />
      )}
    </label>
  )
}
