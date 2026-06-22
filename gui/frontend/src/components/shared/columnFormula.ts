// Safe per-row formula evaluation for generated dataset columns.
//
// A formula string (e.g. "x1 * 2", "sqrt(x1) + log(x2)") is compiled into a
// function of the other columns' values. Only the supplied column names, a
// whitelist of math functions/constants, numeric literals and arithmetic
// operators are permitted — anything else (e.g. `window`, `fetch`) throws, so
// the generated function is safe to run.

// Whitelisted math helpers usable in formulas (without a `Math.` prefix).
export const FORMULA_FUNCS: Record<string, (...a: number[]) => number> = {
  sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, exp: Math.exp,
  log: Math.log, log10: Math.log10, log2: Math.log2, ln: Math.log,
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  floor: Math.floor, ceil: Math.ceil, round: Math.round, sign: Math.sign,
  pow: Math.pow, min: Math.min, max: Math.max, trunc: Math.trunc,
}

export const FORMULA_CONSTS: Record<string, number> = {
  pi: Math.PI, e: Math.E, PI: Math.PI, E: Math.E,
}

/**
 * Compile a formula string into a function of the given column values.
 * Throws if the formula references an unknown name.
 */
export function buildFormula(formula: string, cols: string[]): (vals: number[]) => number {
  const idents = formula.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) ?? []
  const colSet = new Set(cols)
  for (const id of idents) {
    if (colSet.has(id) || id in FORMULA_FUNCS || id in FORMULA_CONSTS) continue
    throw new Error(`Unknown name "${id}" — use columns (${cols.join(', ') || 'none'}) or math functions.`)
  }
  const fnNames = Object.keys(FORMULA_FUNCS)
  const constNames = Object.keys(FORMULA_CONSTS)
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  const compiled = new Function(
    ...cols, ...fnNames, ...constNames,
    `"use strict"; return (${formula});`,
  ) as (...a: number[]) => number
  const fnVals = fnNames.map(n => FORMULA_FUNCS[n] as unknown as number)
  const constVals = constNames.map(n => FORMULA_CONSTS[n])
  return (vals: number[]) => {
    const out = compiled(...vals, ...fnVals, ...constVals)
    return typeof out === 'number' ? out : NaN
  }
}
