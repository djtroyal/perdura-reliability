/** Context-aware increments for native number-input spinner/arrow controls. */
export function magnitudeStep(value: number): number {
  const a = Math.abs(value)
  if (!Number.isFinite(a)) return 1
  if (a === 0) return 0.1
  if (a < 0.01) return Math.max(10 ** (Math.floor(Math.log10(a)) - 1), 1e-9)
  if (a < 0.1) return 0.01
  if (a < 1) return 0.01
  if (a < 10) return 0.1
  if (a < 1000) return 1
  if (a < 10000) return 10
  return 10 ** (Math.floor(Math.log10(a)) - 1)
}

export function semanticNumericStep(semantic: string, value: number): number {
  const label = semantic.toLowerCase().replace(/[ₐ-ₜ]/g, '')

  if (/activation energy|\bea\b|e_a/.test(label)) return 0.01
  if (/confidence|probab|reliab|proportion|fraction|duty cycle|stress ratio|\bratio\b/.test(label)) return 0.01
  if (/temperature|\btemp\b|\bt use\b|\bt test\b|tmax|°c|deg c/.test(label)) return 1
  if (/count|number of|quantity|replicate|sample size|failures|cycles|trials|units|parts|pins|seed/.test(label)) return 1
  if (/shape|exponent|weibull β|\bbeta\b|\bsigma\b|\bgamma\b/.test(label)) return 0.1
  if (/failure rate|hazard|\blambda\b|\brate\b/.test(label)) return magnitudeStep(value)
  if (/time|life|duration|mtbf|mttf|horizon|interval|hours/.test(label)) return magnitudeStep(value)
  return magnitudeStep(value)
}
