const FAMILY_LABELS: Record<string, string> = {
  weibull: 'Weibull', exponential: 'Exponential', normal: 'Normal',
  lognormal: 'Lognormal', loglogistic: 'Log-logistic', gamma: 'Gamma',
  beta: 'Beta', gumbel: 'Gumbel', uniform: 'Uniform', triangular: 'Triangular',
  poisson: 'Poisson', binomial: 'Binomial', logistic: 'Logistic',
}

/** Friendly presentation only: keep the original identifier for state, APIs and asset keys. */
export function distributionLabel(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '—'
  const name = value.trim()
  const parameterized = name.match(/^(.+?)[_\s]+(\d+)P$/i)
  const family = parameterized?.[1] ?? name
  const familyKey = family.toLowerCase().replace(/[\s_-]+/g, '')
  const friendly = FAMILY_LABELS[familyKey] ?? family.replace(/_+/g, ' ').replace(/\s+/g, ' ')
  return parameterized ? `${friendly} (${Number(parameterized[2])}-parameter)` : friendly
}

/** Format distribution IDs inside report titles while retaining their durable asset identity. */
export function distributionTitle(value: string): string {
  return value.replace(/\b(?:Weibull|Exponential|Normal|Lognormal|Loglogistic|Gamma|Beta|Gumbel)_(?:\d+P|Exponential|Eyring|Power)\b/gi,
    identifier => distributionLabel(identifier))
}
