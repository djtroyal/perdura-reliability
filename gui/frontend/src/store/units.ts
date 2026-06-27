/**
 * Unit conversion for the project-wide "units" field.
 *
 * The units field used to be a cosmetic label only. These helpers give it real
 * meaning: when the user switches between commensurable units (e.g. hours↔days)
 * the time-valued inputs across modules can be rescaled by the right factor.
 *
 * Conversion is only valid *within* a group. `cycles` has no conversion partner
 * (it is a count, not a duration), so it forms its own single-member group.
 */

// Factors are "base units per unit" — hours for the time group, km for length.
const GROUPS: Record<string, Record<string, number>> = {
  time: {
    hours: 1,
    days: 24,
    weeks: 168,
    months: 730.485,   // average month = 365.2425/12 days × 24 h
    years: 8765.82,     // 365.2425 days × 24 h
  },
  length: {
    km: 1,
    miles: 1.609344,
  },
  count: {
    cycles: 1,
  },
}

/** Name of the group a unit belongs to, or null if unknown. */
export function unitGroup(unit: string): string | null {
  for (const [group, members] of Object.entries(GROUPS)) {
    if (unit in members) return group
  }
  return null
}

/** True when both units are in the same group *and* that group has a real
 *  conversion partner (more than one member). */
export function sameGroup(a: string, b: string): boolean {
  if (a === b) return false
  const ga = unitGroup(a)
  const gb = unitGroup(b)
  if (ga == null || gb == null || ga !== gb) return false
  return Object.keys(GROUPS[ga]).length > 1
}

/** Convert a numeric value from one unit to another in the same group.
 *  Returns the value unchanged if the units are not commensurable. */
export function convert(value: number, from: string, to: string): number {
  const gf = unitGroup(from)
  const gt = unitGroup(to)
  if (gf == null || gt == null || gf !== gt) return value
  const factor = GROUPS[gf]
  return (value * factor[from]) / factor[to]
}
