import type { CSSProperties } from 'react'

export interface ModuleTheme {
  id: string
  label: string
  accent: string
  accentHover: string
  text: string
  tint: string
  soft: string
  border: string
  rgb: string
  plot: readonly string[]
}

const COLORBLIND_SAFE_TAIL = [
  '#0072b2',
  '#d55e00',
  '#009e73',
  '#a23b72',
  '#e69f00',
  '#5b4bb7',
  '#2f6f4e',
] as const

function theme(
  id: string,
  label: string,
  accent: string,
  accentHover: string,
  text: string,
  tint: string,
  soft: string,
  border: string,
  rgb: string,
): ModuleTheme {
  return {
    id, label, accent, accentHover, text, tint, soft, border, rgb,
    plot: [accent, ...COLORBLIND_SAFE_TAIL.filter(color => color !== accent)],
  }
}

/**
 * One accessible visual identity for every top-level Perdura module.
 *
 * Accents are intentionally dark enough to carry normal-sized white text.
 * Tints and borders are presentation tokens only; warning, error, success,
 * and user-selected diagram colors retain their own semantic meaning.
 */
export const MODULE_THEMES = {
  dashboard: theme('dashboard', 'Dashboard', '#1d4ed8', '#1e40af', '#1e40af', '#eff6ff', '#dbeafe', '#93c5fd', '29 78 216'),
  lifeData: theme('lifeData', 'Life Data Analysis', '#1d4ed8', '#1e40af', '#1e40af', '#eff6ff', '#dbeafe', '#93c5fd', '29 78 216'),
  alt: theme('alt', 'Reliability Testing', '#b45309', '#92400e', '#92400e', '#fffbeb', '#fef3c7', '#fcd34d', '180 83 9'),
  systemModeling: theme('systemModeling', 'System Modeling', '#047857', '#065f46', '#065f46', '#ecfdf5', '#d1fae5', '#6ee7b7', '4 120 87'),
  reliabilityAllocation: theme('reliabilityAllocation', 'Reliability Allocation', '#4d7c0f', '#3f6212', '#3f6212', '#f7fee7', '#ecfccb', '#bef264', '77 124 15'),
  prediction: theme('prediction', 'Failure Rate Prediction', '#4338ca', '#3730a3', '#3730a3', '#eef2ff', '#e0e7ff', '#a5b4fc', '67 56 202'),
  pof: theme('pof', 'Physics of Failure', '#6d28d9', '#5b21b6', '#5b21b6', '#f5f3ff', '#ede9fe', '#c4b5fd', '109 40 217'),
  growth: theme('growth', 'Reliability Growth', '#15803d', '#166534', '#166534', '#f0fdf4', '#dcfce7', '#86efac', '21 128 61'),
  softwareReliability: theme('softwareReliability', 'Software Reliability', '#0369a1', '#075985', '#075985', '#f0f9ff', '#e0f2fe', '#7dd3fc', '3 105 161'),
  fmea: theme('fmea', 'FMEA', '#b45309', '#92400e', '#92400e', '#fffbeb', '#fef3c7', '#fcd34d', '180 83 9'),
  reliabilityProgram: theme('reliabilityProgram', 'Reliability Program', '#c2410c', '#9a3412', '#9a3412', '#fff7ed', '#ffedd5', '#fdba74', '194 65 12'),
  maintenance: theme('maintenance', 'Maintenance', '#0f766e', '#115e59', '#115e59', '#f0fdfa', '#ccfbf1', '#5eead4', '15 118 110'),
  hra: theme('hra', 'Human Reliability', '#be123c', '#9f1239', '#9f1239', '#fff1f2', '#ffe4e6', '#fda4af', '190 18 60'),
  warranty: theme('warranty', 'Warranty Analysis', '#0e7490', '#155e75', '#155e75', '#ecfeff', '#cffafe', '#67e8f9', '14 116 144'),
  hypothesis: theme('hypothesis', 'Hypothesis Tests', '#a21caf', '#86198f', '#86198f', '#fdf4ff', '#fae8ff', '#e879f9', '162 28 175'),
  dataAnalysis: theme('dataAnalysis', 'Statistical Modeling', '#c2410c', '#9a3412', '#9a3412', '#fff7ed', '#ffedd5', '#fdba74', '194 65 12'),
  sixSigma: theme('sixSigma', 'Six Sigma', '#0f766e', '#115e59', '#115e59', '#f0fdfa', '#ccfbf1', '#5eead4', '15 118 110'),
  reportBuilder: theme('reportBuilder', 'Report Builder', '#be123c', '#9f1239', '#9f1239', '#fff1f2', '#ffe4e6', '#fda4af', '190 18 60'),
} as const satisfies Record<string, ModuleTheme>

const MODULE_ALIASES: Record<string, keyof typeof MODULE_THEMES> = {
  dashboard: 'dashboard',
  'life-data': 'lifeData',
  lifeData: 'lifeData',
  alt: 'alt',
  'system-modeling': 'systemModeling',
  systemModeling: 'systemModeling',
  allocation: 'reliabilityAllocation',
  reliabilityAllocation: 'reliabilityAllocation',
  prediction: 'prediction',
  pof: 'pof',
  growth: 'growth',
  'software-reliability': 'softwareReliability',
  softwareReliability: 'softwareReliability',
  fmea: 'fmea',
  'reliability-program': 'reliabilityProgram',
  reliabilityProgram: 'reliabilityProgram',
  maintenance: 'maintenance',
  hra: 'hra',
  warranty: 'warranty',
  hypothesis: 'hypothesis',
  'data-analysis': 'dataAnalysis',
  dataAnalysis: 'dataAnalysis',
  'six-sigma': 'sixSigma',
  sixSigma: 'sixSigma',
  'report-builder': 'reportBuilder',
  reportBuilder: 'reportBuilder',
}

export function resolveModuleTheme(moduleId?: string | null): ModuleTheme {
  const key = moduleId ? MODULE_ALIASES[moduleId] : undefined
  return MODULE_THEMES[key ?? 'dashboard']
}

export type ModuleThemeStyle = CSSProperties & Record<`--perdura-${string}`, string>

export function moduleThemeStyle(moduleId?: string | null): ModuleThemeStyle {
  const value = resolveModuleTheme(moduleId)
  return {
    '--perdura-accent': value.accent,
    '--perdura-accent-hover': value.accentHover,
    '--perdura-accent-text': value.text,
    '--perdura-accent-tint': value.tint,
    '--perdura-accent-soft': value.soft,
    '--perdura-accent-border': value.border,
    '--perdura-accent-rgb': value.rgb,
    '--perdura-control-border': '#8291a3',
  }
}

export function modulePlotColorway(moduleId?: string | null): string[] {
  return [...resolveModuleTheme(moduleId).plot]
}
