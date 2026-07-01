import Papa from 'papaparse'

export interface ParsedCsv {
  headers: string[]
  rows: Record<string, string>[]
  /** Raw file text — for modules that consume a pasted-text block directly. */
  text: string
  /** Papa parse errors (malformed rows etc.), if any — for user feedback. */
  errors: string[]
}

/**
 * Parse a CSV/TSV/whitespace file (or text) into headers + rows using papaparse.
 * Robust to quoted values and escaped delimiters, unlike a hand-rolled split.
 * Delimiter is auto-detected (comma, tab, semicolon, pipe, space).
 */
export function parseCsv(input: File | string): Promise<ParsedCsv> {
  return new Promise((resolve, reject) => {
    const done = (text: string, res: Papa.ParseResult<Record<string, string>>) => {
      const headers = (res.meta.fields ?? []).map(h => h.trim()).filter(Boolean)
      const rows = (res.data ?? []).filter(r => r && Object.values(r).some(v => String(v ?? '').trim() !== ''))
      const errors = (res.errors ?? []).map(e => e.message)
      resolve({ headers, rows, text, errors })
    }
    const config: Papa.ParseConfig<Record<string, string>> = {
      header: true,
      skipEmptyLines: 'greedy',
      delimitersToGuess: [',', '\t', ';', '|', ' '],
      transformHeader: h => h.trim(),
    }
    if (typeof input === 'string') {
      const res = Papa.parse<Record<string, string>>(input, config)
      done(input, res)
    } else {
      const reader = new FileReader()
      reader.onerror = () => reject(new Error('Could not read file.'))
      reader.onload = () => {
        const text = String(reader.result ?? '')
        const res = Papa.parse<Record<string, string>>(text, config)
        done(text, res)
      }
      reader.readAsText(input)
    }
  })
}
