/** Parse observed repairs without dropping tokens or creating empty observations. */
export function parseRepairTimes(text: string, frequency = false): { samples: number[]; frequencies?: number[] } {
  const number = (token: string, where: string) => {
    if (!/^[+]?((\d+(\.\d*)?)|(\.\d+))([eE][+-]?\d+)?$/.test(token) || !Number.isFinite(Number(token)) || Number(token) <= 0)
      throw new Error(`${where}: “${token}” must be a positive finite number.`)
    return Number(token)
  }
  const trimmed = text.trim()
  if (!trimmed) throw new Error('Enter repair durations.')
  if (!frequency) return { samples: trimmed.split(/[\s,]+/).map((token, i) => number(token, `Observation ${i + 1}`)) }
  const samples: number[] = [], frequencies: number[] = []
  trimmed.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return
    const parts = line.trim().split(/[\s,]+/)
    if (parts.length !== 2) throw new Error(`Row ${i + 1}: enter duration and frequency.`)
    samples.push(number(parts[0], `Row ${i + 1} duration`))
    const count = number(parts[1], `Row ${i + 1} frequency`)
    if (!Number.isSafeInteger(count)) throw new Error(`Row ${i + 1}: frequency must be a positive integer.`)
    frequencies.push(count)
  })
  return { samples, frequencies }
}
