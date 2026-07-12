/** Convert the limited HTML accepted by Plotly titles into display-only text. */
export function htmlToPlainText(input: string): string {
  if (!input) return ''
  if (typeof DOMParser === 'undefined') {
    // Server-side/test environments do not provide DOMParser. Removing each
    // delimiter independently cannot expose a nested tag through a single-pass
    // multi-character replacement.
    return input.replace(/[<>]/g, '').trim()
  }
  const document = new DOMParser().parseFromString(input, 'text/html')
  return (document.body.textContent ?? '').trim()
}

/** Escape untrusted text before inserting it into standalone HTML markup. */
export function escapeHtmlText(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Serialize data for an inline script without allowing JSON strings to close
 * the script element or introduce HTML parsing ambiguities.
 */
export function jsonForInlineScript(value: unknown): string {
  return (JSON.stringify(value) ?? 'null')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}
