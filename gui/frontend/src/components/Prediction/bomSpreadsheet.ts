import Papa from 'papaparse'
import { BomRegexProfileRevision, ParsedBomTable, detectBomColumns } from './bomImport'

const MAX_FILE_BYTES = 25 * 1024 * 1024
const MAX_ROWS = 100_001
const MAX_COLUMNS = 256

export interface BomSheet {
  name: string
  rows: string[][]
}

export interface BomWorkbook {
  fileName: string
  sheets: BomSheet[]
  warnings: string[]
}

const cellText = (value: unknown): string => {
  if (value == null) return ''
  if (value instanceof Date) return value.toISOString()
  return String(value).trim()
}

const boundedRows = (rows: unknown[][], warnings: string[]): string[][] => {
  if (rows.length > MAX_ROWS) warnings.push(`Only the first ${MAX_ROWS - 1} data rows were loaded.`)
  const selected = rows.slice(0, MAX_ROWS)
  const width = Math.min(MAX_COLUMNS, Math.max(0, ...selected.map(row => row.length)))
  if (selected.some(row => row.length > MAX_COLUMNS)) warnings.push(`Columns after ${MAX_COLUMNS} were ignored.`)
  return selected.map(row => Array.from({ length: width }, (_, index) => cellText(row[index])))
}

export async function readBomWorkbook(file: File): Promise<BomWorkbook> {
  if (file.size > MAX_FILE_BYTES) throw new Error('BOM files are limited to 25 MiB.')
  const extension = file.name.split('.').pop()?.toLowerCase()
  const warnings: string[] = []
  if (extension === 'xlsx') {
    const { default: readXlsxFile } = await import('read-excel-file/browser')
    // ArrayBuffer follows the same deterministic path in browsers and test
    // environments and never exposes a filesystem path to the parser.
    const sheets = await readXlsxFile(await file.arrayBuffer())
    if (!sheets.length) throw new Error('The workbook has no readable worksheets.')
    return {
      fileName: file.name,
      warnings,
      sheets: sheets.map(sheet => ({ name: sheet.sheet, rows: boundedRows(sheet.data, warnings) })),
    }
  }
  if (!['csv', 'tsv', 'txt'].includes(extension ?? '')) {
    throw new Error('Choose a CSV, TSV, TXT, or XLSX electronic BOM.')
  }
  const text = await file.text()
  const parsed = Papa.parse<string[]>(text, {
    header: false,
    skipEmptyLines: 'greedy',
    delimitersToGuess: [',', '\t', ';', '|'],
  })
  warnings.push(...parsed.errors.slice(0, 20).map(error => `Row ${error.row == null ? '?' : error.row + 1}: ${error.message}`))
  return {
    fileName: file.name,
    warnings,
    sheets: [{ name: 'BOM', rows: boundedRows(parsed.data, warnings) }],
  }
}

export function detectBomHeaderRow(rows: string[][], profile?: BomRegexProfileRevision): number {
  let bestRow = 0
  let bestScore = -1
  for (let index = 0; index < Math.min(25, rows.length); index += 1) {
    const cells = rows[index].map(cell => cell.trim()).filter(Boolean)
    const mappings = detectBomColumns(cells, profile)
    const known = Object.keys(mappings).length
    const unique = new Set(cells.map(cell => cell.toLowerCase())).size
    const density = cells.length ? unique / cells.length : 0
    const score = known * 20 + Math.min(cells.length, 12) + density
    if (score > bestScore) { bestScore = score; bestRow = index }
  }
  return bestRow
}

const uniqueHeaders = (row: string[]): string[] => {
  const seen = new Map<string, number>()
  return row.map((raw, index) => {
    const base = raw.trim() || `Column ${index + 1}`
    const key = base.toLowerCase()
    const count = (seen.get(key) ?? 0) + 1
    seen.set(key, count)
    return count === 1 ? base : `${base} (${count})`
  })
}

export function bomTableFromSheet(
  workbook: BomWorkbook,
  sheetIndex: number,
  headerRow: number,
): ParsedBomTable {
  const sheet = workbook.sheets[sheetIndex]
  if (!sheet) throw new Error('Choose a valid worksheet.')
  if (headerRow < 0 || headerRow >= sheet.rows.length) throw new Error('Choose a valid header row.')
  const headers = uniqueHeaders(sheet.rows[headerRow])
  const rows = sheet.rows.slice(headerRow + 1)
    .filter(row => row.some(value => value.trim()))
    .map(row => Object.fromEntries(headers.map((header, index) => [header, cellText(row[index])])))
  return {
    fileName: workbook.fileName,
    sheet: sheet.name,
    headerRow: headerRow + 1,
    headers,
    rows,
    warnings: [...workbook.warnings],
  }
}
