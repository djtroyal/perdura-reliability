export function finiteInput(text: string, label: string): number {
  if (!text.trim() || !Number.isFinite(Number(text))) throw new Error(`${label} must be a finite number.`)
  return Number(text)
}
export function numericList(text: string, label: string): number[] {
  if (!text.trim()) return []
  return text.trim().split(/[\s,;]+/).map((token, index) => finiteInput(token, `${label}, entry ${index + 1}`))
}
export function outcomeList(text: string): number[] {
  const values = numericList(text, 'Outcome')
  if (values.some(value => value !== 0 && value !== 1)) throw new Error('Outcomes must be 0 (good) or 1 (defective).')
  return values
}
export function exposureRows(text: string) {
  if (!text.trim()) throw new Error('Enter at least one exposure row.')
  return text.trim().split(/\n+/).map((line, index) => {
    const cells = line.trim().split(/[,\t ]+/)
    if (cells.length !== 3) throw new Error(`Exposure row ${index + 1} requires units, duration, duty.`)
    const [units, duration, duty] = cells.map((cell, j) => finiteInput(cell, `Exposure row ${index + 1}, column ${j + 1}`))
    if (!Number.isInteger(units) || units < 1 || duration <= 0 || duty < 0 || duty > 1) throw new Error(`Exposure row ${index + 1}: positive units/duration and duty from 0 to 1 are required.`)
    return { label: `Group ${index + 1}`, units, duration, duty }
  })
}
export function inferenceSignature(state: object): string {
  const { result: _result, ...inputs } = state as Record<string, unknown>
  const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)])) : value
  return JSON.stringify(stable(inputs))
}
export function inferenceResultStatus(state: object, units: string): { current: boolean; reason: string } {
  const result = (state as { result?: Record<string, unknown> | null }).result
  if (!result) return { current: false, reason: 'Not calculated' }
  if (!result._inputSignature) return { current: false, reason: 'Saved inputs are unverified; recalculate' }
  if (result._units !== units) return { current: false, reason: 'Project units changed; recalculate' }
  if (result._inputSignature !== inferenceSignature(state)) return { current: false, reason: 'Calculation inputs changed; recalculate' }
  return { current: true, reason: '' }
}
