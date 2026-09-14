import type { StepStressV2Request } from '../../api/client'

export interface StepStressRow {
  time: string
  status?: 'failure' | 'right_censored'
  unitId?: string
  /** Retained when opening historical inputs; checked against the schedule. */
  stress?: string
}

export interface StepStressStage { stress: string; duration: string }

export function buildStepStressRequest(input: {
  rows: StepStressRow[]; steps: StepStressStage[]; useStress: string
  fitMode: 'joint' | 'fixed_exponent'; fixedExponent: string; confidence: string
}): StepStressV2Request {
  const number = (value: string, name: string) => {
    if (!value.trim() || !Number.isFinite(Number(value))) throw new Error(`${name} must be a finite number.`)
    return Number(value)
  }
  const observations = input.rows.filter(row => row.time.trim() || row.stress?.trim() || row.unitId?.trim()).map((row, index) => ({
    time: number(row.time, `Observation ${index + 1} time`),
    status: row.status ?? 'failure',
    ...(row.unitId?.trim() ? { unit_id: row.unitId.trim() } : {}),
    ...(row.stress?.trim() ? { stress_at_observation: number(row.stress, `Observation ${index + 1} stress`) } : {}),
  }))
  const steps = input.steps.filter(step => step.stress.trim() || step.duration.trim()).map((step, index) => ({
    stress: number(step.stress, `Step ${index + 1} stress`),
    duration: number(step.duration, `Step ${index + 1} duration`),
  }))
  return {
    schema_version: 2, distribution: 'Weibull_2P', life_stress_model: 'inverse_power',
    observations, steps, fit_mode: input.fitMode,
    fixed_exponent: input.fitMode === 'fixed_exponent' ? number(input.fixedExponent, 'Fixed exponent') : null,
    use_level_stress: input.useStress.trim() ? number(input.useStress, 'Use-level stress') : null,
    confidence: number(input.confidence, 'Confidence'),
  }
}

export function isLegacyStepStressResult(result: { schema?: string } | null): boolean {
  return result !== null && result.schema !== 'perdura.step-stress/v2'
}
