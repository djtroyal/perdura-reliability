import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  NodeResizer,
  addEdge,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  MarkerType,
  BackgroundVariant,
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
  type NodeChange,
  type EdgeChange,
  type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  Play, Trash2, Download, LayoutGrid, Copy, Clipboard, GitFork,
  ChevronUp, ChevronDown, X, AlertTriangle, Upload, FileDown, Search, Scissors,
  MessageSquarePlus, Minus, Plus, GripVertical,
} from 'lucide-react'
import {
  analyzeFaultTreeStream, FaultTreeResponse, FaultTreeGraph, FaultTreeProgress,
  exportOpenPSAFaultTree, importOpenPSAFaultTree, OpenPSAWarning,
  validateFaultTree, FaultTreeValidationResponse,
} from '../../api/client'
import Plot from '../shared/ExportablePlot'
import ResultsTable from '../shared/ResultsTable'
import { useFolioState, useRevision, getProjectState, writeFolioState } from '../../store/project'
import FolioBar from '../shared/FolioBar'
import LibraryPanel, { LibraryItem } from '../shared/LibraryPanel'
import { CanvasErrorBoundary, sanitizeNodeChanges, sanitizeNodes } from '../shared/CanvasErrorBoundary'
import { useReliabilitySources } from '../shared/ldaFolios'
import ExportDiagramButton from '../shared/ExportDiagramButton'
import { fitReactFlowForExport } from '../shared/exportDiagram'
import ExportResultsButton from '../shared/ExportResultsButton'
import NumberField from '../shared/NumberField'
import Latex from '../shared/Latex'
import { restoreExpandedTransferEndpoints } from './transferViews'

// --- Distribution CDF helpers (for computing probability from distributions) ---

function normalCDF(x: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911
  const sign = x < 0 ? -1 : 1
  const ax = Math.abs(x) / Math.sqrt(2)
  const t = 1.0 / (1.0 + p * ax)
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax)
  return 0.5 * (1.0 + sign * y)
}

// Log-gamma (Lanczos approximation) — used by the incomplete gamma/beta functions.
function gammaln(x: number): number {
  const g = [
    676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012,
    9.9843695780195716e-6, 1.5056327351493116e-7,
  ]
  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - gammaln(1 - x)
  }
  x -= 1
  let a = 0.99999999999980993
  const t = x + 7.5
  for (let i = 0; i < g.length; i++) a += g[i] / (x + i + 1)
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a)
}

// Regularized lower incomplete gamma P(s, x) (Numerical Recipes: series + CF).
function lowerGammaP(s: number, x: number): number {
  if (x <= 0 || s <= 0) return 0
  if (x < s + 1) {
    let ap = s, sum = 1 / s, del = sum
    for (let n = 0; n < 200; n++) {
      ap += 1
      del *= x / ap
      sum += del
      if (Math.abs(del) < Math.abs(sum) * 1e-12) break
    }
    return sum * Math.exp(-x + s * Math.log(x) - gammaln(s))
  }
  // continued fraction for the upper incomplete gamma Q, then P = 1 - Q
  let b = x + 1 - s, c = 1e300, d = 1 / b, h = d
  for (let i = 1; i <= 200; i++) {
    const an = -i * (i - s)
    b += 2
    d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300
    c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < 1e-12) break
  }
  return 1 - Math.exp(-x + s * Math.log(x) - gammaln(s)) * h
}

// Continued fraction for the regularized incomplete beta function.
function betacf(a: number, b: number, x: number): number {
  const fpmin = 1e-300
  let qab = a + b, qap = a + 1, qam = a - 1
  let c = 1, d = 1 - qab * x / qap
  if (Math.abs(d) < fpmin) d = fpmin
  d = 1 / d
  let h = d
  for (let m = 1; m <= 200; m++) {
    const m2 = 2 * m
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2))
    d = 1 + aa * d; if (Math.abs(d) < fpmin) d = fpmin
    c = 1 + aa / c; if (Math.abs(c) < fpmin) c = fpmin
    d = 1 / d
    h *= d * c
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
    d = 1 + aa * d; if (Math.abs(d) < fpmin) d = fpmin
    c = 1 + aa / c; if (Math.abs(c) < fpmin) c = fpmin
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < 1e-12) break
  }
  return h
}

// Regularized incomplete beta I_x(a, b).
function incompleteBeta(a: number, b: number, x: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const bt = Math.exp(gammaln(a + b) - gammaln(a) - gammaln(b)
    + a * Math.log(x) + b * Math.log(1 - x))
  return x < (a + 1) / (a + b + 2)
    ? bt * betacf(a, b, x) / a
    : 1 - bt * betacf(b, a, 1 - x) / b
}

export function computeCDF(dist: string, params: Record<string, number>, t: number): number {
  if (t <= 0 && dist !== 'normal' && dist !== 'gumbel') return 0
  switch (dist) {
    case 'exponential': {
      const gamma = params.gamma ?? 0
      if (t <= gamma) return 0
      return 1 - Math.exp(-(params.lambda ?? 0.001) * (t - gamma))
    }
    case 'weibull': {
      const alpha = params.alpha ?? 1000, beta = params.beta ?? 1.5
      const gamma = params.gamma ?? 0
      if (alpha <= 0 || beta <= 0 || t <= gamma) return 0
      return 1 - Math.exp(-Math.pow((t - gamma) / alpha, beta))
    }
    case 'normal':
      return normalCDF((t - (params.mu ?? 1000)) / (params.sigma ?? 200))
    case 'lognormal': {
      const gamma = params.gamma ?? 0
      if (t <= gamma) return 0
      return normalCDF((Math.log(t - gamma) - (params.mu ?? 6.9)) / (params.sigma ?? 0.5))
    }
    case 'gamma': {
      // reliability Gamma_Distribution: alpha = shape, beta = scale
      const alpha = params.alpha ?? 2, beta = params.beta ?? 500
      const gamma = params.gamma ?? 0
      if (alpha <= 0 || beta <= 0 || t <= gamma) return 0
      return lowerGammaP(alpha, (t - gamma) / beta)
    }
    case 'loglogistic': {
      const alpha = params.alpha ?? 1000, beta = params.beta ?? 2
      const gamma = params.gamma ?? 0
      if (alpha <= 0 || beta <= 0 || t <= gamma) return 0
      const r = Math.pow((t - gamma) / alpha, beta)
      return r / (1 + r)
    }
    case 'gumbel': {
      // reliability Gumbel_Distribution (smallest extreme value form)
      const mu = params.mu ?? 1000, sigma = params.sigma ?? 200
      if (sigma <= 0) return 0
      return 1 - Math.exp(-Math.exp((t - mu) / sigma))
    }
    case 'beta': {
      // reliability Beta_Distribution on [0, 1]
      const alpha = params.alpha ?? 2, beta = params.beta ?? 2
      if (alpha <= 0 || beta <= 0) return 0
      return incompleteBeta(alpha, beta, Math.min(1, Math.max(0, t)))
    }
    default:
      return 0
  }
}

export const DIST_OPTIONS = [
  { value: '', label: 'Manual (direct probability)' },
  { value: 'exponential', label: 'Exponential' },
  { value: 'weibull', label: 'Weibull (2P)' },
  { value: 'normal', label: 'Normal' },
  { value: 'lognormal', label: 'Lognormal (2P)' },
  { value: 'gamma', label: 'Gamma' },
  { value: 'loglogistic', label: 'Loglogistic' },
  { value: 'gumbel', label: 'Gumbel' },
  { value: 'beta', label: 'Beta' },
]

export const DIST_PARAMS: Record<string, { key: string; label: string; default: number }[]> = {
  exponential: [{ key: 'lambda', label: 'Failure rate (λ)', default: 0.001 }],
  weibull: [
    { key: 'alpha', label: 'Scale (α)', default: 1000 },
    { key: 'beta', label: 'Shape (β)', default: 1.5 },
  ],
  normal: [
    { key: 'mu', label: 'Mean (μ)', default: 1000 },
    { key: 'sigma', label: 'Std dev (σ)', default: 200 },
  ],
  lognormal: [
    { key: 'mu', label: 'Log-mean (μ)', default: 6.9 },
    { key: 'sigma', label: 'Log-std (σ)', default: 0.5 },
  ],
  gamma: [
    { key: 'alpha', label: 'Shape (α)', default: 2 },
    { key: 'beta', label: 'Scale (β)', default: 500 },
  ],
  loglogistic: [
    { key: 'alpha', label: 'Scale (α)', default: 1000 },
    { key: 'beta', label: 'Shape (β)', default: 2 },
  ],
  gumbel: [
    { key: 'mu', label: 'Location (μ)', default: 1000 },
    { key: 'sigma', label: 'Scale (σ)', default: 200 },
  ],
  beta: [
    { key: 'alpha', label: 'Shape (α)', default: 2 },
    { key: 'beta', label: 'Shape (β)', default: 2 },
  ],
}

// Basic-event probability source (#4).
type EventSource = 'manual' | 'distribution' | 'lda'

// --- Computed-probability badge shown on a node after analysis (#5) ---

function ProbBadge({ data }: { data: Record<string, unknown> }) {
  const p = data.computedP
  if (p == null || typeof p !== 'number') return null
  return (
    <div
      className="absolute -top-2 -right-2 bg-red-600 text-white text-[8px] font-mono font-semibold rounded px-1 py-0.5 shadow"
      style={{ whiteSpace: 'nowrap' }}
    >
      P={p.toExponential(2)}
    </div>
  )
}

// --- Professional, readable gate/event nodes --------------------------------

const EVENT_NODE_TYPES = new Set(['basic', 'undeveloped', 'house', 'conditioning', 'external'])
const CONSTRAINT_NODE_TYPES = new Set(['fdep', 'seq'])
const DYNAMIC_NODE_TYPES = new Set(['pand', 'por', 'spare', 'fdep', 'seq'])

const NODE_ACCENTS: Record<string, { bg: string; border: string; text: string }> = {
  and: { bg: '#4f46e5', border: '#312e81', text: 'AND' },
  or: { bg: '#ea580c', border: '#9a3412', text: 'OR' },
  vote: { bg: '#9333ea', border: '#581c87', text: 'K/N' },
  cardinality: { bg: '#7c3aed', border: '#4c1d95', text: 'L..H' },
  xor: { bg: '#e11d48', border: '#9f1239', text: 'XOR' },
  not: { bg: '#475569', border: '#1e293b', text: 'NOT' },
  nand: { bg: '#3730a3', border: '#1e1b4b', text: 'NAND' },
  nor: { bg: '#c2410c', border: '#7c2d12', text: 'NOR' },
  iff: { bg: '#0369a1', border: '#0c4a6e', text: 'IFF' },
  imply: { bg: '#047857', border: '#064e3b', text: '⇒' },
  inhibit: { bg: '#a16207', border: '#713f12', text: 'INHIBIT' },
  pand: { bg: '#0d9488', border: '#134e4a', text: 'PAND' },
  por: { bg: '#0891b2', border: '#155e75', text: 'POR' },
  spare: { bg: '#0f766e', border: '#134e4a', text: 'SPARE' },
  fdep: { bg: '#b45309', border: '#78350f', text: 'FDEP' },
  seq: { bg: '#be185d', border: '#831843', text: 'SEQ' },
  transfer: { bg: '#0891b2', border: '#155e75', text: 'XFER' },
}

const NODE_PALETTE_GROUPS = [
  { title: 'Events', color: 'border-slate-300 text-slate-700', items: [
    ['basic', 'Basic Event'], ['undeveloped', 'Undeveloped Event'], ['house', 'House Event'],
    ['conditioning', 'Conditioning Event'], ['external', 'External Event'],
  ] },
  { title: 'Static Gates', color: 'border-indigo-300 text-indigo-700', items: [
    ['and', 'AND'], ['or', 'OR'], ['vote', 'K-of-N'], ['cardinality', 'Cardinality L..H'],
    ['xor', 'XOR'], ['not', 'NOT'], ['nand', 'NAND'], ['nor', 'NOR'],
    ['iff', 'Equivalence'], ['imply', 'Implication'], ['inhibit', 'INHIBIT'],
  ] },
  { title: 'Dynamic & Dependencies', color: 'border-teal-300 text-teal-700', items: [
    ['pand', 'Priority AND'], ['por', 'Priority OR'], ['spare', 'SPARE'],
    ['fdep', 'Functional Dependency'], ['seq', 'Sequence Enforcer'],
  ] },
  { title: 'Structure', color: 'border-cyan-300 text-cyan-700', items: [
    ['transfer', 'Transfer / Reference'],
  ] },
] as const

const COMMON_NODE_TYPES = new Set([
  'basic', 'undeveloped', 'house', 'and', 'or', 'vote',
])

const GATE_ID_PREFIXES: Record<string, string> = {
  and: 'AND', or: 'OR', vote: 'VOTE', cardinality: 'CARD', xor: 'XOR',
  not: 'NOT', nand: 'NAND', nor: 'NOR', iff: 'IFF', imply: 'IMPLY',
  inhibit: 'INH', pand: 'PAND', por: 'POR', spare: 'SPR', fdep: 'FDEP',
  seq: 'SEQ', transfer: 'XFER',
}

function gateIdPrefix(type: string): string {
  return GATE_ID_PREFIXES[type] ?? type.toUpperCase()
}

function resolveGateIds(graphNodes: Node[]): Map<string, string> {
  const resolved = new Map<string, string>()
  const used = new Set<string>()
  for (const node of graphNodes) {
    if (EVENT_NODE_TYPES.has(node.type ?? '')) continue
    const prefix = gateIdPrefix(node.type ?? '')
    const candidate = String(node.data.gateId ?? '').toUpperCase()
    if (new RegExp(`^${prefix}-\\d+$`).test(candidate) && !used.has(candidate)) {
      resolved.set(node.id, candidate)
      used.add(candidate)
    }
  }
  for (const node of graphNodes) {
    if (EVENT_NODE_TYPES.has(node.type ?? '') || resolved.has(node.id)) continue
    const prefix = gateIdPrefix(node.type ?? '')
    let sequence = 1
    while (used.has(`${prefix}-${sequence}`)) sequence += 1
    const id = `${prefix}-${sequence}`
    resolved.set(node.id, id)
    used.add(id)
  }
  return resolved
}

interface FTASymbolProps {
  type: string
  label?: string
  k?: number | string
  min?: number | string
  max?: number | string
  spareMode?: string
  size?: 'canvas' | 'palette'
  structuralRole?: 'top' | 'intermediate' | null
  accent?: string
  fillColor?: string
}

const SYMBOL_NAMES: Record<string, string> = {
  basic: 'Basic event',
  undeveloped: 'Undeveloped event',
  house: 'House event',
  conditioning: 'Conditioning event',
  external: 'External event',
  and: 'AND gate',
  or: 'OR gate',
  vote: 'Voting gate',
  cardinality: 'Cardinality gate',
  xor: 'Exclusive OR gate',
  not: 'NOT gate',
  nand: 'NAND gate',
  nor: 'NOR gate',
  iff: 'Equivalence gate',
  imply: 'Implication gate',
  inhibit: 'Inhibit gate',
  pand: 'Priority AND gate',
  por: 'Priority OR gate',
  spare: 'Spare gate',
  fdep: 'Functional dependency gate',
  seq: 'Sequence-enforcing gate',
  transfer: 'Transfer symbol',
}

/**
 * Conventional top-down FTA symbols. Static event and logic-gate silhouettes
 * follow the familiar IEC/NASA/NRC fault-tree notation. Named dynamic and
 * extended-logic gates keep a distinct, explicitly labelled silhouette because
 * there is no single universally adopted glyph for every DFT extension.
 */
export function FTASymbol({
  type, label, k = 2, min = 1, max = 'N', spareMode = 'cold', size = 'canvas', structuralRole = null,
  accent: accentOverride, fillColor = '#ffffff',
}: FTASymbolProps) {
  const accent = accentOverride ?? NODE_ACCENTS[type]?.border ?? '#334155'
  const name = SYMBOL_NAMES[type] ?? `${type.toUpperCase()} gate`
  const semanticName = structuralRole === 'top' ? 'Top event (single-input OR)'
    : structuralRole === 'intermediate' ? 'Intermediate event (single-input OR)' : name
  const title = label ? `${semanticName}: ${label}` : semanticName
  const common = { fill: fillColor, stroke: accent, strokeWidth: 2.5, strokeLinejoin: 'round' as const }
  const textClass = 'select-none fill-slate-700 text-[11px] font-bold tracking-wide'
  const smallTextClass = 'select-none fill-slate-600 text-[8px] font-bold tracking-wide'
  const andOutline = <path d="M18 58V37A30 25 0 0 1 78 37V58Z" {...common} />
  const orOutline = <path d="M16 58Q48 46 80 58Q73 32 48 11Q23 32 16 58Z" {...common} />

  let glyph
  switch (type) {
    case 'basic':
      glyph = <circle cx="48" cy="35" r="25" {...common} />
      break
    case 'undeveloped':
      glyph = <path d="M48 8L79 35L48 62L17 35Z" {...common} />
      break
    case 'conditioning':
      glyph = <ellipse cx="48" cy="35" rx="36" ry="23" {...common} />
      break
    case 'house':
      glyph = <path d="M16 34L48 8L80 34V62H16Z" {...common} />
      break
    case 'external':
      glyph = (
        <>
          <path d="M16 34L48 8L80 34V62H16Z" {...common} strokeDasharray="5 3" />
          <text x="48" y="43" textAnchor="middle" className={textClass}>EXT</text>
        </>
      )
      break
    case 'and':
      glyph = andOutline
      break
    case 'or':
      glyph = structuralRole
        ? <rect x="12" y="10" width="72" height="50" rx="2" {...common} />
        : orOutline
      break
    case 'vote':
      glyph = (
        <>
          {orOutline}
          <text x="48" y="42" textAnchor="middle" className={textClass}>{String(k)}/N</text>
        </>
      )
      break
    case 'cardinality':
      glyph = (
        <>
          {orOutline}
          <text x="48" y="40" textAnchor="middle" className={smallTextClass}>{String(min)}..{String(max)}</text>
        </>
      )
      break
    case 'xor':
      glyph = (
        <>
          {orOutline}
          <path d="M11 64Q48 50 85 64" fill="none" stroke={accent} strokeWidth="2.5" strokeLinecap="round" />
        </>
      )
      break
    case 'not':
      glyph = (
        <>
          <path d="M18 58H78L48 12Z" {...common} />
          <circle cx="48" cy="8" r="4" {...common} />
        </>
      )
      break
    case 'nand':
      glyph = (
        <>
          {andOutline}
          <circle cx="48" cy="8" r="4" {...common} />
        </>
      )
      break
    case 'nor':
      glyph = (
        <>
          {orOutline}
          <circle cx="48" cy="7" r="4" {...common} />
        </>
      )
      break
    case 'pand':
      glyph = (
        <>
          {andOutline}
          <text x="48" y="43" textAnchor="middle" className={textClass}>PAND</text>
          <path d="M31 51H65M37 47L31 51L37 55" fill="none" stroke={accent} strokeWidth="1.8" />
        </>
      )
      break
    case 'por':
      glyph = (
        <>
          {orOutline}
          <text x="48" y="41" textAnchor="middle" className={textClass}>POR</text>
        </>
      )
      break
    case 'inhibit':
      glyph = (
        <>
          <path d="M23 58L13 35L30 12H66L83 35L73 58Z" {...common} />
          <text x="48" y="39" textAnchor="middle" className={textClass}>INH</text>
          <circle cx="85" cy="35" r="3" fill={accent} />
        </>
      )
      break
    case 'transfer':
      glyph = (
        <>
          <path d="M48 9L82 59H14Z" {...common} />
          <path d="M25 63H71" fill="none" stroke={accent} strokeWidth="2.5" />
          <text x="48" y="47" textAnchor="middle" className={textClass}>T</text>
        </>
      )
      break
    case 'spare':
      glyph = (
        <>
          <path d="M17 58L25 13H71L79 58Z" {...common} />
          <text x="48" y="35" textAnchor="middle" className={smallTextClass}>SPARE</text>
          <text x="48" y="47" textAnchor="middle" className={smallTextClass}>{spareMode.slice(0, 1).toUpperCase()}</text>
        </>
      )
      break
    case 'fdep':
      glyph = (
        <>
          <path d="M48 8L82 35L48 62L14 35Z" {...common} />
          <text x="48" y="39" textAnchor="middle" className={smallTextClass}>FDEP</text>
        </>
      )
      break
    case 'seq':
      glyph = (
        <>
          <path d="M19 58V16H77V58Z" {...common} />
          <text x="48" y="35" textAnchor="middle" className={textClass}>SEQ</text>
          <path d="M29 47H67M61 42L67 47L61 52" fill="none" stroke={accent} strokeWidth="1.8" />
        </>
      )
      break
    case 'iff':
      glyph = (
        <>
          <rect x="14" y="12" width="68" height="46" rx="7" {...common} />
          <text x="48" y="40" textAnchor="middle" className={textClass}>⇔</text>
        </>
      )
      break
    case 'imply':
      glyph = (
        <>
          <rect x="14" y="12" width="68" height="46" rx="7" {...common} />
          <text x="48" y="40" textAnchor="middle" className={textClass}>⇒</text>
        </>
      )
      break
    default:
      glyph = (
        <>
          <rect x="14" y="12" width="68" height="46" rx="7" {...common} />
          <text x="48" y="39" textAnchor="middle" className={smallTextClass}>{type.toUpperCase()}</text>
        </>
      )
  }

  return (
    <svg
      viewBox="0 0 96 70"
      className={`${size === 'palette' ? 'h-6 w-9' : 'h-[66px] w-[92px] drop-shadow-sm'} overflow-visible`}
      role="img"
      aria-label={title}
      data-fta-symbol={type}
      data-fta-inferred-role={structuralRole ?? undefined}
    >
      <title>{title}</title>
      {glyph}
    </svg>
  )
}

function readableProbability(data: Record<string, unknown>): string | null {
  const computed = data.computedP
  if (typeof computed === 'number' && Number.isFinite(computed)) return `P = ${computed.toExponential(3)}`
  const probability = data.probability
  if (typeof probability === 'number' && Number.isFinite(probability)) return `p = ${probability.toExponential(3)}`
  return null
}

function estimatedWrappedLines(value: unknown, wrapWidth: number): number {
  const text = String(value ?? '').trim()
  if (!text) return 0
  return text.split(/\r?\n/).reduce(
    (total, line) => total + Math.max(1, Math.ceil(line.length / wrapWidth)), 0,
  )
}

const DIAGRAM_DENSITY_LEVELS = ['dense', 'compact', 'comfortable', 'spacious', 'expanded'] as const
type DiagramDensity = typeof DIAGRAM_DENSITY_LEVELS[number]

const DIAGRAM_DENSITY: Record<DiagramDensity, {
  label: string
  eventWidthClass: string
  gateWidthClass: string
  labelClass: string
  eventWidth: number
  gateWidth: number
  labelWrap: number
  descriptionWrap: number
  labelLineHeight: number
  spacingScale: number
}> = {
  dense: {
    label: 'Dense', eventWidthClass: 'w-24', gateWidthClass: 'w-28',
    labelClass: 'text-[10px] leading-3', eventWidth: 96, gateWidth: 112,
    labelWrap: 15, descriptionWrap: 20, labelLineHeight: 12, spacingScale: 0.76,
  },
  compact: {
    label: 'Compact', eventWidthClass: 'w-28', gateWidthClass: 'w-32',
    labelClass: 'text-[12px] leading-[14px]', eventWidth: 112, gateWidth: 128,
    labelWrap: 18, descriptionWrap: 24, labelLineHeight: 14, spacingScale: 0.88,
  },
  comfortable: {
    label: 'Comfortable', eventWidthClass: 'w-36', gateWidthClass: 'w-40',
    labelClass: 'text-[13px] leading-4', eventWidth: 144, gateWidth: 160,
    labelWrap: 24, descriptionWrap: 31, labelLineHeight: 16, spacingScale: 1,
  },
  spacious: {
    label: 'Spacious', eventWidthClass: 'w-44', gateWidthClass: 'w-48',
    labelClass: 'text-sm leading-[18px]', eventWidth: 176, gateWidth: 192,
    labelWrap: 29, descriptionWrap: 37, labelLineHeight: 18, spacingScale: 1.14,
  },
  expanded: {
    label: 'Expanded', eventWidthClass: 'w-52', gateWidthClass: 'w-56',
    labelClass: 'text-[15px] leading-5', eventWidth: 208, gateWidth: 224,
    labelWrap: 34, descriptionWrap: 43, labelLineHeight: 20, spacingScale: 1.28,
  },
}

function normalizeDiagramDensity(value: unknown): DiagramDensity {
  return DIAGRAM_DENSITY_LEVELS.includes(value as DiagramDensity)
    ? value as DiagramDensity : 'comfortable'
}

function DiagramDescription({ value, density = 'comfortable' }: {
  value: unknown; density?: DiagramDensity
}) {
  const description = String(value ?? '').trim()
  if (!description) return null
  const physicalLines = description.split(/\r?\n/)
  const wrapWidth = DIAGRAM_DENSITY[density].descriptionWrap
  const estimatedLines = estimatedWrappedLines(description, wrapWidth)
  const longestLine = Math.max(...physicalLines.map(line => line.length), 0)
  const sizeClass = estimatedLines >= 9 || description.length > 320 || longestLine > 100
    ? 'text-[7px] leading-[9px]'
    : estimatedLines >= 6 || description.length > 210 || longestLine > 72
      ? 'text-[8px] leading-[10px]'
      : estimatedLines >= 4 || description.length > 120 || longestLine > 48
        ? 'text-[9px] leading-[11px]'
        : 'text-[10px] leading-3'
  return (
    <div
      className={`mt-1 whitespace-pre-line break-words border-t border-slate-100 pt-1 text-left font-normal text-slate-500 ${sizeClass}`}
      data-diagram-description
    >
      {description}
    </div>
  )
}

function AnnotationLabelHandles() {
  const className = '!pointer-events-none !h-2 !w-2 !border-0 !bg-transparent'
  return <>
    <Handle id="annotation-label-top" type="target" position={Position.Top} isConnectable={false} className={className} />
    <Handle id="annotation-label-right" type="target" position={Position.Right} isConnectable={false} className={className} />
    <Handle id="annotation-label-bottom" type="target" position={Position.Bottom} isConnectable={false} className={className} />
    <Handle id="annotation-label-left" type="target" position={Position.Left} isConnectable={false} className={className} />
  </>
}

function ReadableEventNode({ data, selected }: NodeProps) {
  const highlighted = Boolean(data.highlighted)
  const type = String(data.nodeType ?? 'basic')
  const label = String(data.label || 'Untitled event')
  const density = normalizeDiagramDensity(data.displayDensity)
  const densityPreset = DIAGRAM_DENSITY[density]
  const nodePalette = data.diagramColor
    ? ANNOTATION_PALETTE[String(data.diagramColor)] ?? null : null
  const probability = type === 'house'
    ? (Boolean(data.state) ? 'House state: TRUE' : 'House state: FALSE')
    : readableProbability(data as Record<string, unknown>)
  return (
    <div className={`relative flex flex-col items-center ${densityPreset.eventWidthClass}`} title={String(data.description || label)}>
      <Handle type="target" position={Position.Top} className="!h-2.5 !w-2.5"
        style={{ top: -5, backgroundColor: nodePalette?.accent ?? '#64748b' }} />
      <div className={`rounded-lg ${highlighted ? 'ring-4 ring-amber-100' : selected ? 'ring-4 ring-blue-100' : ''}`}>
        <FTASymbol type={type} label={label} accent={nodePalette?.accent} fillColor={nodePalette?.fill} />
      </div>
      <div className={`relative mt-1 w-full rounded-md border bg-white px-2 py-1 text-center shadow-sm ${selected ? 'border-blue-500' : highlighted ? 'border-amber-400' : nodePalette ? '' : 'border-slate-200'}`}
        style={nodePalette ? { borderColor: nodePalette.accent, backgroundColor: nodePalette.fill } : undefined}>
        <AnnotationLabelHandles />
        <div className={`break-words font-semibold text-slate-900 ${densityPreset.labelClass}`}>{label}</div>
        {probability && <div className="mt-0.5 font-mono text-[10px] leading-3 text-slate-600">{probability}</div>}
        {data.showNodeIds !== false && data.eventKey != null && String(data.eventKey) !== '' && String(data.eventKey) !== label && (
          <div className="mt-0.5 truncate text-[9px] leading-3 text-slate-400">ID: {String(data.eventKey)}</div>
        )}
        <DiagramDescription value={data.description} density={density} />
      </div>
      {Number(data.eventOccurrenceCount ?? 1) > 1 && (
        <div className="mt-1 rounded bg-violet-100 px-1.5 py-0.5 text-[9px] font-medium text-violet-800"
          title="Every occurrence shares one logical event identity and probability model">
          ⧉ Mirrored · {String(data.eventOccurrenceCount)} occurrences
        </div>
      )}
      {data.ccf_group != null && String(data.ccf_group) !== '' && (
        <div className="mt-1 rounded bg-amber-50 px-1.5 py-0.5 text-[9px] font-medium text-amber-800">CCF {String(data.ccf_group)} · β={String(data.ccf_beta ?? 0.1)}</div>
      )}
    </div>
  )
}

function ReadableGateNode({ data, selected }: NodeProps) {
  const type = String(data.nodeType ?? 'and')
  const highlighted = Boolean(data.highlighted)
  const label = String(data.label || `Untitled ${type.toUpperCase()}`)
  const density = normalizeDiagramDensity(data.displayDensity)
  const densityPreset = DIAGRAM_DENSITY[density]
  const nodePalette = data.diagramColor
    ? ANNOTATION_PALETTE[String(data.diagramColor)] ?? null : null
  const gateId = String(data.gateId ?? `${gateIdPrefix(type)}-1`)
  const probability = readableProbability(data as Record<string, unknown>)
  const structuralRole = data.structuralRole === 'top' || data.structuralRole === 'intermediate'
    ? String(data.structuralRole) : null
  const secondary = type === 'vote' ? `${String(data.k ?? 2)} of N`
    : type === 'cardinality' ? `${String(data.min ?? 1)}..${String(data.max ?? 'N')} of N`
      : type === 'spare' ? `${String(data.spare_mode ?? 'cold')} standby`
        : type === 'transfer' ? (data.transferToName ? `→ ${String(data.transferToName)}` : 'Target not set')
          : DYNAMIC_NODE_TYPES.has(type) ? 'Dynamic' : null
  return (
    <div className={`relative flex flex-col items-center ${densityPreset.gateWidthClass}`} title={String(data.description || label)}>
      {!CONSTRAINT_NODE_TYPES.has(type) && <Handle type="target" position={Position.Top} className="!h-2.5 !w-2.5"
        style={{ top: -5, backgroundColor: nodePalette?.accent ?? '#64748b' }} />}
      <div className={`rounded-lg ${highlighted ? 'ring-4 ring-amber-100' : selected ? 'ring-4 ring-blue-100' : ''}`}>
        <FTASymbol
          type={type}
          label={label}
          k={String(data.k ?? 2)}
          min={String(data.min ?? 1)}
          max={String(data.max ?? 'N')}
          spareMode={String(data.spare_mode ?? 'cold')}
          structuralRole={structuralRole as 'top' | 'intermediate' | null}
          accent={nodePalette?.accent}
          fillColor={nodePalette?.fill}
        />
      </div>
      <div className={`relative mt-1 w-full rounded-md border bg-white px-2 py-1 text-center shadow-sm ${selected ? 'border-blue-500' : highlighted ? 'border-amber-400' : nodePalette ? '' : 'border-slate-200'}`}
        style={nodePalette ? { borderColor: nodePalette.accent, backgroundColor: nodePalette.fill } : undefined}>
        <AnnotationLabelHandles />
        <div className={`break-words font-semibold text-slate-900 ${densityPreset.labelClass}`}>{label}</div>
        {data.showNodeIds !== false && gateId && <div className="mt-0.5 font-mono text-[9px] leading-3 text-slate-400">ID: {gateId}</div>}
        <div className="mt-0.5 flex items-center justify-center gap-1.5 text-[10px] leading-3 text-slate-500">
          {secondary && <span>{secondary}</span>}
          {secondary && probability && <span aria-hidden>·</span>}
          {probability && <span className="font-mono">{probability}</span>}
        </div>
        <DiagramDescription value={data.description} density={density} />
      </div>
      <Handle type="source" position={Position.Bottom} className="!h-2.5 !w-2.5"
        style={{ bottom: -5, backgroundColor: nodePalette?.accent ?? '#64748b' }} />
    </div>
  )
}

const ANNOTATION_PALETTE: Record<string, { label: string; accent: string; fill: string; text: string }> = {
  amber: { label: 'Amber', accent: '#f59e0b', fill: '#fffbeb', text: '#451a03' },
  orange: { label: 'Orange', accent: '#f97316', fill: '#fff7ed', text: '#431407' },
  red: { label: 'Red', accent: '#ef4444', fill: '#fef2f2', text: '#450a0a' },
  rose: { label: 'Rose', accent: '#f43f5e', fill: '#fff1f2', text: '#4c0519' },
  fuchsia: { label: 'Fuchsia', accent: '#d946ef', fill: '#fdf4ff', text: '#4a044e' },
  violet: { label: 'Violet', accent: '#8b5cf6', fill: '#f5f3ff', text: '#2e1065' },
  indigo: { label: 'Indigo', accent: '#6366f1', fill: '#eef2ff', text: '#1e1b4b' },
  blue: { label: 'Blue', accent: '#3b82f6', fill: '#eff6ff', text: '#172554' },
  cyan: { label: 'Cyan', accent: '#06b6d4', fill: '#ecfeff', text: '#083344' },
  teal: { label: 'Teal', accent: '#14b8a6', fill: '#f0fdfa', text: '#042f2e' },
  emerald: { label: 'Emerald', accent: '#10b981', fill: '#ecfdf5', text: '#022c22' },
  lime: { label: 'Lime', accent: '#84cc16', fill: '#f7fee7', text: '#1a2e05' },
  slate: { label: 'Slate', accent: '#64748b', fill: '#f8fafc', text: '#0f172a' },
}

const ANNOTATION_SHAPES: Record<string, {
  label: string; className: string; preview: string; defaultWidth: number; defaultHeight: number
}> = {
  rounded: { label: 'Rounded', className: 'rounded-lg px-3 py-2', preview: 'rounded-md', defaultWidth: 192, defaultHeight: 64 },
  rectangle: { label: 'Rectangle', className: 'rounded-none px-3 py-2', preview: 'rounded-none', defaultWidth: 192, defaultHeight: 64 },
  oval: { label: 'Oval', className: 'rounded-[50%] px-8 py-5', preview: 'rounded-[50%]', defaultWidth: 208, defaultHeight: 96 },
  capsule: { label: 'Capsule', className: 'rounded-full px-7 py-3', preview: 'rounded-full', defaultWidth: 208, defaultHeight: 64 },
}

const ANNOTATION_OPACITIES = [100, 85, 70, 50] as const

function annotationFill(fill: string, opacity: number): string {
  const normalized = fill.replace('#', '')
  const red = Number.parseInt(normalized.slice(0, 2), 16)
  const green = Number.parseInt(normalized.slice(2, 4), 16)
  const blue = Number.parseInt(normalized.slice(4, 6), 16)
  return `rgba(${red}, ${green}, ${blue}, ${Math.max(0.1, Math.min(1, opacity / 100))})`
}

function DiagramAnnotationNode({ data, selected, width, height }: NodeProps) {
  const color = String(data.color ?? 'amber')
  const palette = ANNOTATION_PALETTE[color] ?? ANNOTATION_PALETTE.amber
  const shape = ANNOTATION_SHAPES[String(data.shape ?? 'rounded')] ?? ANNOTATION_SHAPES.rounded
  const fillOpacity = Number(data.fillOpacity ?? 100)
  const text = String(data.text ?? 'Diagram note')
  const isCallout = Boolean(data.targetId)
  return (
    <>
      <NodeResizer isVisible={selected} minWidth={100} minHeight={44}
        color={palette.accent} handleStyle={{ width: 8, height: 8 }} />
      <div className={`relative overflow-hidden whitespace-pre-wrap break-words border text-[11px] leading-4 shadow-sm ${shape.className} ${
        selected ? 'ring-4 ring-blue-100' : ''
      }`} style={{
        width: Number(width) > 0 ? Number(width) : shape.defaultWidth,
        height: Number(height) > 0 ? Number(height) : shape.defaultHeight,
        borderColor: palette.accent,
        backgroundColor: annotationFill(palette.fill, fillOpacity),
        color: palette.text,
      }} title={text} data-fta-annotation>
        {!isCallout && (
          <div className="mb-1 text-[8px] font-semibold uppercase tracking-wide opacity-55">Note</div>
        )}
        {text}
        {(['top', 'right', 'bottom', 'left'] as const).map(side => (
          <Handle key={side} id={`annotation-${side}`} type="source"
            position={{ top: Position.Top, right: Position.Right, bottom: Position.Bottom, left: Position.Left }[side]}
            isConnectable={false}
            className={`!h-2 !w-2 !border-0 !bg-transparent ${isCallout ? '' : '!pointer-events-none !opacity-0'}`} />
        ))}
      </div>
    </>
  )
}

const eventNode = (type: string) => (props: NodeProps) => (
  <ReadableEventNode {...props} data={{ ...props.data, nodeType: type }} />
)
const gateNode = (type: string) => (props: NodeProps) => (
  <ReadableGateNode {...props} data={{ ...props.data, nodeType: type }} />
)

const nodeTypes = {
  basic: eventNode('basic'),
  undeveloped: eventNode('undeveloped'),
  house: eventNode('house'),
  conditioning: eventNode('conditioning'),
  external: eventNode('external'),
  and: gateNode('and'), or: gateNode('or'), vote: gateNode('vote'),
  cardinality: gateNode('cardinality'), xor: gateNode('xor'), not: gateNode('not'),
  nand: gateNode('nand'), nor: gateNode('nor'), iff: gateNode('iff'),
  imply: gateNode('imply'), inhibit: gateNode('inhibit'),
  pand: gateNode('pand'), por: gateNode('por'), spare: gateNode('spare'),
  fdep: gateNode('fdep'), seq: gateNode('seq'), transfer: gateNode('transfer'),
  annotation: DiagramAnnotationNode,
}

const importanceCols = [
  { key: 'event', label: 'Event' },
  { key: 'Birnbaum', label: 'Birnbaum' },
  { key: 'Criticality', label: 'Criticality' },
  { key: 'Fussell-Vesely', label: 'FV' },
  { key: 'RAW', label: 'RAW' },
  { key: 'RRW', label: 'RRW' },
]

const ENGINE_OPTIONS: { id: 'auto' | 'exact' | 'simulation'; label: string; help: string }[] = [
  { id: 'auto', label: 'Auto', help: 'Exact ROBDD for static trees and eligible exponential PAND/POR trees; otherwise chronological simulation.' },
  { id: 'exact', label: 'Exact only', help: 'Fail closed unless an exact ROBDD or ordered-failure CTMC is mathematically eligible.' },
  { id: 'simulation', label: 'Simulation', help: 'Use Monte Carlo and report numerical sampling uncertainty.' },
]

const METHOD_LABELS: Record<string, string> = {
  exact: 'Exact',
  rare_event: 'Rare-event',
  min_cut_upper_bound: 'Min-cut UB',
  simulation: 'Simulation',
}

interface CanvasState {
  schemaVersion?: number
  nodes: Node[]
  edges: Edge[]
  exposureTime?: string
  result?: FaultTreeResponse | null
  engine?: 'auto' | 'exact' | 'simulation'
  confidenceLevel?: string
  nSimulations?: string
  simSeed?: string
  density?: DiagramDensity
  connectorStyle?: 'smoothstep' | 'bezier' | 'straight'
  snapToGrid?: boolean
  annotations?: Node[]
  showNodeIds?: boolean
}

interface ResultNodeSelection {
  source: 'nodes' | 'importance'
  rowKey: string
  nodeIds: string[]
}

interface NodeClipboard {
  nodes: { id: string; type: string; data: Record<string, unknown>; position: { x: number; y: number } }[]
  edges: Edge[]
}

const INITIAL_CANVAS: CanvasState = {
  schemaVersion: 2,
  nodes: [], edges: [], exposureTime: '1000', engine: 'auto',
  confidenceLevel: '95', nSimulations: '20000', simSeed: '', density: 'comfortable',
  connectorStyle: 'smoothstep', snapToGrid: false, annotations: [], showNodeIds: true,
}
const faultTreeKey = 'faultTree'

function persistedCanvasNodes(nodes: Node[]): Node[] {
  return nodes.map(node => {
    const data = { ...node.data }
    delete data.highlighted
    delete data.computedP
    delete data.structuralRole
    delete data.showNodeIds
    const clean = { ...node }
    delete clean.selected
    delete clean.dragging
    return { ...clean, data }
  })
}

function defaultInputRole(type: string, index: number): string {
  if (type === 'inhibit') return index === 0 ? 'primary' : 'condition'
  if (type === 'imply') return index === 0 ? 'antecedent' : 'consequent'
  if (type === 'por') return index === 0 ? 'priority' : 'blocker'
  if (type === 'spare') return index === 0 ? 'primary' : 'spare'
  if (type === 'fdep') return index === 0 ? 'trigger' : 'dependent'
  if (type === 'seq') return 'sequence'
  return 'input'
}

function edgePresentation(sourceType: string, role: string, order: number) {
  const semantic = ['pand', 'por', 'spare', 'seq', 'fdep', 'imply', 'inhibit'].includes(sourceType)
  if (!semantic) return {}
  const roleLabel = role === 'input' || role === 'sequence' ? '' : ` · ${role}`
  return {
    label: `${order + 1}${roleLabel}`,
    labelStyle: { fontSize: 11, fontWeight: 600, fill: '#334155' },
    labelBgStyle: { fill: '#ffffff', fillOpacity: 0.92 },
    labelBgPadding: [5, 3] as [number, number],
    labelBgBorderRadius: 5,
  }
}

function normalizeSemanticEdges(rawEdges: Edge[], graphNodes: Node[]): Edge[] {
  const byId = new Map(graphNodes.map(node => [node.id, node]))
  const nextOrder = new Map<string, number>()
  return (rawEdges ?? []).map((edge, index) => {
    const sourceType = byId.get(edge.source)?.type ?? ''
    const existing = (edge.data ?? {}) as { role?: string; order?: number }
    const order = Number.isInteger(existing.order)
      ? Number(existing.order) : (nextOrder.get(edge.source) ?? 0)
    nextOrder.set(edge.source, Math.max(nextOrder.get(edge.source) ?? 0, order + 1))
    const role = existing.role || defaultInputRole(sourceType, order)
    return {
      ...edge,
      id: edge.id || `e-${edge.source}-${edge.target}-${index}`,
      data: { ...existing, role, order },
      ...edgePresentation(sourceType, role, order),
    }
  })
}

/** Read every faultTree folio's graph as {tree_id -> graph} for transfer-gate
 *  resolution (#9). Reads the raw module slice directly so all trees (not just
 *  the active one) are available at analyze time. */
function collectAllTrees(): { trees: Record<string, FaultTreeGraph>; names: Record<string, string> } {
  const trees: Record<string, FaultTreeGraph> = {}
  const names: Record<string, string> = {}
  const raw = getProjectState().modules['faultTree'] as
    | { _folioWrap?: boolean; folios?: { id: string; name: string; state?: CanvasState }[] }
    | undefined
  if (!raw || !raw.folios) return { trees, names }
  for (const f of raw.folios) {
    const st = f.state ?? INITIAL_CANVAS
    const modelEdges = restoreExpandedTransferEndpoints(st.edges ?? [], st.nodes ?? [])
    trees[f.id] = {
      nodes: (st.nodes ?? []).map(n => ({
        id: n.id, type: n.type ?? 'basic', data: n.data as Record<string, unknown>,
      })),
      edges: modelEdges.map(e => ({
        id: e.id,
        source: e.source,
        target: e.target,
        role: String((e.data as { role?: string } | undefined)?.role ?? '') || undefined,
        order: Number.isInteger((e.data as { order?: number } | undefined)?.order)
          ? Number((e.data as { order?: number }).order) : undefined,
      })),
    }
    names[f.id] = f.name
  }
  return { trees, names }
}

function collectAllCanvasTrees(): Record<string, CanvasState> {
  const raw = getProjectState().modules['faultTree'] as
    | { _folioWrap?: boolean; folios?: { id: string; state?: CanvasState }[] }
    | undefined
  if (!raw?.folios) return {}
  return Object.fromEntries(raw.folios.map(folio => [folio.id, folio.state ?? INITIAL_CANVAS]))
}

export default function FaultTreePage() {
  const [persisted, , folios] = useFolioState<CanvasState>(faultTreeKey, INITIAL_CANVAS)
  const revision = useRevision()
  const ldaFolios = useReliabilitySources()
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(sanitizeNodes(persisted.nodes ?? []))
  const [annotations, setAnnotations, onAnnotationsChange] = useNodesState<Node>(
    sanitizeNodes(persisted.annotations ?? []),
  )
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(
    normalizeSemanticEdges(
      restoreExpandedTransferEndpoints(persisted.edges ?? [], persisted.nodes ?? []),
      persisted.nodes ?? [],
    ),
  )
  const [selectedNode, setSelectedNode] = useState<Node | null>(null)
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([])
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null)
  const [result, setResult] = useState<FaultTreeResponse | null>(persisted.result ?? null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resultTab, setResultTab] = useState<'qualitative' | 'curve' | 'nodes' | 'importance' | 'formulas' | 'methods'>('qualitative')
  const [activeMCS, setActiveMCS] = useState<number | null>(null)
  const [resultNodeSelection, setResultNodeSelection] = useState<ResultNodeSelection | null>(null)
  const [rightPaneMode, setRightPaneMode] = useState<'properties' | 'results'>('results')
  const [propertiesHost, setPropertiesHost] = useState<HTMLDivElement | null>(null)
  const [clipboard, setClipboard] = useState<NodeClipboard | null>(null)
  const [globalExposure, setGlobalExposure] = useState<string>(persisted.exposureTime ?? '1000')
  const [engine, setEngine] = useState<'auto' | 'exact' | 'simulation'>(persisted.engine ?? 'auto')
  const [nSimulations, setNSimulations] = useState<string>(persisted.nSimulations ?? '20000')
  const [simSeed, setSimSeed] = useState<string>(persisted.simSeed ?? '')
  const [confidenceLevel, setConfidenceLevel] = useState<string>(persisted.confidenceLevel ?? '95')
  const [density, setDensity] = useState<DiagramDensity>(normalizeDiagramDensity(persisted.density))
  const [connectorStyle, setConnectorStyle] = useState<'smoothstep' | 'bezier' | 'straight'>(persisted.connectorStyle ?? 'smoothstep')
  const [snapToGrid, setSnapToGrid] = useState(Boolean(persisted.snapToGrid))
  const [showNodeIds, setShowNodeIds] = useState(persisted.showNodeIds !== false)
  const [progress, setProgress] = useState<FaultTreeProgress | null>(null)
  const [openPSANotices, setOpenPSANotices] = useState<OpenPSAWarning[]>([])
  const [validation, setValidation] = useState<FaultTreeValidationResponse | null>(null)
  const [showValidationIssues, setShowValidationIssues] = useState(false)
  const [paletteSearch, setPaletteSearch] = useState('')
  const [draggedInputEdgeId, setDraggedInputEdgeId] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const openPSAInputRef = useRef<HTMLInputElement>(null)
  const flowWrapperRef = useRef<HTMLDivElement>(null)
  const flowInstanceRef = useRef<ReactFlowInstance<Node, Edge> | null>(null)
  const resultsRef = useRef<HTMLDivElement>(null)
  const insertionSequenceRef = useRef(0)

  const modelEdges = useMemo(
    () => restoreExpandedTransferEndpoints(edges, nodes),
    [edges, nodes],
  )
  useEffect(() => {
    if (modelEdges !== edges) setEdges(normalizeSemanticEdges(modelEdges, nodes))
  }, [modelEdges, edges, nodes, setEdges])

  // React Flow renders redirected endpoints while a Transfer gate is expanded.
  // Only selection/removal changes apply directly to the stored model; replace
  // changes retain the canonical Transfer-gate endpoints.
  const onDiagramEdgesChange = useCallback((changes: EdgeChange<Edge>[]) => {
    const byId = new Map(modelEdges.map(edge => [edge.id, edge]))
    const safeChanges: EdgeChange<Edge>[] = []
    for (const change of changes) {
      // Connections are added through onConnect; display-only add changes must
      // never be allowed to manufacture semantic model edges.
      if (change.type === 'add') continue
      if (String(change.id).startsWith('transfer-view:')
          || String(change.id).startsWith('annotation-edge:')) continue
      if (change.type !== 'replace') {
        if (byId.has(change.id)) safeChanges.push(change)
        continue
      }
      const modelEdge = byId.get(change.id)
      if (!modelEdge) continue
      safeChanges.push({
        ...change,
        item: { ...change.item, source: modelEdge.source, target: modelEdge.target },
      })
    }
    if (safeChanges.length) onEdgesChange(safeChanges)
  }, [modelEdges, onEdgesChange])

  const densityIndex = DIAGRAM_DENSITY_LEVELS.indexOf(density)
  const stepDiagramDensity = (direction: -1 | 1) => {
    const nextIndex = Math.max(0, Math.min(
      DIAGRAM_DENSITY_LEVELS.length - 1,
      densityIndex + direction,
    ))
    setDensity(DIAGRAM_DENSITY_LEVELS[nextIndex])
  }

  const visibleInsertionPosition = (nodeWidth = 160, nodeHeight = 120) => {
    const instance = flowInstanceRef.current
    const bounds = flowWrapperRef.current?.getBoundingClientRect()
    if (!instance || !bounds || bounds.width <= 0 || bounds.height <= 0) {
      return { x: 220, y: 140 }
    }
    // Adding a node opens Properties. Reserve that pane before computing the
    // center so the new item remains visible after the canvas contracts.
    const rightPaneAlreadyVisible = Boolean(result || selectedNode || selectedAnnotationId)
    const reservedWidth = rightPaneAlreadyVisible ? 0 : Math.min(480, bounds.width * 0.45)
    const stagger = [
      [0, 0], [24, 24], [-24, 24], [24, -24], [-24, -24],
    ][insertionSequenceRef.current++ % 5]
    const center = instance.screenToFlowPosition({
      x: bounds.left + (bounds.width - reservedWidth) / 2 + stagger[0],
      y: bounds.top + bounds.height / 2 + stagger[1],
    })
    const position = { x: center.x - nodeWidth / 2, y: center.y - nodeHeight / 2 }
    return snapToGrid
      ? { x: Math.round(position.x / 20) * 20, y: Math.round(position.y / 20) * 20 }
      : position
  }

  // Other trees (folios) usable as transfer targets (excludes current tree).
  const transferTargets = useMemo(
    () => folios.folios.filter(f => f.id !== folios.activeId),
    [folios.folios, folios.activeId],
  )
  const visiblePaletteGroups = useMemo(() => {
    const query = paletteSearch.trim().toLowerCase()
    return NODE_PALETTE_GROUPS
      .map(group => ({
        ...group,
        items: group.items.filter(([type, label]) =>
          !query || `${type} ${label}`.toLowerCase().includes(query)),
      }))
      .filter(group => group.items.length > 0)
  }, [paletteSearch])

  const activeQualitativeEvents = useMemo(() => {
    if (activeMCS == null || !result) return []
    return result.analysis_kind === 'static_noncoherent'
      ? result.failure_conditions?.[activeMCS]?.required_failed ?? []
      : result.analysis_kind === 'dynamic'
        ? result.cut_sequences?.[activeMCS]?.events ?? []
        : result.minimal_cut_sets[activeMCS] ?? []
  }, [activeMCS, result])

  const activeMCSEventNodeIds = useMemo(() => {
    const ids = new Set<string>()
    const keys = new Set(activeQualitativeEvents)
    if (!keys.size) return ids
    for (const node of nodes) {
      if (!EVENT_NODE_TYPES.has(node.type ?? '')) continue
      const identity = String(node.data.eventKey ?? node.id)
      const label = String(node.data.label ?? node.id)
      if (keys.has(identity) || keys.has(label)) ids.add(node.id)
    }
    return ids
  }, [activeQualitativeEvents, nodes])

  // Walk stored parent -> child connectors in reverse from every event in the
  // active cut set. This highlights the complete propagation route from each
  // cut-set event back through its gates to the top of the tree. Repeated event
  // occurrences intentionally illuminate every route that represents the same
  // logical event.
  const activeMCSPropagation = useMemo(() => {
    const connectorIds = new Set<string>()
    const nodeIds = new Set(activeMCSEventNodeIds)
    if (activeMCS == null || !activeMCSEventNodeIds.size) return { connectorIds, nodeIds }
    const frontier = [...activeMCSEventNodeIds]
    const visitedNodes = new Set(frontier)
    while (frontier.length) {
      const childId = frontier.pop() as string
      for (const edge of edges) {
        if (edge.target !== childId) continue
        connectorIds.add(edge.id)
        if (!visitedNodes.has(edge.source)) {
          visitedNodes.add(edge.source)
          nodeIds.add(edge.source)
          frontier.push(edge.source)
        }
      }
    }
    return { connectorIds, nodeIds }
  }, [activeMCS, activeMCSEventNodeIds, edges])
  const activeMCSConnectorIds = activeMCSPropagation.connectorIds

  // Compute which node IDs should be highlighted:
  // 1. MCS highlighting: when a cut set is selected, highlight its events.
  // 2. Nodes/Importance result highlighting: focus the selected result row.
  // 3. Mirror highlighting: when a basic event is selected, highlight all
  //    nodes sharing the same eventKey (auto-mirror siblings).
  const highlightedNodes = useMemo<Set<string>>(() => {
    const ids = new Set(activeMCSPropagation.nodeIds)
    for (const nodeId of resultNodeSelection?.nodeIds ?? []) ids.add(nodeId)
    if (selectedNode?.type && EVENT_NODE_TYPES.has(selectedNode.type) && selectedNode.type !== 'house') {
      const selKey = String(selectedNode.data.eventKey ?? selectedNode.id)
      const siblings = nodes.filter(n =>
        EVENT_NODE_TYPES.has(n.type ?? '') && n.id !== selectedNode.id
        && String(n.data.eventKey ?? n.id) === selKey)
      if (siblings.length > 0) {
        ids.add(selectedNode.id)
        siblings.forEach(n => ids.add(n.id))
      }
    }
    return ids
  }, [activeMCSPropagation, resultNodeSelection, nodes, selectedNode])
  const eventOccurrenceCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const node of nodes) {
      if (!EVENT_NODE_TYPES.has(node.type ?? '') || node.type === 'house') continue
      const eventKey = String(node.data.eventKey ?? node.id)
      counts.set(eventKey, (counts.get(eventKey) ?? 0) + 1)
    }
    return counts
  }, [nodes])

  // Highlighting is presentation state, not model data: decorate the nodes
  // passed to React Flow without dirtying the project or entering undo history.
  const computedNodeValues = useMemo(
    () => new Map((result?.node_results ?? []).map(row => [row.node_id, row.probability])),
    [result],
  )
  const resolvedGateIds = useMemo(() => resolveGateIds(nodes), [nodes])
  const expandedTransferView = useMemo(() => {
    const canvasTrees = collectAllCanvasTrees()
    const virtualNodes: Node[] = []
    const virtualEdges: Edge[] = []
    const rootByTransfer = new Map<string, string>()
    const expandedTransferIds = new Set<string>()

    for (const transfer of nodes) {
      if (transfer.type !== 'transfer' || !transfer.data.expandReference) continue
      const targetId = String(transfer.data.transferTo ?? '')
      const referenced = canvasTrees[targetId]
      if (!targetId || targetId === folios.activeId || !referenced?.nodes?.length) continue
      const referencedNodes = sanitizeNodes(referenced.nodes)
      const referencedGateIds = resolveGateIds(referencedNodes)
      const nodeIds = new Set(referencedNodes.map(node => node.id))
      const referencedEdges = normalizeSemanticEdges(referenced.edges ?? [], referencedNodes)
        .filter(edge => nodeIds.has(edge.source) && nodeIds.has(edge.target))
      const typeById = new Map(referencedNodes.map(node => [node.id, node.type ?? 'basic']))
      const causalTargets = new Set(referencedEdges
        .filter(edge => !CONSTRAINT_NODE_TYPES.has(typeById.get(edge.source) ?? ''))
        .map(edge => edge.target))
      const root = referencedNodes
        .filter(node => !CONSTRAINT_NODE_TYPES.has(node.type ?? '') && !causalTargets.has(node.id))
        .sort((left, right) => left.position.y - right.position.y || left.position.x - right.position.x)[0]
      if (!root) continue

      const prefix = `transfer-view:${transfer.id}:`
      const virtualId = (sourceId: string) => `${prefix}${sourceId}`
      const rootPosition = root.position ?? { x: 0, y: 0 }
      referencedNodes.forEach(node => virtualNodes.push({
        ...node,
        id: virtualId(node.id),
        position: {
          x: transfer.position.x + node.position.x - rootPosition.x,
          y: transfer.position.y + node.position.y - rootPosition.y,
        },
        selected: false,
        draggable: false,
        connectable: false,
        deletable: false,
        data: {
          ...node.data,
          ...(!EVENT_NODE_TYPES.has(node.type ?? '')
            ? { gateId: referencedGateIds.get(node.id) } : {}),
          expandReference: false,
          displayDensity: density,
          virtualTransferOwner: transfer.id,
          virtualSourceId: node.id,
        },
      }))
      referencedEdges.forEach((edge, index) => virtualEdges.push({
        ...edge,
        id: `${prefix}edge:${edge.id || index}`,
        source: virtualId(edge.source),
        target: virtualId(edge.target),
        selectable: false,
        deletable: false,
      }))
      rootByTransfer.set(transfer.id, virtualId(root.id))
      expandedTransferIds.add(transfer.id)
    }
    return { virtualNodes, virtualEdges, rootByTransfer, expandedTransferIds }
  }, [nodes, density, folios.activeId, revision])

  const diagramNodes = useMemo(() => [
    ...nodes.filter(node => !expandedTransferView.expandedTransferIds.has(node.id)),
    ...expandedTransferView.virtualNodes,
    ...annotations,
  ], [nodes, annotations, expandedTransferView])
  const diagramEdges = useMemo(() => [
    ...modelEdges
      .filter(edge => !expandedTransferView.expandedTransferIds.has(edge.source))
      .map(edge => ({
        ...edge,
        target: expandedTransferView.rootByTransfer.get(edge.target) ?? edge.target,
      })),
    ...expandedTransferView.virtualEdges,
    ...annotations.flatMap(annotation => {
      const targetId = String(annotation.data.targetId ?? '')
      const target = nodes.find(node => node.id === targetId)
      if (!targetId || !target) return []
      const visibleTarget = expandedTransferView.rootByTransfer.get(targetId) ?? targetId
      const palette = ANNOTATION_PALETTE[String(annotation.data.color ?? 'amber')]
        ?? ANNOTATION_PALETTE.amber
      const shape = String(annotation.data.shape ?? 'rounded')
      const annotationWidth = Number(annotation.measured?.width ?? annotation.width)
        || (shape === 'oval' || shape === 'capsule' ? 208 : 192)
      const annotationHeight = Number(annotation.measured?.height ?? annotation.height)
        || (shape === 'oval' ? 96 : 64)
      const targetWidth = Number(target.measured?.width ?? target.width)
        || (EVENT_NODE_TYPES.has(target.type ?? '') ? 144 : 160)
      const targetHeight = Number(target.measured?.height ?? target.height) || 120
      const deltaX = annotation.position.x + annotationWidth / 2
        - (target.position.x + targetWidth / 2)
      const deltaY = annotation.position.y + annotationHeight / 2
        - (target.position.y + targetHeight / 2)
      let sourceSide: 'top' | 'right' | 'bottom' | 'left'
      let targetSide: 'top' | 'right' | 'bottom' | 'left'
      if (Math.abs(deltaX) >= Math.abs(deltaY)) {
        sourceSide = deltaX >= 0 ? 'left' : 'right'
        targetSide = deltaX >= 0 ? 'right' : 'left'
      } else {
        sourceSide = deltaY >= 0 ? 'top' : 'bottom'
        targetSide = deltaY >= 0 ? 'bottom' : 'top'
      }
      return [{
        id: `annotation-edge:${annotation.id}`,
        source: annotation.id,
        sourceHandle: `annotation-${sourceSide}`,
        target: visibleTarget,
        targetHandle: `annotation-label-${targetSide}`,
        type: 'straight',
        selectable: false,
        deletable: false,
        data: {
          isAnnotation: true,
          annotationColor: palette.accent,
          annotationOpacity: Math.max(0.1, Math.min(1, Number(annotation.data.fillOpacity ?? 100) / 100)),
        },
      } as Edge]
    }),
  ], [modelEdges, annotations, nodes, expandedTransferView])
  const displayNodes = useMemo(() => {
    const childCounts = new Map<string, number>()
    const parentCounts = new Map<string, number>()
    for (const edge of diagramEdges) {
      childCounts.set(edge.source, (childCounts.get(edge.source) ?? 0) + 1)
      parentCounts.set(edge.target, (parentCounts.get(edge.target) ?? 0) + 1)
    }
    return diagramNodes.map(node => {
      const structuralRole = node.type === 'or' && childCounts.get(node.id) === 1
        ? ((parentCounts.get(node.id) ?? 0) === 0 ? 'top' : 'intermediate')
        : undefined
      return {
        ...node,
        data: {
          ...node.data,
          ...(node.type !== 'annotation' && !EVENT_NODE_TYPES.has(node.type ?? '') && !node.data.virtualTransferOwner
            ? { gateId: resolvedGateIds.get(node.id) } : {}),
          showNodeIds,
          computedP: computedNodeValues.get(node.id),
          highlighted: highlightedNodes.has(node.id),
          ...(EVENT_NODE_TYPES.has(node.type ?? '') && node.type !== 'house'
            ? { eventOccurrenceCount: eventOccurrenceCounts.get(String(node.data.eventKey ?? node.id)) ?? 1 }
            : {}),
          structuralRole,
        },
      }
    })
  }, [diagramNodes, diagramEdges, computedNodeValues, highlightedNodes, eventOccurrenceCounts, resolvedGateIds, showNodeIds])
  const displayEdges = useMemo(() => {
    const childCounts = new Map<string, number>()
    diagramEdges.forEach(edge => childCounts.set(edge.source, (childCounts.get(edge.source) ?? 0) + 1))
    return diagramEdges.map(edge => {
      const annotationData = edge.data as {
        isAnnotation?: boolean; annotationColor?: string; annotationOpacity?: number
      } | undefined
      const annotation = Boolean(annotationData?.isAnnotation)
      const selectedConnector = !annotation && Boolean(edge.selected)
      const mcsConnector = !annotation && activeMCSConnectorIds.has(edge.id)
      const flowingConnector = selectedConnector || mcsConnector
      const stroke = annotation ? (annotationData?.annotationColor ?? '#64748b')
        : selectedConnector ? '#2563eb' : mcsConnector ? '#f59e0b' : '#64748b'
      return {
        ...edge,
        animated: flowingConnector,
        className: [edge.className, selectedConnector ? 'fta-selected-connector'
          : mcsConnector ? 'fta-mcs-connector' : '']
          .filter(Boolean).join(' '),
        interactionWidth: 24,
        type: annotation ? 'straight'
          : connectorStyle === 'smoothstep' && childCounts.get(edge.source) === 1
            ? 'straight' : connectorStyle,
        markerEnd: annotation
          ? { type: MarkerType.ArrowClosed, width: 14, height: 14, color: stroke }
          : undefined,
        markerStart: annotation ? undefined
          : { type: MarkerType.ArrowClosed, width: flowingConnector ? 20 : 16,
              height: flowingConnector ? 20 : 16, color: stroke },
        style: {
          ...edge.style,
          stroke,
          opacity: annotation ? annotationData?.annotationOpacity ?? 1 : 1,
          strokeWidth: annotation ? 1.25 : flowingConnector ? 3.2 : 1.6,
          ...(selectedConnector ? { filter: 'drop-shadow(0 0 2px rgba(37, 99, 235, 0.55))' } : {}),
          ...(mcsConnector && !selectedConnector
            ? { filter: 'drop-shadow(0 0 2px rgba(245, 158, 11, 0.6))' } : {}),
          ...(annotation ? { strokeDasharray: '5 4' } : {}),
        },
      }
    })
  }, [diagramEdges, connectorStyle, activeMCSConnectorIds])

  useEffect(() => {
    if (!result) setResultNodeSelection(null)
  }, [result])

  useEffect(() => {
    if (validation?.valid) setShowValidationIssues(false)
  }, [validation])

  useEffect(() => {
    if (resultTab === 'curve' && !(result?.time_curve?.length)) setResultTab('qualitative')
  }, [result, resultTab])

  useEffect(() => {
    setNodes(current => current.map(node => node.data.displayDensity === density
      ? node : { ...node, data: { ...node.data, displayDensity: density } }))
  }, [density, setNodes])

  // Persist canvas to the project store, debounced. Writes are addressed to the
  // folio the current canvas belongs to (`ownerFolio`), not whichever folio is
  // active when the timer fires — so switching folios can never drop or
  // misplace a pending write.
  const persistedNodes = persistedCanvasNodes(nodes)
  const persistedAnnotations = persistedCanvasNodes(annotations)
  const latest = useRef<CanvasState>({
    schemaVersion: 2, nodes: persistedNodes, edges: modelEdges, annotations: persistedAnnotations,
    exposureTime: globalExposure, result, engine, nSimulations, simSeed, confidenceLevel,
    density, connectorStyle, snapToGrid, showNodeIds,
  })
  latest.current = {
    schemaVersion: 2, nodes: persistedNodes, edges: modelEdges, annotations: persistedAnnotations,
    exposureTime: globalExposure, result, engine, nSimulations, simSeed, confidenceLevel,
    density, connectorStyle, snapToGrid, showNodeIds,
  }
  const ownerFolio = useRef(folios.activeId)
  const persistTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => {
    if (persistTimer.current) clearTimeout(persistTimer.current)
    persistTimer.current = setTimeout(
      () => writeFolioState(faultTreeKey, ownerFolio.current, latest.current), 250)
  }, [nodes, modelEdges, annotations, globalExposure, engine, nSimulations, simSeed, confidenceLevel, density, connectorStyle, snapToGrid, showNodeIds]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => {
    if (persistTimer.current) clearTimeout(persistTimer.current)
    writeFolioState(faultTreeKey, ownerFolio.current, latest.current)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const seenRevision = useRef(revision)
  const seenFolio = useRef(folios.activeId)
  useEffect(() => {
    if (revision !== seenRevision.current || folios.activeId !== seenFolio.current) {
      // Flush the outgoing folio's canvas to *its* slice before loading the new
      // one (revision changes come from import/new-project, where the in-memory
      // canvas is already stale, so skip the flush in that case).
      if (persistTimer.current) clearTimeout(persistTimer.current)
      if (revision === seenRevision.current && ownerFolio.current !== folios.activeId) {
        writeFolioState(faultTreeKey, ownerFolio.current, latest.current)
      }
      seenRevision.current = revision
      seenFolio.current = folios.activeId
      ownerFolio.current = folios.activeId
      setNodes(sanitizeNodes(persisted.nodes ?? []))
      setAnnotations(sanitizeNodes(persisted.annotations ?? []))
      setEdges(normalizeSemanticEdges(
        restoreExpandedTransferEndpoints(persisted.edges ?? [], persisted.nodes ?? []),
        persisted.nodes ?? [],
      ))
      setGlobalExposure(persisted.exposureTime ?? '1000')
      setEngine(persisted.engine ?? 'auto')
      setNSimulations(persisted.nSimulations ?? '20000')
      setSimSeed(persisted.simSeed ?? '')
      setConfidenceLevel(persisted.confidenceLevel ?? '95')
      setDensity(normalizeDiagramDensity(persisted.density))
      setConnectorStyle(persisted.connectorStyle ?? 'smoothstep')
      setShowNodeIds(persisted.showNodeIds !== false)
      setSnapToGrid(Boolean(persisted.snapToGrid))
      setSelectedNode(null)
      setSelectedNodeIds([])
      setSelectedAnnotationId(null)
      setResult(persisted.result ?? null)
      setActiveMCS(null)
      setResultNodeSelection(null)
      setRightPaneMode('results')
    }
  }, [revision, folios.activeId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Clear on-diagram computed-probability annotations whenever the graph
  // changes structurally (#5).
  const clearAnnotations = useCallback(() => {
    setNodes(nds => nds.some(n => n.data.computedP != null)
      ? nds.map(n => n.data.computedP != null
        ? { ...n, data: { ...n.data, computedP: undefined } } : n)
      : nds)
  }, [setNodes])

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return
      const sourceNode = nodes.find(node => node.id === connection.source)
      const sourceType = sourceNode?.type ?? ''
      setResult(null)
      clearAnnotations()
      setEdges(existing => {
        const siblingCount = existing.filter(edge => edge.source === connection.source).length
        const role = defaultInputRole(sourceType, siblingCount)
        const semantic = {
          ...connection,
          id: `e-${connection.source}-${connection.target}-${Date.now()}`,
          data: { role, order: siblingCount },
          ...edgePresentation(sourceType, role, siblingCount),
        }
        return addEdge(semantic, existing)
      })
    },
    [nodes, setEdges, clearAnnotations],
  )

  const onNodesChangeWrapped = useCallback(
    (changes: NodeChange[]) => {
      const modelIds = new Set(nodes.map(node => node.id))
      const annotationIds = new Set(annotations.map(node => node.id))
      const changeId = (change: NodeChange) => 'id' in change ? change.id : change.item.id
      const modelChanges = changes.filter(change => modelIds.has(changeId(change)))
      const annotationChanges = changes.filter(change => annotationIds.has(changeId(change)))
      // Adding/removing nodes invalidates the last result's annotations.
      if (modelChanges.some(c => c.type === 'add' || c.type === 'remove')) {
        setResult(null); clearAnnotations()
      }
      if (modelChanges.length) onNodesChange(sanitizeNodeChanges(modelChanges))
      if (annotationChanges.length) onAnnotationsChange(sanitizeNodeChanges(annotationChanges))
    },
    [nodes, annotations, onNodesChange, onAnnotationsChange, clearAnnotations],
  )

  const nextNodeId = () => {
    const maxId = nodes.reduce((m, n) => {
      const match = /^n(\d+)$/.exec(n.id)
      return match ? Math.max(m, parseInt(match[1], 10)) : m
    }, 0)
    return `n${maxId + 1}`
  }

  const nextGateId = (type: string) => {
    return allocateGateIds([type])[0]
  }

  const allocateGateIds = (types: string[]) => {
    const used = new Set(resolveGateIds(nodes).values())
    const ids: string[] = []
    for (const type of types) {
      const prefix = gateIdPrefix(type)
      let sequence = 1
      while (used.has(`${prefix}-${sequence}`)) sequence += 1
      const id = `${prefix}-${sequence}`
      ids.push(id)
      used.add(id)
    }
    return ids
  }

  const addNode = (type: string) => {
    const id = nextNodeId()
    const densityPreset = DIAGRAM_DENSITY[density]
    const defaults: Record<string, unknown> = { label: `${type.toUpperCase()}_${id}` }
    if (EVENT_NODE_TYPES.has(type) && type !== 'house') {
      defaults.probability = 0.01
      defaults.eventKey = id
    }
    if (type === 'house') defaults.state = false
    if (type === 'vote') defaults.k = 2
    if (type === 'cardinality') { defaults.min = 1; defaults.max = 2 }
    if (type === 'pand' || type === 'por') defaults.tie_policy = 'inclusive'
    if (type === 'spare') {
      defaults.spare_mode = 'cold'
      defaults.dormancy_factor = 0
      defaults.coverage = 1
    }
    if (type === 'transfer') defaults.referenceMode = 'shared'
    if (!EVENT_NODE_TYPES.has(type)) defaults.gateId = nextGateId(type)
    const newNode: Node = {
      id,
      type,
      position: visibleInsertionPosition(
        EVENT_NODE_TYPES.has(type) ? densityPreset.eventWidth : densityPreset.gateWidth,
      ),
      data: defaults,
    }
    setResult(null); clearAnnotations()
    setNodes(nds => [...nds, newNode])
    setSelectedNode(newNode)
    setSelectedNodeIds([newNode.id])
  }

  const addTransferReference = (target: { id: string; name: string }) => {
    const id = nextNodeId()
    const newNode: Node = {
      id,
      type: 'transfer',
      position: visibleInsertionPosition(DIAGRAM_DENSITY[density].gateWidth),
      data: {
        label: target.name,
        gateId: nextGateId('transfer'),
        transferTo: target.id,
        transferToName: target.name,
        referenceMode: 'shared',
        description: 'Shared reference to another Fault Tree Analysis in this project.',
      },
    }
    setResult(null); clearAnnotations()
    setNodes(current => [...current, newNode])
    setSelectedNode(newNode)
    setSelectedNodeIds([newNode.id])
    setRightPaneMode('properties')
  }

  const addDiagramAnnotation = (targetId?: string) => {
    const sequence = annotations.reduce((maximum, annotation) => {
      const match = /^annotation-(\d+)$/.exec(annotation.id)
      return match ? Math.max(maximum, Number(match[1])) : maximum
    }, 0) + 1
    const target = targetId ? nodes.find(node => node.id === targetId) : null
    const annotation: Node = {
      id: `annotation-${sequence}`,
      type: 'annotation',
      connectable: false,
      position: target
        ? { x: target.position.x + 230, y: target.position.y }
        : visibleInsertionPosition(ANNOTATION_SHAPES.rounded.defaultWidth, ANNOTATION_SHAPES.rounded.defaultHeight),
      selected: true,
      data: {
        text: target ? `Callout for ${String(target.data.label ?? target.id)}` : 'Diagram note',
        color: 'amber',
        shape: 'rounded',
        fillOpacity: 100,
        targetId: target?.id,
      },
    }
    setAnnotations(current => [
      ...current.map(item => ({ ...item, selected: false })),
      annotation,
    ])
    setSelectedAnnotationId(annotation.id)
    setSelectedNode(null)
    setSelectedNodeIds([])
    setRightPaneMode('properties')
  }

  const selectedAnnotation = annotations.find(annotation => annotation.id === selectedAnnotationId) ?? null
  const updateSelectedAnnotation = (updates: Record<string, unknown>) => {
    if (!selectedAnnotationId) return
    setAnnotations(current => current.map(annotation => annotation.id === selectedAnnotationId
      ? { ...annotation, data: { ...annotation.data, ...updates } } : annotation))
  }

  const deleteSelectedAnnotation = () => {
    if (!selectedAnnotationId) return
    setAnnotations(current => current.filter(annotation => annotation.id !== selectedAnnotationId))
    setSelectedAnnotationId(null)
    if (result) setRightPaneMode('results')
  }

  const selectedIdsForAction = () => {
    const selected = selectedNodeIds.filter(id => nodes.some(node => node.id === id))
    if (selected.length) return selected
    return selectedNode && nodes.some(node => node.id === selectedNode.id) ? [selectedNode.id] : []
  }

  const copyNode = () => {
    const selectedIds = selectedIdsForAction()
    if (!selectedIds.length) return
    const selectedSet = new Set(selectedIds)
    const copiedNodes = nodes.filter(node => selectedSet.has(node.id)).map(node => {
      const data = { ...node.data }
      delete data.highlighted
      delete data.computedP
      delete data.structuralRole
      delete data.showNodeIds
      delete data.virtualTransferOwner
      delete data.virtualSourceId
      return {
        id: node.id,
        type: node.type ?? 'basic',
        data: data as Record<string, unknown>,
        position: { ...node.position },
      }
    })
    const copiedEdges = edges.filter(edge => selectedSet.has(edge.source) && selectedSet.has(edge.target))
      .map(edge => ({ ...edge, data: { ...(edge.data ?? {}) }, selected: false }))
    setClipboard({ nodes: copiedNodes, edges: copiedEdges })
  }

  const cutNode = () => {
    const selectedIds = selectedIdsForAction()
    if (!selectedIds.length) return
    copyNode()
    const selectedSet = new Set(selectedIds)
    setNodes(current => current.filter(node => !selectedSet.has(node.id)))
    setEdges(current => current.filter(edge =>
      !selectedSet.has(edge.source) && !selectedSet.has(edge.target)))
    setSelectedNode(null)
    setSelectedNodeIds([])
    setResult(null); clearAnnotations()
  }

  // Paste creates independent event identities and fresh gate IDs while
  // retaining connections whose two endpoints were both copied.
  const pasteAsCopy = () => {
    if (!clipboard?.nodes.length) return
    const maxNodeSequence = nodes.reduce((maximum, node) => {
      const match = /^n(\d+)$/.exec(node.id)
      return match ? Math.max(maximum, parseInt(match[1], 10)) : maximum
    }, 0)
    const idMap = new Map(clipboard.nodes.map((node, index) => [node.id, `n${maxNodeSequence + index + 1}`]))
    const gateIds = allocateGateIds(clipboard.nodes
      .filter(node => !EVENT_NODE_TYPES.has(node.type)).map(node => node.type))
    let gateIndex = 0
    const densityPreset = DIAGRAM_DENSITY[density]
    const minX = Math.min(...clipboard.nodes.map(node => node.position.x))
    const minY = Math.min(...clipboard.nodes.map(node => node.position.y))
    const maxX = Math.max(...clipboard.nodes.map(node => node.position.x
      + (EVENT_NODE_TYPES.has(node.type) ? densityPreset.eventWidth : densityPreset.gateWidth)))
    const maxY = Math.max(...clipboard.nodes.map(node => node.position.y + 120))
    const insertion = visibleInsertionPosition(maxX - minX, maxY - minY)
    const translateX = insertion.x - minX
    const translateY = insertion.y - minY
    const newNodes: Node[] = clipboard.nodes.map(source => {
      const id = idMap.get(source.id)!
      const repeatableEvent = EVENT_NODE_TYPES.has(source.type) && source.type !== 'house'
      return {
        id,
        type: source.type,
        position: { x: source.position.x + translateX, y: source.position.y + translateY },
        selected: true,
        data: {
          ...source.data,
          ...(repeatableEvent ? { eventKey: id, mirror: false } : {}),
          ...(!EVENT_NODE_TYPES.has(source.type) ? { gateId: gateIds[gateIndex++] } : {}),
          computedP: undefined,
          label: `${String(source.data.label ?? source.type.toUpperCase())}_copy`,
        },
      }
    })
    const newEdges = clipboard.edges.map((edge, index) => ({
      ...edge,
      id: `e-copy-${idMap.get(edge.source)}-${idMap.get(edge.target)}-${index}`,
      source: idMap.get(edge.source)!,
      target: idMap.get(edge.target)!,
      selected: false,
    }))
    setResult(null); clearAnnotations()
    setNodes(current => [...current.map(node => ({ ...node, selected: false })), ...newNodes])
    setEdges(current => [...current, ...normalizeSemanticEdges(newEdges, newNodes)])
    setSelectedNode(newNodes[0] ?? null)
    setSelectedNodeIds(newNodes.map(node => node.id))
  }

  // #8 Mirror: references the SAME underlying basic event (shared eventKey) so
  // the backend de-duplicates it in cut sets / probability.
  const pasteAsMirror = () => {
    const source = clipboard?.nodes.length === 1 ? clipboard.nodes[0] : null
    if (!source || !EVENT_NODE_TYPES.has(source.type) || source.type === 'house') return
    const id = nextNodeId()
    // Preserve the source's eventKey so identity is shared.
    const sharedKey = String(source.data.eventKey ?? source.data.label ?? id)
    const newNode: Node = {
      id,
      type: source.type,
      position: visibleInsertionPosition(
        EVENT_NODE_TYPES.has(source.type)
          ? DIAGRAM_DENSITY[density].eventWidth : DIAGRAM_DENSITY[density].gateWidth,
      ),
      data: { ...source.data, eventKey: sharedKey, mirror: true, computedP: undefined },
    }
    setResult(null); clearAnnotations()
    setNodes(nds => [...nds, newNode])
    setSelectedNode(newNode)
    setSelectedNodeIds([newNode.id])
  }

  const autoLayout = () => {
    if (!nodes.length) return
    const byId = new Map(nodes.map(node => [node.id, node]))
    const childEdges = new Map<string, Edge[]>()
    const parents = new Map<string, string[]>()
    const indegree = new Map(nodes.map(node => [node.id, 0]))
    for (const edge of edges) {
      if (!byId.has(edge.source) || !byId.has(edge.target)) continue
      childEdges.set(edge.source, [...(childEdges.get(edge.source) ?? []), edge])
      parents.set(edge.target, [...(parents.get(edge.target) ?? []), edge.source])
      indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1)
    }
    childEdges.forEach(list => list.sort((left, right) =>
      Number((left.data as { order?: number } | undefined)?.order ?? 0)
      - Number((right.data as { order?: number } | undefined)?.order ?? 0)))

    // Longest-path ranks keep every connector flowing downward. Kahn ordering
    // also prevents a malformed cycle from producing an infinite layout loop.
    const roots = nodes.filter(node => (indegree.get(node.id) ?? 0) === 0)
      .sort((left, right) => left.position.x - right.position.x)
    if (!roots.length) return
    const layers = new Map<string, number>(roots.map(node => [node.id, 0]))
    const queue = roots.map(node => node.id)
    const remainingIndegree = new Map(indegree)
    while (queue.length) {
      const current = queue.shift()!
      for (const edge of childEdges.get(current) ?? []) {
        const child = edge.target
        layers.set(child, Math.max(layers.get(child) ?? 0, (layers.get(current) ?? 0) + 1))
        const remaining = (remainingIndegree.get(child) ?? 1) - 1
        remainingIndegree.set(child, remaining)
        if (remaining === 0) queue.push(child)
      }
    }
    // Keep any cyclic/unconnected residue visible on a final row; validation
    // still blocks its analysis and explains the graph defect.
    const maxRank = Math.max(0, ...layers.values())
    nodes.forEach(node => { if (!layers.has(node.id)) layers.set(node.id, maxRank + 1) })
    const byLayer = new Map<number, string[]>()
    layers.forEach((layer, id) => byLayer.set(layer, [...(byLayer.get(layer) ?? []), id]))
    byLayer.forEach(ids => ids.sort((left, right) =>
      (byId.get(left)?.position.x ?? 0) - (byId.get(right)?.position.x ?? 0)))

    // Repeated downward/upward barycentric sweeps substantially reduce edge
    // crossings while retaining semantic child order as the stable tie-break.
    const rankCount = Math.max(...byLayer.keys()) + 1
    const orderMap = (rank: number) => new Map(
      (byLayer.get(rank) ?? []).map((id, index) => [id, index]),
    )
    const reorder = (rank: number, neighbours: (id: string) => string[], neighbourRank: number) => {
      const ids = byLayer.get(rank)
      if (!ids || ids.length < 2) return
      const neighbourOrder = orderMap(neighbourRank)
      const stable = new Map(ids.map((id, index) => [id, index]))
      const barycenter = (id: string) => {
        const values = neighbours(id).map(value => neighbourOrder.get(value)).filter(
          (value): value is number => value != null,
        )
        return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length
          : (stable.get(id) ?? 0)
      }
      ids.sort((left, right) => barycenter(left) - barycenter(right)
        || (stable.get(left) ?? 0) - (stable.get(right) ?? 0))
    }
    for (let sweep = 0; sweep < 5; sweep++) {
      for (let rank = 1; rank < rankCount; rank++) {
        reorder(rank, id => parents.get(id) ?? [], rank - 1)
      }
      for (let rank = rankCount - 2; rank >= 0; rank--) {
        reorder(rank, id => (childEdges.get(id) ?? []).map(edge => edge.target), rank + 1)
      }
    }

    const estimateSize = (node: Node) => {
      const densityPreset = DIAGRAM_DENSITY[density]
      const type = node.type ?? ''
      const estimatedWidth = EVENT_NODE_TYPES.has(type)
        ? densityPreset.eventWidth : densityPreset.gateWidth
      const labelLines = Math.max(1, estimatedWrappedLines(node.data.label, densityPreset.labelWrap))
      const descriptionLines = estimatedWrappedLines(node.data.description, densityPreset.descriptionWrap)
      const descriptionLineHeight = descriptionLines >= 9 ? 9 : descriptionLines >= 6 ? 10
        : descriptionLines >= 4 ? 11 : 12
      let estimatedHeight = 66 + 4 + 8 + labelLines * densityPreset.labelLineHeight
      if (readableProbability(node.data as Record<string, unknown>) || type === 'house') estimatedHeight += 13
      if (node.data.eventKey != null && String(node.data.eventKey) !== String(node.data.label ?? '')) estimatedHeight += 12
      if (!EVENT_NODE_TYPES.has(type)) estimatedHeight += 12
      if (descriptionLines) estimatedHeight += 7 + descriptionLines * descriptionLineHeight
      if (node.data.ccf_group != null && String(node.data.ccf_group) !== '') estimatedHeight += 20
      const measuredWidth = Number(node.measured?.width ?? node.width)
      const measuredHeight = Number(node.measured?.height ?? node.height)
      return {
        width: Number.isFinite(measuredWidth) && measuredWidth > 0
          ? Math.max(measuredWidth, estimatedWidth) : estimatedWidth,
        height: Number.isFinite(measuredHeight) && measuredHeight > 0
          ? Math.max(measuredHeight, estimatedHeight) : estimatedHeight,
      }
    }
    const dimensions = new Map(nodes.map(node => [node.id, estimateSize(node)]))
    const spacingScale = DIAGRAM_DENSITY[density].spacingScale
    const routingGap = Math.round((connectorStyle === 'smoothstep'
      ? 104 : connectorStyle === 'bezier' ? 76 : 58) * spacingScale)
    const nodeGap = Math.round((connectorStyle === 'smoothstep' ? 82 : 62) * spacingScale)
    const layerTops = new Map<number, number>()
    let nextTop = 82
    for (let rank = 0; rank < rankCount; rank++) {
      layerTops.set(rank, nextTop)
      const tallest = Math.max(0, ...(byLayer.get(rank) ?? []).map(
        id => dimensions.get(id)?.height ?? 120))
      nextTop += tallest + routingGap
    }
    const canvasWidth = Math.max(900, flowWrapperRef.current?.clientWidth ?? 0)
    const centers = new Map<string, number>()
    const primaryParent = new Map<string, string>()
    const layerOrder = new Map<string, number>()
    byLayer.forEach(ids => ids.forEach((id, index) => layerOrder.set(id, index)))
    nodes.forEach(node => {
      const candidates = [...(parents.get(node.id) ?? [])].sort((left, right) =>
        (layers.get(right) ?? 0) - (layers.get(left) ?? 0)
        || (layerOrder.get(left) ?? 0) - (layerOrder.get(right) ?? 0))
      if (candidates.length) primaryParent.set(node.id, candidates[0])
    })

    type LayoutBlock = { ids: string[]; min: number; max: number }
    const placed = new Set<string>()
    const translate = (ids: string[], offset: number) => {
      ids.forEach(id => centers.set(id, (centers.get(id) ?? 0) + offset))
    }
    const layoutSubtree = (id: string, visiting = new Set<string>()): LayoutBlock => {
      const width = dimensions.get(id)?.width ?? 150
      if (visiting.has(id) || placed.has(id)) {
        if (!centers.has(id)) centers.set(id, 0)
        return { ids: [id], min: (centers.get(id) ?? 0) - width / 2, max: (centers.get(id) ?? 0) + width / 2 }
      }
      visiting.add(id)
      const ownedChildren = (childEdges.get(id) ?? [])
        .map(edge => edge.target)
        .filter(child => primaryParent.get(child) === id)
      const childBlocks = ownedChildren.map(child => layoutSubtree(child, visiting))
      let cursor = 0
      for (const block of childBlocks) {
        const offset = cursor - block.min
        translate(block.ids, offset)
        block.min += offset
        block.max += offset
        cursor = block.max + nodeGap
      }

      const childCenters = ownedChildren.map(child => centers.get(child) ?? 0)
      let center = 0
      if (childCenters.length % 2 === 1) {
        center = childCenters[Math.floor(childCenters.length / 2)]
      } else if (childCenters.length > 0) {
        const rightMiddle = childCenters.length / 2
        center = (childCenters[rightMiddle - 1] + childCenters[rightMiddle]) / 2
      }
      centers.set(id, center)
      const ids = [id, ...childBlocks.flatMap(block => block.ids)]
      const min = Math.min(center - width / 2, ...childBlocks.map(block => block.min))
      const max = Math.max(center + width / 2, ...childBlocks.map(block => block.max))
      visiting.delete(id)
      placed.add(id)
      return { ids, min, max }
    }

    // Lay out a spanning forest first. Sibling blocks remain rigid: for an odd
    // count the middle child shares the parent's centerline; for an even count
    // the parent is centered exactly between the two middle child centers.
    let forestCursor = 40
    for (const root of roots) {
      const block = layoutSubtree(root.id)
      const offset = forestCursor - block.min
      translate(block.ids, offset)
      forestCursor = block.max + offset + nodeGap * 1.5
    }
    for (const node of nodes) {
      if (placed.has(node.id)) continue
      const block = layoutSubtree(node.id)
      const offset = forestCursor - block.min
      translate(block.ids, offset)
      forestCursor = block.max + offset + nodeGap
    }

    // Shared DAG inputs can belong to only one spanning-tree block. A final
    // bottom-up centering pass recognizes every parent's direct input group.
    // Recomputing parents after snapping leaf centers preserves exact odd/even
    // alignment when the diagram grid is enabled.
    if (snapToGrid) {
      nodes.forEach(node => centers.set(node.id, Math.round((centers.get(node.id) ?? 0) / 20) * 20))
    }
    for (let rank = rankCount - 1; rank >= 0; rank--) {
      for (const id of byLayer.get(rank) ?? []) {
        const childCenters = (childEdges.get(id) ?? []).map(edge => centers.get(edge.target))
          .filter((value): value is number => value != null)
        if (!childCenters.length) continue
        const middle = Math.floor(childCenters.length / 2)
        centers.set(id, childCenters.length % 2 === 1
          ? childCenters[middle]
          : (childCenters[middle - 1] + childCenters[middle]) / 2)
      }
    }

    const left = Math.min(...nodes.map(node =>
      (centers.get(node.id) ?? 0) - (dimensions.get(node.id)?.width ?? 150) / 2))
    const right = Math.max(...nodes.map(node =>
      (centers.get(node.id) ?? 0) + (dimensions.get(node.id)?.width ?? 150) / 2))
    let forestOffset = Math.max(40 - left, (canvasWidth - (right - left)) / 2 - left)
    if (snapToGrid) forestOffset = Math.round(forestOffset / 20) * 20
    const positions = new Map<string, { x: number; y: number }>()
    byLayer.forEach((ids, rank) => {
      for (const id of ids) {
        const position = {
          x: (centers.get(id) ?? 0) + forestOffset - (dimensions.get(id)?.width ?? 150) / 2,
          y: layerTops.get(rank) ?? 82,
        }
        positions.set(id, {
          x: position.x,
          y: snapToGrid ? Math.round(position.y / 20) * 20 : position.y,
        })
      }
    })
    setNodes(current => current.map(node => ({
      ...node,
      position: positions.get(node.id) ?? node.position,
    })))
    requestAnimationFrame(() => {
      void flowInstanceRef.current?.fitView({ padding: 0.2, maxZoom: 1.1, duration: 400 })
    })
  }

  const deleteSelected = () => {
    const selectedIds = selectedIdsForAction()
    if (!selectedIds.length) return
    const selectedSet = new Set(selectedIds)
    setNodes(current => current.filter(node => !selectedSet.has(node.id)))
    setEdges(current => current.filter(edge =>
      !selectedSet.has(edge.source) && !selectedSet.has(edge.target)))
    setSelectedNode(null)
    setSelectedNodeIds([])
    setResult(null); clearAnnotations()
  }

  const orderedInputsFor = (nodeId: string) => edges
    .filter(edge => edge.source === nodeId)
    .sort((left, right) => Number((left.data as { order?: number } | undefined)?.order ?? 0)
      - Number((right.data as { order?: number } | undefined)?.order ?? 0))

  const rewriteInputEdges = (nodeId: string, ordered: Edge[]) => {
    const sourceType = nodes.find(node => node.id === nodeId)?.type ?? ''
    const byId = new Map(ordered.map((edge, order) => {
      const current = (edge.data ?? {}) as { role?: string }
      const role = current.role || defaultInputRole(sourceType, order)
      return [edge.id, {
        ...edge,
        data: { ...current, role, order },
        ...edgePresentation(sourceType, role, order),
      }]
    }))
    setEdges(existing => existing.map(edge => byId.get(edge.id) ?? edge))
    setResult(null)
    clearAnnotations()
  }

  const moveInput = (nodeId: string, edgeId: string, direction: -1 | 1) => {
    const ordered = orderedInputsFor(nodeId)
    const index = ordered.findIndex(edge => edge.id === edgeId)
    const next = index + direction
    if (index < 0 || next < 0 || next >= ordered.length) return
    ;[ordered[index], ordered[next]] = [ordered[next], ordered[index]]
    rewriteInputEdges(nodeId, ordered)
  }

  const dropInputAt = (nodeId: string, targetEdgeId: string) => {
    if (!draggedInputEdgeId || draggedInputEdgeId === targetEdgeId) return
    const ordered = orderedInputsFor(nodeId)
    const sourceIndex = ordered.findIndex(edge => edge.id === draggedInputEdgeId)
    const targetIndex = ordered.findIndex(edge => edge.id === targetEdgeId)
    if (sourceIndex < 0 || targetIndex < 0) return
    const [moved] = ordered.splice(sourceIndex, 1)
    ordered.splice(targetIndex, 0, moved)
    rewriteInputEdges(nodeId, ordered)
    setDraggedInputEdgeId(null)
  }

  const setInputRole = (nodeId: string, edgeId: string, role: string) => {
    const ordered = orderedInputsFor(nodeId).map(edge => edge.id === edgeId
      ? { ...edge, data: { ...(edge.data ?? {}), role } } : edge)
    rewriteInputEdges(nodeId, ordered)
  }

  const apiGraph = () => ({
    nodes: nodes.map(node => ({
      id: node.id, type: node.type ?? 'basic',
      data: node.data as Record<string, unknown>,
    })),
    edges: edges.map(edge => ({
      id: edge.id, source: edge.source, target: edge.target,
      role: String((edge.data as { role?: string } | undefined)?.role ?? '') || undefined,
      order: Number.isInteger((edge.data as { order?: number } | undefined)?.order)
        ? Number((edge.data as { order?: number }).order) : undefined,
    })),
  })

  const importOpenPSA = async (file: File) => {
    if (nodes.length > 0 && !window.confirm(
      'Importing an OpenPSA model replaces the nodes and connections in this tree. Continue?',
    )) return
    setError(null)
    try {
      const imported = await importOpenPSAFaultTree(await file.text())
      const importedNodes: Node[] = imported.nodes.map((node, index) => ({
        id: node.id,
        type: node.type,
        position: node.position ?? { x: 200 + (index % 4) * 220, y: 80 + Math.floor(index / 4) * 160 },
        data: {
          ...node.data,
          ...(!EVENT_NODE_TYPES.has(node.type)
            ? { gateId: `${gateIdPrefix(node.type)}-${index + 1}` } : {}),
          displayDensity: density,
        },
      }))
      const importedEdges: Edge[] = imported.edges.map((edge, index) => ({
        id: edge.id || `openpsa-edge-${index}`,
        source: edge.source,
        target: edge.target,
        data: { role: edge.role, order: edge.order },
      }))
      setNodes(sanitizeNodes(importedNodes))
      setEdges(normalizeSemanticEdges(importedEdges, importedNodes))
      setSelectedNode(null)
      setResult(null)
      setActiveMCS(null)
      setOpenPSANotices(imported.warnings)
    } catch (cause: unknown) {
      const detail = (cause as { response?: { data?: { detail?: string | { message?: string } } } })
        ?.response?.data?.detail
      setError(typeof detail === 'string' ? detail : detail?.message
        || (cause instanceof Error ? cause.message : 'OpenPSA import failed.'))
    } finally {
      if (openPSAInputRef.current) openPSAInputRef.current.value = ''
    }
  }

  const exportOpenPSA = async () => {
    if (!nodes.length) { setError('Add nodes before exporting an OpenPSA model.'); return }
    setError(null)
    try {
      const graph = apiGraph()
      const activeName = folios.folios.find(folio => folio.id === folios.activeId)?.name
        || 'Perdura_Fault_Tree'
      const exported = await exportOpenPSAFaultTree(graph.nodes, graph.edges, activeName)
      const blob = new Blob([exported.xml], { type: 'application/xml' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${activeName.replace(/[^A-Za-z0-9_.-]+/g, '_') || 'fault-tree'}.xml`
      anchor.click()
      URL.revokeObjectURL(url)
      setOpenPSANotices(exported.warnings)
    } catch (cause: unknown) {
      const detail = (cause as { response?: { data?: { detail?: string | { message?: string } } } })
        ?.response?.data?.detail
      setError(typeof detail === 'string' ? detail : detail?.message
        || (cause instanceof Error ? cause.message : 'OpenPSA export failed.'))
    }
  }

  const updateData = (key: string, value: unknown) => {
    if (!selectedNode) return
    setResult(null)
    clearAnnotations()
    const resolved = (key === 'probability' || ((key === 'distribution' || key === 'dist_params') && value != null))
      ? { [key]: value, sourceIncomplete: false } : { [key]: value }
    setNodes(nds => nds.map(n =>
      n.id === selectedNode.id ? { ...n, data: { ...n.data, ...resolved } } : n
    ))
    setSelectedNode(prev => prev ? { ...prev, data: { ...prev.data, ...resolved } } : null)
  }

  const updateDataMulti = (updates: Record<string, unknown>) => {
    if (!selectedNode) return
    setResult(null)
    clearAnnotations()
    const resolved = ('probability' in updates
      || updates.distribution != null || updates.dist_params != null)
      ? { ...updates, sourceIncomplete: false } : updates
    setNodes(nds => nds.map(n =>
      n.id === selectedNode.id ? { ...n, data: { ...n.data, ...resolved } } : n
    ))
    setSelectedNode(prev => prev ? { ...prev, data: { ...prev.data, ...resolved } } : null)
  }

  const changeSelectedNodeType = (nextType: string) => {
    if (!selectedNode || nextType === selectedNode.type) return
    const nextIsEvent = EVENT_NODE_TYPES.has(nextType)
    const outgoing = edges.filter(edge => edge.source === selectedNode.id)
      .sort((left, right) => Number((left.data as { order?: number } | undefined)?.order ?? 0)
        - Number((right.data as { order?: number } | undefined)?.order ?? 0))
    if (nextIsEvent && outgoing.length > 0 && !window.confirm(
      `Changing this node to ${nextType} will remove its ${outgoing.length} outgoing connection${outgoing.length === 1 ? '' : 's'}. Continue?`,
    )) return

    const data = { ...selectedNode.data }
    delete data.computedP
    delete data.highlighted
    delete data.structuralRole
    delete data.showNodeIds
    if (nextIsEvent) {
      for (const key of ['k', 'min', 'max', 'tie_policy', 'spare_mode', 'dormancy_factor',
        'coverage', 'referenceMode', 'transferTo', 'transferToName']) delete data[key]
      if (nextType === 'house') {
        data.state = Boolean(data.state)
        delete data.probability
        delete data.distribution
        delete data.dist_params
        delete data.exposure_time
        delete data.eventKey
        delete data.mirror
        delete data.gateId
      } else {
        delete data.state
        delete data.gateId
        data.eventKey = String(data.eventKey ?? selectedNode.id)
        if (typeof data.probability !== 'number' || !Number.isFinite(data.probability)) data.probability = 0.01
      }
    } else {
      for (const key of ['probability', 'distribution', 'dist_params', 'exposure_time',
        'ldaFolioId', 'ldaFolioName', 'ccf_group', 'ccf_beta', 'eventKey', 'mirror', 'state']) delete data[key]
      data.gateId = nextGateId(nextType)
      if (nextType === 'vote') data.k = Number(data.k ?? 2)
      if (nextType === 'cardinality') { data.min = Number(data.min ?? 1); data.max = Number(data.max ?? 2) }
      if (nextType === 'pand' || nextType === 'por') data.tie_policy = String(data.tie_policy ?? 'inclusive')
      if (nextType === 'spare') {
        data.spare_mode = String(data.spare_mode ?? 'cold')
        data.dormancy_factor = Number(data.dormancy_factor ?? 0)
        data.coverage = Number(data.coverage ?? 1)
      }
      if (nextType === 'transfer') data.referenceMode = String(data.referenceMode ?? 'shared')
    }
    setNodes(current => current.map(node => node.id === selectedNode.id
      ? { ...node, type: nextType, data }
      : node))
    setSelectedNode(current => current ? { ...current, type: nextType, data } : null)
    setEdges(current => {
      if (nextIsEvent) return current.filter(edge => edge.source !== selectedNode.id)
      const orderById = new Map(outgoing.map((edge, order) => [edge.id, order]))
      return current.map(edge => {
        const order = orderById.get(edge.id)
        if (order == null) return edge
        const role = defaultInputRole(nextType, order)
        return {
          ...edge,
          data: { ...(edge.data ?? {}), role, order },
          ...edgePresentation(nextType, role, order),
        }
      })
    })
    setResult(null)
    clearAnnotations()
  }

  const updateRepeatedEventData = (updates: Record<string, unknown>) => {
    if (!selectedNode || !EVENT_NODE_TYPES.has(selectedNode.type ?? '') || selectedNode.type === 'house') return
    setResult(null)
    clearAnnotations()
    const eventKey = String(selectedNode.data.eventKey ?? selectedNode.id)
    setNodes(nds => nds.map(n => {
      const key = String(n.data.eventKey ?? n.id)
      return EVENT_NODE_TYPES.has(n.type ?? '') && n.type !== 'house' && key === eventKey
        ? { ...n, data: { ...n.data, ...updates } }
        : n
    }))
    setSelectedNode(prev => prev ? { ...prev, data: { ...prev.data, ...updates } } : null)
  }

  const detachRepeatedEvent = () => {
    if (!selectedNode || !EVENT_NODE_TYPES.has(selectedNode.type ?? '') || selectedNode.type === 'house') return
    const sharedKey = String(selectedNode.data.eventKey ?? selectedNode.id)
    const occurrences = nodes.filter(node => EVENT_NODE_TYPES.has(node.type ?? '')
      && node.type !== 'house' && String(node.data.eventKey ?? node.id) === sharedKey)
    if (occurrences.length <= 1) return
    const remaining = occurrences.filter(node => node.id !== selectedNode.id)
    const remainingKey = selectedNode.id === sharedKey ? remaining[0].id : sharedKey
    setResult(null); clearAnnotations()
    setNodes(current => current.map(node => {
      if (node.id === selectedNode.id) {
        return { ...node, data: { ...node.data, eventKey: node.id, mirror: false, computedP: undefined } }
      }
      if (!remaining.some(item => item.id === node.id)) return node
      return {
        ...node,
        data: {
          ...node.data,
          eventKey: remainingKey,
          mirror: remaining.length > 1 && node.id !== remaining[0].id,
          computedP: undefined,
        },
      }
    }))
    setSelectedNode(previous => previous ? {
      ...previous,
      data: { ...previous.data, eventKey: previous.id, mirror: false, computedP: undefined },
    } : null)
  }

  const matchingResultNodes = useCallback((eventKey: string | undefined, nodeId?: string, label?: string) => {
    const exact = nodeId ? nodes.find(node => node.id === nodeId) : undefined
    if (exact && !EVENT_NODE_TYPES.has(exact.type ?? '')) return [exact]
    const identity = eventKey
      || (exact ? String(exact.data.eventKey ?? exact.id) : undefined)
    const matches = nodes.filter(node => {
      if (!EVENT_NODE_TYPES.has(node.type ?? '')) return node.id === nodeId
      const key = String(node.data.eventKey ?? node.id)
      return (identity != null && key === identity)
        || (identity == null && nodeId != null && node.id === nodeId)
        || (identity == null && label != null && String(node.data.label ?? node.id) === label)
    })
    return matches.length > 0 ? matches : (exact ? [exact] : [])
  }, [nodes])

  const toggleResultNodeHighlight = useCallback((
    source: ResultNodeSelection['source'], rowKey: string, matches: Node[],
  ) => {
    const isActive = resultNodeSelection?.source === source && resultNodeSelection.rowKey === rowKey
    if (isActive) {
      setResultNodeSelection(null)
      return
    }
    if (!matches.length) return
    setActiveMCS(null)
    setResultNodeSelection({ source, rowKey, nodeIds: matches.map(node => node.id) })
    setSelectedNode(matches[0])
    requestAnimationFrame(() => {
      void flowInstanceRef.current?.fitView({
        nodes: matches.map(node => ({ id: node.id })),
        padding: 0.7,
        minZoom: 0.65,
        maxZoom: 1.35,
        duration: 350,
      })
    })
  }, [resultNodeSelection])

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    if (node.type === 'annotation') {
      setSelectedAnnotationId(node.id)
      setSelectedNode(null)
      setSelectedNodeIds([])
      setRightPaneMode('properties')
      return
    }
    const transferOwner = String(node.data.virtualTransferOwner ?? '')
    const editableNode = transferOwner
      ? nodes.find(candidate => candidate.id === transferOwner) ?? node
      : node
    setSelectedNode(editableNode)
    setSelectedAnnotationId(null)
    setResultNodeSelection(null)
    setRightPaneMode('properties')
  }, [nodes])

  const onSelectionChange = useCallback(({ nodes: selected }: { nodes: Node[] }) => {
    const ids = new Set<string>()
    selected.forEach(node => {
      const owner = String(node.data.virtualTransferOwner ?? '')
      const id = owner || node.id
      if (nodes.some(candidate => candidate.id === id)) ids.add(id)
    })
    setSelectedNodeIds([...ids])
  }, [nodes])

  const onPaneClick = useCallback(() => {
    setSelectedNode(null)
    setSelectedNodeIds([])
    setSelectedAnnotationId(null)
    setResultNodeSelection(null)
    if (result) setRightPaneMode('results')
  }, [result])

  useEffect(() => {
    if (!nodes.length) { setValidation(null); return }
    const timer = window.setTimeout(() => {
      const apiNodes = nodes.map(node => ({
        id: node.id, type: node.type ?? 'basic',
        data: node.data as Record<string, unknown>,
      }))
      const apiEdges = modelEdges.map(edge => ({
        id: edge.id, source: edge.source, target: edge.target,
        role: String((edge.data as { role?: string } | undefined)?.role ?? '') || undefined,
        order: Number.isInteger((edge.data as { order?: number } | undefined)?.order)
          ? Number((edge.data as { order?: number }).order) : undefined,
      }))
      const { trees } = collectAllTrees()
      trees[folios.activeId] = { nodes: apiNodes, edges: apiEdges }
      const missionTime = globalExposure.trim() === '' ? undefined : parseFloat(globalExposure)
      void validateFaultTree(apiNodes, apiEdges, {
        exposureTime: Number.isFinite(missionTime) ? missionTime : null,
        trees, treeId: folios.activeId, engine,
      }).then(setValidation).catch(cause => {
        const detail = (cause as { response?: { data?: { detail?: string | { message?: string } } } })
          ?.response?.data?.detail
        setValidation({
          valid: false,
          issues: [{
            code: 'INPUT_CONTRACT',
            message: typeof detail === 'string' ? detail : detail?.message
              || (cause instanceof Error ? cause.message : 'Validation failed.'),
          }],
        })
      })
    }, 450)
    return () => window.clearTimeout(timer)
  }, [nodes, modelEdges, globalExposure, engine, folios.activeId]) // eslint-disable-line react-hooks/exhaustive-deps

  const analyze = async () => {
    if (!nodes.length) { setError('Add nodes to the fault tree first.'); return }
    if (validation?.valid === false) {
      setError(null)
      setShowValidationIssues(true)
      return
    }
    const confidence = parseFloat(confidenceLevel)
    if (!Number.isFinite(confidence) || confidence <= 0 || confidence >= 100) {
      setError('Confidence level must be a number greater than 0 and less than 100.')
      return
    }
    setError(null)
    setLoading(true)
    setProgress(null)
    setActiveMCS(null)
    setResultNodeSelection(null)
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const globalT = globalExposure.trim() === '' ? undefined : parseFloat(globalExposure)
    // Refresh node display probabilities for distribution events.
    const refreshed = nodes.map(n => {
      if (!EVENT_NODE_TYPES.has(n.type ?? '') || n.type === 'house') return n
      const dist = String(n.data.distribution ?? '')
      if (!dist || !DIST_PARAMS[dist]) return n
      const t = n.data.exposure_time != null ? Number(n.data.exposure_time) : (globalT ?? 0)
      const prob = Math.min(1, Math.max(0, computeCDF(dist, (n.data.dist_params ?? {}) as Record<string, number>, t)))
      return { ...n, data: { ...n.data, probability: prob } }
    })
    if (refreshed.some((n, i) => n !== nodes[i])) setNodes(refreshed)
    try {
      const apiNodes = refreshed.map(n => ({
        id: n.id,
        type: n.type ?? 'basic',
        data: n.data as Record<string, unknown>,
      }))
      const apiEdges = modelEdges.map(e => ({
        id: e.id,
        source: e.source,
        target: e.target,
        role: String((e.data as { role?: string } | undefined)?.role ?? '') || undefined,
        order: Number.isInteger((e.data as { order?: number } | undefined)?.order)
          ? Number((e.data as { order?: number }).order) : undefined,
      }))
      // Snapshot every folio so transfer gates can resolve their targets (#9).
      // Override the active tree with the just-refreshed in-memory graph.
      const { trees } = collectAllTrees()
      trees[folios.activeId] = { nodes: apiNodes, edges: apiEdges }
      const res = await analyzeFaultTreeStream(apiNodes, apiEdges, {
        exposureTime: globalT ?? null,
        methods: engine === 'exact' ? ['exact'] : engine === 'simulation' ? ['simulation'] : undefined,
        engine,
        confidenceLevel: confidence / 100,
        nSimulations: parseInt(nSimulations) || 20000,
        seed: simSeed.trim() ? parseInt(simSeed) : undefined,
        trees,
        treeId: folios.activeId,
      }, setProgress, controller.signal)
      setResult(res)
      setRightPaneMode('results')
      writeFolioState(faultTreeKey, folios.activeId, { ...latest.current, result: res })
    } catch (e: unknown) {
      if ((e as { name?: string }).name === 'AbortError') {
        setError('Analysis cancelled.')
        return
      }
      const detail = (e as { response?: { data?: { detail?: string | { message?: string } } } })
        ?.response?.data?.detail
      setError(typeof detail === 'string' ? detail : detail?.message
        || (e instanceof Error ? e.message : 'Analysis error.'))
    } finally {
      setLoading(false)
      setProgress(null)
      abortRef.current = null
    }
  }

  const downloadMCS = () => {
    if (!result) return
    let header = 'Order,Events'
    let rows = result.minimal_cut_sets.map((mcs, i) => `${i + 1},"${mcs.join(', ')}"`)
    if (result.analysis_kind === 'static_noncoherent') {
      header = 'Order,Required failed,Required successful,Condition probability'
      rows = (result.failure_conditions ?? []).map((condition, index) =>
        `${index + 1},"${condition.required_failed.join(', ')}","${condition.required_successful.join(', ')}",${condition.probability}`)
    } else if (result.analysis_kind === 'dynamic') {
      const exactDynamic = Boolean(result.computation?.exact_engine?.exact)
      header = exactDynamic
        ? 'Order,First-entry event sequence,Exact probability contribution,Conditional contribution'
        : 'Order,Event sequence,Trial count,Conditional contribution,Estimated probability'
      rows = (result.cut_sequences ?? []).map((sequence, index) =>
        exactDynamic
          ? `${index + 1},"${sequence.events.join(' -> ')}",${sequence.estimated_probability},${sequence.conditional_contribution}`
          : `${index + 1},"${sequence.events.join(' -> ')}",${sequence.count},${sequence.conditional_contribution},${sequence.estimated_probability}`)
    }
    const blob = new Blob([`${header}\n${rows.join('\n')}`], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'fault_tree_qualitative_results.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* #9 Folio bar doubles as the fault-tree list / hierarchy sidebar. */}
      <FolioBar api={folios} label="Tree" />

      <div className="flex flex-1 overflow-hidden">
      {/* Left analysis setup */}
      <div className="w-64 flex-shrink-0 bg-white border-r border-gray-200 p-3 flex flex-col gap-2 overflow-hidden">
        <div data-fta-node-library className="shrink-0 rounded-lg border border-slate-200 bg-slate-50 p-2">
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">Node Library</p>
            <div className="flex items-center rounded border border-slate-200 bg-white p-0.5"
              title={`Diagram density: ${DIAGRAM_DENSITY[density].label} (${densityIndex + 1} of ${DIAGRAM_DENSITY_LEVELS.length})`}>
              <button type="button" onClick={() => stepDiagramDensity(-1)}
                disabled={densityIndex === 0} aria-label="Decrease diagram label size"
                title={`Decrease diagram size and spacing from ${DIAGRAM_DENSITY[density].label}`}
                className="flex h-5 w-5 items-center justify-center rounded text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent">
                <Minus size={11} />
              </button>
              <button type="button" onClick={() => stepDiagramDensity(1)}
                disabled={densityIndex === DIAGRAM_DENSITY_LEVELS.length - 1} aria-label="Increase diagram label size"
                title={`Increase diagram size and spacing from ${DIAGRAM_DENSITY[density].label}`}
                className="flex h-5 w-5 items-center justify-center rounded text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent">
                <Plus size={11} />
              </button>
            </div>
          </div>
          <div className="relative mb-1.5">
            <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={paletteSearch} onChange={event => setPaletteSearch(event.target.value)}
              placeholder="Search all node types…"
              className="w-full rounded border border-slate-200 bg-white py-1 pl-6 pr-2 text-[9px] outline-none focus:border-blue-400" />
          </div>
          {paletteSearch.trim() ? (
            <div className="grid grid-cols-1 gap-0.5">
              {visiblePaletteGroups.flatMap(group => group.items.map(([type, label]) => (
                <button key={type} onClick={() => addNode(type)} title={`Add ${label}`}
                  className={`flex h-7 min-w-0 items-center gap-1.5 rounded border bg-white px-1.5 text-left transition-colors hover:border-blue-400 hover:bg-blue-50 ${group.color}`}>
                  <FTASymbol type={type} label={`Add ${label}`} size="palette" />
                  <span className="min-w-0 flex-1 whitespace-normal text-[9px] leading-tight">{label}</span>
                </button>
              )))}
            </div>
          ) : (
            <div className="space-y-1.5">
              <div>
                <p className="mb-0.5 text-[8px] font-semibold uppercase tracking-wide text-slate-400">Common</p>
                <div className="grid grid-cols-1 gap-0.5">
                  {visiblePaletteGroups.flatMap(group => group.items
                    .filter(([type]) => COMMON_NODE_TYPES.has(type))
                    .map(([type, label]) => (
                      <button key={type} onClick={() => addNode(type)} title={`Add ${label}`}
                        className={`flex h-7 min-w-0 items-center gap-1.5 rounded border bg-white px-1.5 text-left transition-colors hover:border-blue-400 hover:bg-blue-50 ${group.color}`}>
                        <FTASymbol type={type} label={`Add ${label}`} size="palette" />
                        <span className="min-w-0 flex-1 whitespace-normal text-[9px] leading-tight">{label}</span>
                      </button>
                    ))) }
                </div>
              </div>
              {visiblePaletteGroups.map(group => {
                const remaining = group.items.filter(([type]) => !COMMON_NODE_TYPES.has(type))
                if (!remaining.length) return null
                return <div key={group.title}>
                  <p className="mb-0.5 text-[8px] font-semibold uppercase tracking-wide text-slate-400">{group.title}</p>
                  <div className="grid grid-cols-1 gap-0.5">
                    {remaining.map(([type, label]) => (
                      <button key={type} onClick={() => addNode(type)} title={`Add ${label}`}
                        className={`flex h-7 min-w-0 items-center gap-1.5 rounded border bg-white px-1.5 text-left transition-colors hover:border-blue-400 hover:bg-blue-50 ${group.color}`}>
                        <FTASymbol type={type} label={`Add ${label}`} size="palette" />
                        <span className="min-w-0 flex-1 whitespace-normal text-[9px] leading-tight">{label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              })}
            </div>
          )}
          {visiblePaletteGroups.length === 0 && (
            <p className="py-3 text-center text-[9px] text-slate-400">No matching node types.</p>
          )}
        </div>

        {transferTargets.length > 0 && (
          <details className="shrink-0 rounded-lg border border-cyan-200 bg-cyan-50/60" data-fta-project-library>
            <summary className="flex cursor-pointer list-none items-center justify-between px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-800 marker:hidden">
              <span>Library</span>
              <span className="rounded-full bg-white px-1.5 py-0.5 text-[9px] font-medium text-cyan-700 ring-1 ring-cyan-200">
                {transferTargets.length} FTA{transferTargets.length === 1 ? '' : 's'}
              </span>
            </summary>
            <div className="max-h-36 space-y-1 overflow-y-auto border-t border-cyan-200 p-1.5">
              <p className="px-1 text-[9px] leading-tight text-cyan-700">Add another project analysis as a shared Transfer gate.</p>
              {transferTargets.map(target => (
                <button key={target.id} onClick={() => addTransferReference(target)}
                  title={`Add shared transfer to ${target.name}`}
                  className="flex min-h-8 w-full items-center gap-1.5 rounded border border-cyan-200 bg-white px-1.5 py-1 text-left text-[9px] text-cyan-900 hover:border-cyan-400 hover:bg-cyan-50">
                  <FTASymbol type="transfer" label={`Transfer to ${target.name}`} size="palette" />
                  <span className="min-w-0 flex-1 whitespace-normal leading-tight">{target.name}</span>
                </button>
              ))}
            </div>
          </details>
        )}

        {/* Node editor */}
        {selectedNode && propertiesHost && createPortal((
          <>
          <div className="p-3 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <p className="min-w-0 truncate text-xs font-medium text-gray-600">
                Edit: <span className="capitalize">{selectedNode.type}</span>
                <span className="text-gray-400 ml-1 font-normal">({selectedNode.id})</span>
              </p>
              <div className="flex shrink-0 gap-1">
                <button onClick={deleteSelected}
                  className="flex items-center gap-1 rounded border border-red-200 px-1.5 py-1 text-[10px] text-red-600 hover:bg-red-50">
                  <Trash2 size={10} /> Delete
                </button>
              </div>
            </div>
            {selectedNode.type && EVENT_NODE_TYPES.has(selectedNode.type) && selectedNode.type !== 'house'
              && (eventOccurrenceCounts.get(String(selectedNode.data.eventKey ?? selectedNode.id)) ?? 1) > 1 && (
              <div className="rounded-lg border border-violet-200 bg-violet-50 p-2.5 text-[10px] text-violet-800">
                <p className="font-semibold">Mirrored logical event · {eventOccurrenceCounts.get(String(selectedNode.data.eventKey ?? selectedNode.id))} occurrences</p>
                <p className="mt-1 leading-4">Every occurrence shares one event identity, probability/time model, and dependency definition. This preserves repeated-event dependence in exact evaluation and cut sets.</p>
                <button onClick={detachRepeatedEvent}
                  className="mt-2 rounded border border-violet-300 bg-white px-2 py-1 text-[10px] font-medium text-violet-700 hover:bg-violet-100">
                  Detach this occurrence
                </button>
              </div>
            )}
            <div>
              <label className="text-xs text-gray-500 block mb-0.5">Event / gate type</label>
              <select value={selectedNode.type ?? 'basic'}
                onChange={event => changeSelectedNodeType(event.target.value)}
                className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400">
                {NODE_PALETTE_GROUPS.map(group => (
                  <optgroup key={group.title} label={group.title}>
                    {group.items.map(([type, label]) => <option key={type} value={type}>{label}</option>)}
                  </optgroup>
                ))}
              </select>
              <p className="mt-0.5 text-[9px] leading-tight text-gray-400">Gate changes preserve child connections and reset their semantic roles. Event changes remove incompatible child connections after confirmation.</p>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-0.5">Label</label>
              <input
                value={String(selectedNode.data.label ?? '')}
                onChange={e => {
                  updateData('label', e.target.value)
                }}
                className="w-full text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <label className="text-xs text-gray-500">Diagram color</label>
                {selectedNode.data.diagramColor != null && (
                  <button onClick={() => updateData('diagramColor', undefined)}
                    className="text-[9px] font-medium text-slate-500 hover:text-blue-600">Use default</button>
                )}
              </div>
              <div className="flex flex-nowrap items-center justify-between gap-1" data-fta-node-color-palette>
                {Object.entries(ANNOTATION_PALETTE).map(([color, palette]) => (
                  <button key={color} onClick={() => updateData('diagramColor', color)}
                    title={palette.label} aria-label={`${palette.label} event or gate color`}
                    aria-pressed={String(selectedNode.data.diagramColor ?? '') === color}
                    className={`h-6 w-6 shrink-0 rounded-full border-2 transition-transform hover:scale-110 ${
                      String(selectedNode.data.diagramColor ?? '') === color
                        ? 'ring-2 ring-blue-400 ring-offset-1' : ''
                    }`}
                    style={{ backgroundColor: palette.fill, borderColor: palette.accent }} />
                ))}
              </div>
            </div>
            {selectedNode.type && !EVENT_NODE_TYPES.has(selectedNode.type) && (
              <div>
                <label className="text-xs text-gray-500 block mb-0.5">Gate ID</label>
                <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-xs font-semibold text-slate-600"
                  title="Gate IDs are assigned automatically and remain unique within this analysis">
                  {resolvedGateIds.get(selectedNode.id) ?? `${gateIdPrefix(selectedNode.type)}-1`}
                </div>
                <p className="mt-0.5 text-[9px] leading-tight text-gray-400">Assigned automatically from the gate type.</p>
              </div>
            )}
            {Boolean(selectedNode.data.sourceIncomplete) && (
              <div className="rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-[10px] leading-snug text-amber-800">
                This imported event did not contain a literal probability. Its 0 placeholder must be replaced with an appropriate probability or time model before analysis.
              </div>
            )}
            <div>
              <label className="text-xs text-gray-500 block mb-0.5">Description</label>
              <textarea
                rows={3}
                value={String(selectedNode.data.description ?? '')}
                onChange={e => updateData('description', e.target.value)}
                placeholder={'Diagram subtitle (line breaks are preserved)...'}
                className="w-full text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400 resize-y"
              />
              <p className="mt-0.5 text-[9px] leading-tight text-gray-400">Shown beneath the node label; longer text scales down automatically.</p>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-0.5">Extended Description</label>
              <textarea
                rows={4}
                value={String(selectedNode.data.extendedDescription ?? '')}
                onChange={e => updateData('extendedDescription', e.target.value)}
                placeholder="Detailed engineering notes, assumptions, rationale, or references..."
                className="w-full text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400 resize-y"
              />
              <p className="mt-0.5 text-[9px] leading-tight text-gray-400">Stored with the node for documentation; intentionally hidden from the diagram.</p>
            </div>

            {/* #9 Transfer gate target selector */}
            {selectedNode.type === 'transfer' && (
              <div>
                <label className="text-xs text-gray-500 block mb-0.5"
                  title="Reference another fault tree (folio). Its top event is substituted into this branch when analyzing.">
                  Referenced tree
                </label>
                <select
                  value={String(selectedNode.data.transferTo ?? '')}
                  onChange={e => {
                    const id = e.target.value
                    const name = transferTargets.find(t => t.id === id)?.name ?? ''
                    updateDataMulti({
                      transferTo: id || undefined,
                      transferToName: name || undefined,
                      expandReference: id ? selectedNode.data.expandReference : false,
                    })
                  }}
                  className="w-full text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
                >
                  <option value="">— select tree —</option>
                  {transferTargets.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
                {transferTargets.length === 0 && (
                  <p className="text-[10px] text-gray-400 mt-0.5">Create another tree (New) to reference it.</p>
                )}
                <label className="mt-1.5 text-[10px] text-gray-500 block">Reference identity</label>
                <select value={String(selectedNode.data.referenceMode ?? 'shared')}
                  onChange={e => updateData('referenceMode', e.target.value)}
                  className="w-full text-xs border border-gray-300 rounded px-2 py-1">
                  <option value="shared">Shared reference (same logical events)</option>
                  <option value="independent">Independent instance</option>
                </select>
                <label className={`mt-2 flex items-center justify-between rounded border px-2 py-1.5 text-xs ${
                  selectedNode.data.transferTo
                    ? 'border-cyan-200 bg-cyan-50 text-cyan-900'
                    : 'border-slate-200 bg-slate-50 text-slate-400'
                }`}>
                  <span>
                    <span className="block font-medium">Show expanded FTA</span>
                    <span className="block text-[9px] leading-tight opacity-75">Diagram view only; transfer semantics are unchanged.</span>
                  </span>
                  <input type="checkbox"
                    disabled={!selectedNode.data.transferTo}
                    checked={Boolean(selectedNode.data.expandReference)}
                    onChange={event => updateData('expandReference', event.target.checked)} />
                </label>
              </div>
            )}

            {selectedNode.type === 'house' && (
              <label className="flex items-center justify-between rounded border border-slate-200 px-2 py-1.5 text-xs text-slate-600">
                House-event state
                <input type="checkbox" checked={Boolean(selectedNode.data.state)}
                  onChange={e => updateData('state', e.target.checked)} />
              </label>
            )}

            {selectedNode.type && EVENT_NODE_TYPES.has(selectedNode.type) && selectedNode.type !== 'house' && (() => {
              const dist = String(selectedNode.data.distribution ?? '')
              const distParams = (selectedNode.data.dist_params ?? {}) as Record<string, number>
              const globalT = globalExposure.trim() === '' ? 0 : parseFloat(globalExposure) || 0
              const hasOverride = selectedNode.data.exposure_time != null
              const overrideVal = hasOverride ? Number(selectedNode.data.exposure_time) : NaN
              const effectiveT = hasOverride ? overrideVal : globalT
              const source: EventSource = selectedNode.data.ldaFolioId && String(selectedNode.data.ldaFolioId) !== ''
                ? 'lda' : (dist ? 'distribution' : 'manual')
              const computedProb = dist ? computeCDF(dist, distParams, effectiveT) : null
              return (
                <>
                  {/* #4 Source toggle */}
                  <div>
                    <label className="text-xs text-gray-500 block mb-0.5">Probability source</label>
                    <div className="grid grid-cols-3 gap-1">
                      {([
                        { v: 'manual', l: 'Manual' },
                        { v: 'distribution', l: 'Dist.' },
                        { v: 'lda', l: 'Link' },
                      ] as const).map(opt => (
                        <button
                          key={opt.v}
                          onClick={() => {
                            if (opt.v === 'manual') {
                              updateDataMulti({ distribution: undefined, dist_params: undefined,
                                ldaFolioId: undefined, ldaFolioName: undefined })
                            } else if (opt.v === 'distribution') {
                              const d = dist && DIST_PARAMS[dist] ? dist : 'weibull'
                              const defaults: Record<string, number> = {}
                              DIST_PARAMS[d].forEach(p => { defaults[p.key] = p.default })
                              const prob = computeCDF(d, defaults, effectiveT)
                              updateDataMulti({ distribution: d, dist_params: defaults,
                                ldaFolioId: undefined, ldaFolioName: undefined,
                                probability: Math.min(1, Math.max(0, prob)) })
                            } else {
                              const first = ldaFolios[0]
                              if (first) {
                                const prob = computeCDF(first.dist, first.dist_params, effectiveT)
                                updateDataMulti({
                                  ldaFolioId: first.id, ldaFolioName: first.name,
                                  distribution: first.dist, dist_params: first.dist_params,
                                  probability: Math.min(1, Math.max(0, prob)),
                                })
                              } else {
                                updateDataMulti({ ldaFolioId: '__lda__', ldaFolioName: undefined })
                              }
                            }
                          }}
                          className={`text-[10px] py-1 rounded border transition-colors ${
                            source === opt.v
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                          }`}
                        >{opt.l}</button>
                      ))}
                    </div>
                  </div>

                  {/* #4 Linked source dropdown (Life Data + Prediction) */}
                  {source === 'lda' && (
                    <div>
                      <label className="text-xs text-gray-500 block mb-0.5">Linked source (Life Data / Prediction)</label>
                      <select
                        value={String(selectedNode.data.ldaFolioId ?? '')}
                        onChange={e => {
                          const src = ldaFolios.find(f => f.id === e.target.value)
                          if (!src) { updateDataMulti({ ldaFolioId: '', ldaFolioName: undefined }); return }
                          const prob = computeCDF(src.dist, src.dist_params, effectiveT)
                          updateDataMulti({
                            ldaFolioId: src.id, ldaFolioName: `${src.name} (${src.moduleLabel})`,
                            distribution: src.dist, dist_params: src.dist_params,
                            probability: Math.min(1, Math.max(0, prob)),
                          })
                        }}
                        className="w-full text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
                      >
                        <option value="">— select source —</option>
                        {['Life Data', 'Prediction'].map(group => {
                          const items = ldaFolios.filter(f => f.moduleLabel === group)
                          if (items.length === 0) return null
                          return (
                            <optgroup key={group} label={group}>
                              {items.map(f => (
                                <option key={f.id} value={f.id}>{f.name} — {f.label}</option>
                              ))}
                            </optgroup>
                          )
                        })}
                      </select>
                      {ldaFolios.length === 0 && (
                        <p className="text-[10px] text-gray-400 mt-0.5">No fitted Life-Data or Prediction folios available.</p>
                      )}
                    </div>
                  )}

                  {/* Distribution params (manual distribution mode) */}
                  {source === 'distribution' && dist && DIST_PARAMS[dist] && (
                    <>
                      <div>
                        <label className="text-xs text-gray-500 block mb-0.5">Distribution</label>
                        <select
                          value={dist}
                          onChange={e => {
                            const d = e.target.value
                            const defaults: Record<string, number> = {}
                            DIST_PARAMS[d].forEach(p => { defaults[p.key] = p.default })
                            const prob = computeCDF(d, defaults, effectiveT)
                            updateDataMulti({ distribution: d, dist_params: defaults, probability: Math.min(1, Math.max(0, prob)) })
                          }}
                          className="w-full text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
                        >
                          {DIST_OPTIONS.filter(o => o.value).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </div>
                      {DIST_PARAMS[dist].map(p => (
                        <div key={p.key}>
                          <label className="text-xs text-gray-500 block mb-0.5">{p.label}</label>
                          <NumberField
                            value={distParams[p.key] ?? p.default}
                            onChange={v => {
                              const newParams = { ...distParams, [p.key]: parseFloat(v) || 0 }
                              const prob = computeCDF(dist, newParams, effectiveT)
                              updateDataMulti({ dist_params: newParams, probability: Math.min(1, Math.max(0, prob)) })
                            }}
                            className="w-full"
                          />
                        </div>
                      ))}
                    </>
                  )}

                  {/* Exposure-time override (any distribution-driven source) */}
                  {(source === 'distribution' || source === 'lda') && dist && DIST_PARAMS[dist] && (
                    <>
                      <div>
                        <label className="text-xs text-gray-500 block mb-0.5">
                          Exposure time (τ) <span className="text-gray-400">— blank = global</span>
                        </label>
                        <NumberField
                          value={hasOverride ? overrideVal : ''}
                          min={0}
                          placeholder={`Global: ${globalT}`}
                          onChange={v => {
                            if (v.trim() === '') {
                              const prob = computeCDF(dist, distParams, globalT)
                              updateDataMulti({ exposure_time: undefined, probability: Math.min(1, Math.max(0, prob)) })
                            } else {
                              const t = parseFloat(v) || 0
                              const prob = computeCDF(dist, distParams, t)
                              updateDataMulti({ exposure_time: t, probability: Math.min(1, Math.max(0, prob)) })
                            }
                          }}
                          className="w-full"
                        />
                        <p className="text-[10px] text-gray-400 mt-0.5">
                          {hasOverride
                            ? `Effective exposure τ = ${overrideVal} at global mission t = ${globalT}; the event clock scales linearly.`
                            : `Using global t = ${globalT}`}
                        </p>
                      </div>
                      <div className="bg-blue-50 rounded px-2 py-1.5">
                        <span className="text-[10px] text-gray-500">Computed probability @ τ={effectiveT}: </span>
                        <span className="text-xs font-mono font-semibold text-blue-700">
                          {computedProb != null ? computedProb.toExponential(4) : '—'}
                        </span>
                      </div>
                    </>
                  )}

                  {/* Manual probability */}
                  {source === 'manual' && (
                    <div className="space-y-1.5">
                      <div>
                        <label className="text-xs text-gray-500 block mb-0.5"
                          title="Probability (0–1) that this event occurs by the mission time.">
                          Mission probability
                        </label>
                        <NumberField
                          value={String(selectedNode.data.probability ?? 0.01)}
                          min={0} max={1} step={0.001}
                          onChange={v => updateData('probability', parseFloat(v))}
                          className="w-full"
                        />
                      </div>
                      <button type="button"
                        disabled={!(globalT > 0) || !(Number(selectedNode.data.probability ?? 0) < 1)}
                        onClick={() => {
                          const probability = Number(selectedNode.data.probability ?? 0)
                          const rate = probability <= 0 ? Number.MIN_VALUE
                            : -Math.log1p(-probability) / globalT
                          updateDataMulti({
                            distribution: 'exponential',
                            dist_params: { lambda: rate, gamma: 0 },
                            derivedTimeModel: true,
                            derivedTimeModelAssumption: `Constant hazard derived from p=${probability} at t=${globalT}.`,
                          })
                        }}
                        className="w-full rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[10px] font-medium text-amber-800 disabled:opacity-40">
                        Convert explicitly to constant hazard
                      </button>
                      <p className="text-[9px] leading-tight text-slate-400">Dynamic gates require a time model. Conversion uses λ = −ln(1−p)/t and records that assumption.</p>
                    </div>
                  )}

                  <div className="border-t border-gray-100 pt-2 mt-1">
                    <label className="text-xs text-gray-500 block mb-0.5">Dependency model</label>
                    <select
                      value={String(selectedNode.data.ccf_group ?? '') ? 'beta_factor' : 'independent'}
                      onChange={e => updateRepeatedEventData(e.target.value === 'beta_factor'
                        ? { ccf_group: 'CCF-1', ccf_beta: 0.1 }
                        : { ccf_group: undefined, ccf_beta: undefined })}
                      className="w-full text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
                    >
                      <option value="independent">Independent</option>
                      <option value="beta_factor">Beta-factor common cause</option>
                    </select>
                    {String(selectedNode.data.ccf_group ?? '') && (
                      <div className="mt-1.5 space-y-1.5">
                        <div>
                          <label className="text-[10px] text-gray-500 block">Common-cause group</label>
                          <input
                            value={String(selectedNode.data.ccf_group ?? '')}
                            onChange={e => updateRepeatedEventData({ ccf_group: e.target.value })}
                            className="w-full text-xs border border-gray-300 rounded px-2 py-1"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-gray-500 block">Beta (0–1)</label>
                          <NumberField
                            value={String(selectedNode.data.ccf_beta ?? 0.1)}
                            min={0} max={1} step={0.01}
                            onChange={v => updateRepeatedEventData({ ccf_beta: parseFloat(v) })}
                            className="w-full"
                          />
                        </div>
                        <p className="text-[10px] leading-tight text-amber-600">
                          Group members must use equal marginal probabilities. One shared shock affects every member; partial-group MGL effects are not included.
                        </p>
                      </div>
                    )}
                  </div>
                </>
              )
            })()}
            {selectedNode.type === 'vote' && (
              <div>
                <label className="text-xs text-gray-500 block mb-0.5">k (votes required)</label>
                <NumberField
                  value={String(selectedNode.data.k ?? 2)}
                  min={1} step={1}
                  onChange={v => updateData('k', parseInt(v) || 1)}
                  className="w-full"
                />
              </div>
            )}
            {selectedNode.type === 'cardinality' && (
              <div className="grid grid-cols-2 gap-1.5">
                <div><label className="text-[10px] text-gray-500">Minimum L</label>
                  <NumberField value={String(selectedNode.data.min ?? 1)} min={0} step={1}
                    onChange={v => updateData('min', parseInt(v) || 0)} className="w-full" /></div>
                <div><label className="text-[10px] text-gray-500">Maximum H</label>
                  <NumberField value={String(selectedNode.data.max ?? 2)} min={0} step={1}
                    onChange={v => updateData('max', parseInt(v) || 0)} className="w-full" /></div>
              </div>
            )}
            {selectedNode.type && ['pand', 'por'].includes(selectedNode.type) && (
              <div>
                <label className="text-xs text-gray-500 block mb-0.5">Simultaneous-event policy</label>
                <select value={String(selectedNode.data.tie_policy ?? 'inclusive')}
                  onChange={e => updateData('tie_policy', e.target.value)}
                  className="w-full text-xs border border-gray-300 rounded px-2 py-1">
                  <option value="inclusive">Inclusive (ties satisfy order)</option>
                  <option value="exclusive">Exclusive (strict order)</option>
                </select>
              </div>
            )}
            {selectedNode.type === 'spare' && (
              <div className="space-y-1.5 rounded border border-teal-100 bg-teal-50/50 p-2">
                <div><label className="text-[10px] text-gray-500 block">Standby mode</label>
                  <select value={String(selectedNode.data.spare_mode ?? 'cold')}
                    onChange={e => {
                      const mode = e.target.value
                      updateDataMulti({ spare_mode: mode, dormancy_factor: mode === 'cold' ? 0 : mode === 'hot' ? 1 : 0.5 })
                    }} className="w-full text-xs border border-gray-300 rounded px-2 py-1">
                    <option value="cold">Cold</option><option value="warm">Warm</option><option value="hot">Hot</option>
                  </select></div>
                <div><label className="text-[10px] text-gray-500 block">Dormancy factor (0–1)</label>
                  <NumberField value={String(selectedNode.data.dormancy_factor ?? 0)} min={0} max={1} step={0.05}
                    onChange={v => updateData('dormancy_factor', parseFloat(v))} className="w-full" /></div>
                <div><label className="text-[10px] text-gray-500 block">Activation coverage (0–1)</label>
                  <NumberField value={String(selectedNode.data.coverage ?? 1)} min={0} max={1} step={0.01}
                    onChange={v => updateData('coverage', parseFloat(v))} className="w-full" /></div>
              </div>
            )}

            {selectedNode.type && !EVENT_NODE_TYPES.has(selectedNode.type) && orderedInputsFor(selectedNode.id).length > 0 && (
              <div className="rounded border border-slate-200 bg-slate-50 p-2">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Inputs and semantic order</p>
                <div className="space-y-1">
                  {orderedInputsFor(selectedNode.id).map((edge, index, ordered) => {
                    const child = nodes.find(node => node.id === edge.target)
                    const role = String((edge.data as { role?: string } | undefined)?.role ?? defaultInputRole(selectedNode.type ?? '', index))
                    const roles = selectedNode.type === 'fdep' ? ['trigger', 'dependent']
                      : selectedNode.type === 'inhibit' ? ['primary', 'condition']
                        : selectedNode.type === 'imply' ? ['antecedent', 'consequent']
                          : selectedNode.type === 'por' ? ['priority', 'blocker']
                            : selectedNode.type === 'spare' ? ['primary', 'spare'] : null
                    return <div key={edge.id} draggable
                      onDragStart={event => {
                        setDraggedInputEdgeId(edge.id)
                        event.dataTransfer.effectAllowed = 'move'
                        event.dataTransfer.setData('text/plain', edge.id)
                      }}
                      onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move' }}
                      onDrop={event => { event.preventDefault(); dropInputAt(selectedNode.id, edge.id) }}
                      onDragEnd={() => setDraggedInputEdgeId(null)}
                      className={`flex cursor-grab items-center gap-1 rounded border px-1.5 py-1 text-[10px] active:cursor-grabbing ${
                        draggedInputEdgeId === edge.id
                          ? 'border-blue-300 bg-blue-50 opacity-60'
                          : 'border-transparent bg-white hover:border-slate-200'
                      }`}>
                      <GripVertical size={11} className="shrink-0 text-slate-400" aria-hidden />
                      <span className="w-4 text-center font-mono font-semibold text-slate-500">{index + 1}</span>
                      <span className="min-w-0 flex-1 truncate text-slate-700" title={String(child?.data.label ?? edge.target)}>{String(child?.data.label ?? edge.target)}</span>
                      {roles && <select value={role} onChange={e => setInputRole(selectedNode.id, edge.id, e.target.value)}
                        className="max-w-20 rounded border border-slate-200 px-1 py-0.5 text-[9px]">
                        {roles.map(value => <option key={value} value={value}>{value}</option>)}
                      </select>}
                      <button disabled={index === 0} onClick={() => moveInput(selectedNode.id, edge.id, -1)} className="text-slate-500 disabled:opacity-20"><ChevronUp size={12} /></button>
                      <button disabled={index === ordered.length - 1} onClick={() => moveInput(selectedNode.id, edge.id, 1)} className="text-slate-500 disabled:opacity-20"><ChevronDown size={12} /></button>
                    </div>
                  })}
                </div>
                <p className="mt-1 text-[9px] leading-tight text-slate-400">Drag inputs to reorder them, or use the arrow buttons. Order and semantic roles are stored on each connection and are unchanged by Auto Layout.</p>
              </div>
            )}

            {selectedNode.data.eventKey != null && selectedNode.type && EVENT_NODE_TYPES.has(selectedNode.type) && selectedNode.type !== 'house' && (
              <p className="text-[10px] text-gray-400">
                Event key: <span className="font-mono">{String(selectedNode.data.eventKey)}</span>
                {selectedNode.data.mirror ? ' (repeated)' : ''}
              </p>
            )}
            {selectedNode.data.linkedTo != null && (
              <p className="text-[10px] text-gray-400">
                Linked to library: {String(selectedNode.data.linkedTo)}
              </p>
            )}
          </div>

        <div className="border-t border-slate-200 p-3">
        <LibraryPanel
          mode="probability"
          selectedLabel={selectedNode?.type && EVENT_NODE_TYPES.has(selectedNode.type) && selectedNode.type !== 'house'
            ? String(selectedNode.data.label ?? selectedNode.id) : null}
          onApply={(item: LibraryItem, value: number) => {
            if (!selectedNode) return
            const probability = Math.round(value * 1e8) / 1e8
            setNodes(nds => nds.map(n => n.id === selectedNode.id
              ? { ...n, data: { ...n.data, probability, linkedTo: item.name } } : n))
            setSelectedNode(prev => prev
              ? { ...prev, data: { ...prev.data, probability, linkedTo: item.name } } : null)
          }}
        />
        </div>
          </>
        ), propertiesHost)}

        <div className="z-20 mt-auto shrink-0 border-t border-slate-200 bg-white pt-2 shadow-[0_-8px_16px_-14px_rgba(15,23,42,0.45)]">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Analysis Setup</p>
          <label className="mb-1.5 flex items-center justify-between rounded border border-slate-200 px-2 py-1 text-[10px] text-slate-600">
            Show event/gate IDs on diagram
            <input type="checkbox" checked={showNodeIds}
              onChange={event => setShowNodeIds(event.target.checked)} />
          </label>
          <div className="mb-2 border-t border-gray-100 pt-2">
            <label className="text-[11px] font-medium text-gray-600 block mb-0.5">
              Global exposure time (t)
            </label>
            <NumberField
              value={globalExposure}
              min={0}
              onChange={v => setGlobalExposure(v)}
              className="w-full"
              placeholder="e.g. 1000"
            />
            <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">
              Distribution-based events use this time unless they set their own τ override.
            </p>
          </div>

          <div className="mb-2 border-t border-gray-100 pt-2">
            <label className="text-[11px] font-medium text-gray-600 block mb-1">Evaluation engine</label>
            <div className="grid grid-cols-3 gap-1">
              {ENGINE_OPTIONS.map(option => (
                <label key={option.id} title={option.help}
                  className={`cursor-pointer rounded border px-1 py-1 text-center text-[9px] font-medium ${
                    engine === option.id
                      ? 'border-blue-400 bg-blue-50 text-blue-700'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}>
                  <input
                    type="radio"
                    name="fta-engine"
                    checked={engine === option.id}
                    onChange={() => setEngine(option.id)}
                    className="sr-only"
                  />
                  {option.label}
                </label>
              ))}
            </div>
            <p className="mt-1 line-clamp-2 text-[9px] leading-tight text-slate-400">
              {ENGINE_OPTIONS.find(option => option.id === engine)?.help}
            </p>
            {engine === 'simulation' && <details className="mt-1.5 rounded border border-slate-200 bg-slate-50">
              <summary className="cursor-pointer px-2 py-1 text-[10px] font-medium text-slate-600">Simulation and confidence settings</summary>
              <div className="space-y-1.5 border-t border-slate-200 p-2">
                <div>
                  <label className="text-[10px] text-gray-500 block mb-0.5">Number of simulations</label>
                  <NumberField
                    value={nSimulations}
                    min={1000} max={10000000} step={1000}
                    onChange={v => setNSimulations(v)}
                    className="w-full"
                    placeholder="20000"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500 block mb-0.5">Random seed (blank = random)</label>
                  <input
                    type="number"
                    value={simSeed}
                    onChange={e => setSimSeed(e.target.value)}
                    placeholder="e.g. 42"
                    className="w-full text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500 block mb-0.5">Confidence level (%)</label>
                  <input type="text" inputMode="decimal" value={confidenceLevel}
                    onChange={e => setConfidenceLevel(e.target.value)}
                    className="w-full text-xs border border-gray-300 rounded px-2 py-1" />
                </div>
              </div>
            </details>}
          </div>

          {error && <p className="text-xs text-red-600 bg-red-50 p-2 rounded mb-2">{error}</p>}
          {showValidationIssues && validation?.valid === false && (
            <div role="alert" className="mb-2 rounded border border-rose-300 bg-rose-50 p-2 text-[10px] text-rose-800">
              <div className="mb-1 flex items-center justify-between gap-2">
                <p className="font-semibold">Analysis blocked · resolve {validation.issues.length} model issue{validation.issues.length === 1 ? '' : 's'}</p>
                <button onClick={() => setShowValidationIssues(false)} aria-label="Dismiss model issues"
                  className="shrink-0 rounded p-0.5 hover:bg-rose-100"><X size={11} /></button>
              </div>
              <ul className="max-h-28 list-disc space-y-1 overflow-y-auto pl-4">
                {validation.issues.map((issue, index) => (
                  <li key={`${issue.code}-${issue.node_id ?? ''}-${index}`}>{issue.message}</li>
                ))}
              </ul>
            </div>
          )}
          {loading && progress && (
            <div className="mb-2" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
              <div className="h-1.5 overflow-hidden rounded-full bg-slate-200"><div className="h-full bg-blue-600 transition-all" style={{ width: `${100 * progress.done / Math.max(1, progress.total)}%` }} /></div>
              <p className="mt-0.5 text-center text-[9px] text-slate-500">Chronological trials {progress.done.toLocaleString()} / {progress.total.toLocaleString()}</p>
            </div>
          )}
          <div className="flex gap-1.5">
            <button onClick={analyze} disabled={loading}
              title={validation?.valid === false ? 'Show the model issues blocking analysis.' : undefined}
              className="flex flex-1 items-center justify-center gap-2 rounded bg-blue-600 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50">
              <Play size={12} /> {loading ? 'Analyzing…' : 'Analyze Fault Tree'}
            </button>
            {loading && <button onClick={() => abortRef.current?.abort()} title="Cancel analysis"
              className="flex w-9 items-center justify-center rounded border border-slate-300 text-slate-600 hover:bg-slate-50"><X size={14} /></button>}
          </div>
        </div>
      </div>

      {/* Canvas */}
      <CanvasErrorBoundary onReset={autoLayout}>
        <div className="flex-1 relative" ref={flowWrapperRef}>
          <div className="absolute left-3 top-3 z-10 flex flex-nowrap items-center gap-1 rounded-lg bg-white/90 p-1 shadow-sm backdrop-blur" data-export-ignore>
            <button onClick={autoLayout}
              className="flex h-8 items-center gap-1 whitespace-nowrap rounded border border-slate-300 bg-white px-2 text-[10px] font-medium text-slate-700 hover:bg-slate-50"
              title="Arrange the tree into readable levels">
              <LayoutGrid size={12} /> Auto Layout
            </button>
            <button onClick={copyNode} disabled={selectedNodeIds.length === 0 && !selectedNode}
              className="flex h-8 items-center gap-1 rounded border border-slate-300 bg-white px-2 text-[10px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-35"
              title="Copy all selected nodes and the connections between them">
              <Copy size={12} /> Copy{selectedNodeIds.length > 1 ? ` (${selectedNodeIds.length})` : ''}
            </button>
            <button onClick={cutNode} disabled={selectedNodeIds.length === 0 && !selectedNode}
              className="flex h-8 items-center gap-1 rounded border border-slate-300 bg-white px-2 text-[10px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-35"
              title="Cut all selected nodes and their attached connections">
              <Scissors size={12} /> Cut{selectedNodeIds.length > 1 ? ` (${selectedNodeIds.length})` : ''}
            </button>
            <button onClick={pasteAsCopy} disabled={!clipboard}
              className="flex h-8 items-center gap-1 rounded border border-slate-300 bg-white px-2 text-[10px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-35"
              title="Paste independent copies, retaining connections within a copied group">
              <Clipboard size={12} /> Paste
            </button>
            <button onClick={pasteAsMirror}
              disabled={!clipboard || clipboard.nodes.length !== 1
                || !EVENT_NODE_TYPES.has(clipboard.nodes[0]?.type ?? '')
                || clipboard.nodes[0]?.type === 'house'}
              className="flex h-8 items-center gap-1 rounded border border-amber-300 bg-white px-2 text-[10px] font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-35"
              title="Add a repeated reference to the same logical event">
              <GitFork size={12} /> Mirror
            </button>
            <details className="group relative">
              <summary className="flex h-8 cursor-pointer list-none items-center gap-1 rounded border border-amber-300 bg-white px-2 text-[10px] font-medium text-amber-800 hover:bg-amber-50 marker:hidden"
                title="Add a diagram note or a callout attached to the selected item">
                <MessageSquarePlus size={12} /> Annotate
              </summary>
              <div className="absolute left-0 top-9 z-30 w-44 space-y-1 rounded-lg border border-slate-200 bg-white p-1.5 shadow-lg">
                <button onClick={() => addDiagramAnnotation()}
                  className="w-full rounded px-2 py-1.5 text-left text-[10px] text-slate-700 hover:bg-slate-50">
                  Add text note
                </button>
                <button disabled={!selectedNode} onClick={() => selectedNode && addDiagramAnnotation(selectedNode.id)}
                  className="w-full rounded px-2 py-1.5 text-left text-[10px] text-slate-700 hover:bg-slate-50 disabled:opacity-35">
                  Call out selected item
                </button>
              </div>
            </details>
            <label className="flex h-8 items-center gap-1 rounded border border-slate-300 bg-white px-2 text-[10px] text-slate-500" title="Connection line style">
              Connectors
              <select value={connectorStyle}
                onChange={event => setConnectorStyle(event.target.value as 'smoothstep' | 'bezier' | 'straight')}
                className="bg-transparent font-medium text-slate-700 outline-none">
                <option value="smoothstep">Orthogonal</option>
                <option value="bezier">Curved</option>
                <option value="straight">Straight</option>
              </select>
            </label>
            <button onClick={() => setSnapToGrid(enabled => !enabled)} aria-pressed={snapToGrid}
              className={`flex h-8 items-center gap-1 whitespace-nowrap rounded border px-2 text-[10px] font-medium ${
                snapToGrid
                  ? 'border-blue-400 bg-blue-50 text-blue-700'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
              title="Snap moved nodes to the 20-unit diagram grid">
              <LayoutGrid size={12} /> Snap
            </button>
          </div>
          {/* Diagram interchange and export actions stay with the diagram. */}
          <div className="absolute top-3 right-3 z-10 flex items-center gap-1 rounded-lg bg-white/90 p-1 shadow-sm backdrop-blur" data-export-ignore>
            <input ref={openPSAInputRef} type="file" accept=".xml,application/xml,text/xml"
              className="hidden" onChange={event => {
                const file = event.target.files?.[0]
                if (file) void importOpenPSA(file)
                event.target.value = ''
              }} />
            <button onClick={() => openPSAInputRef.current?.click()}
              className="flex h-8 items-center gap-1 rounded border border-slate-300 bg-white px-2 text-[10px] font-medium text-slate-700 hover:bg-slate-50"
              title="Import a static OpenPSA Model Exchange Format XML file">
              <Upload size={12} /> OpenPSA
            </button>
            <button onClick={() => void exportOpenPSA()}
              className="flex h-8 items-center gap-1 rounded border border-slate-300 bg-white px-2 text-[10px] font-medium text-slate-700 hover:bg-slate-50"
              title="Export this static tree as OpenPSA Model Exchange Format XML">
              <FileDown size={12} /> OpenPSA
            </button>
            <ExportDiagramButton getElement={() => flowWrapperRef.current} baseName="fault-tree"
              prepareExport={() => fitReactFlowForExport(flowInstanceRef.current)}
              buttonClassName="flex h-8 items-center gap-1 rounded border border-slate-300 bg-white px-2 text-[10px] font-medium text-slate-700 hover:bg-slate-50" />
          </div>
          {openPSANotices.length > 0 && (
            <details className="absolute right-3 top-14 z-10 max-w-sm rounded border border-amber-200 bg-amber-50/95 text-[10px] text-amber-800 shadow-sm backdrop-blur" data-export-ignore>
              <summary className="cursor-pointer px-2 py-1 font-medium">OpenPSA notes ({openPSANotices.length})</summary>
              <ul className="max-h-36 space-y-1 overflow-y-auto border-t border-amber-200 px-4 py-2">
                {openPSANotices.map((notice, index) => <li key={`${notice.code}-${index}`}>{notice.message}</li>)}
              </ul>
            </details>
          )}
          {result && (
            <div className="absolute top-14 left-1/2 -translate-x-1/2 z-10 bg-white/90 backdrop-blur border border-red-200 rounded-lg shadow-lg px-4 py-2 flex items-center gap-3" data-export-ignore>
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Top Event</span>
              <span className="text-lg font-bold text-red-600">{result.top_event_probability.toExponential(4)}</span>
            </div>
          )}
          {validation && (
            <details data-export-ignore className={`absolute bottom-3 left-1/2 z-10 max-w-[36rem] -translate-x-1/2 rounded-lg border bg-white/95 text-[10px] shadow-md backdrop-blur ${
              validation.valid ? 'border-emerald-300 text-emerald-800' : 'border-rose-300 text-rose-800'
            }`}>
              <summary className="cursor-pointer select-none px-3 py-1.5 font-semibold">
                {validation.valid
                  ? `Model valid · ${String(validation.analysis_kind ?? '').replace(/_/g, ' ')}`
                  : `${validation.issues.length} model issue${validation.issues.length === 1 ? '' : 's'} · expand for details`}
              </summary>
              {validation.issues.length > 0 && (
                <ul className="max-h-32 space-y-1 overflow-y-auto border-t border-current/10 px-5 py-2">
                  {validation.issues.map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.message}</li>)}
                </ul>
              )}
            </details>
          )}
          <ReactFlow<Node, Edge>
            nodes={displayNodes}
            edges={displayEdges}
            onNodesChange={onNodesChangeWrapped}
            onEdgesChange={onDiagramEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onSelectionChange={onSelectionChange}
            onPaneClick={onPaneClick}
            onInit={instance => { flowInstanceRef.current = instance }}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.25, minZoom: 0.55, maxZoom: 1.2 }}
            minZoom={0.35}
            maxZoom={2.5}
            snapToGrid={snapToGrid}
            snapGrid={[20, 20]}
            multiSelectionKeyCode={['Shift', 'Control', 'Meta']}
            deleteKeyCode="Delete"
          >
            {snapToGrid && (
              <Background variant={BackgroundVariant.Dots} color="#cbd5e1" gap={20} size={1.15} />
            )}
            <Controls />
            <MiniMap pannable zoomable nodeColor={node => {
              if (node.type === 'annotation') {
                return (ANNOTATION_PALETTE[String(node.data.color ?? 'amber')]
                  ?? ANNOTATION_PALETTE.amber).accent
              }
              const custom = node.data.diagramColor
                ? ANNOTATION_PALETTE[String(node.data.diagramColor)] : undefined
              if (custom) return custom.accent
              return EVENT_NODE_TYPES.has(node.type ?? '')
                ? '#334155' : (NODE_ACCENTS[node.type ?? '']?.border ?? '#334155')
            }} />
          </ReactFlow>
        </div>
      </CanvasErrorBoundary>

      {/* Existing-item properties and analysis results share the right pane. */}
      {(result || selectedNode || selectedAnnotation) && (
        <div ref={resultsRef} className="w-[30rem] flex-shrink-0 bg-white border-l border-gray-200 flex flex-col overflow-hidden">
          <div className="grid grid-cols-2 gap-1 border-b border-slate-200 bg-slate-50 p-2">
            <button
              disabled={!selectedNode && !selectedAnnotation}
              onClick={() => setRightPaneMode('properties')}
              className={`rounded px-2 py-1.5 text-xs font-semibold transition-colors disabled:opacity-35 ${
                (selectedNode || selectedAnnotation) && (rightPaneMode === 'properties' || !result)
                  ? 'bg-white text-blue-700 shadow-sm ring-1 ring-slate-200'
                  : 'text-slate-500 hover:bg-white/70'
              }`}
            >Properties{selectedNode
                ? ` · ${String(selectedNode.data.label ?? selectedNode.id)}`
                : selectedAnnotation ? ' · Annotation' : ''}</button>
            <button
              disabled={!result}
              onClick={() => setRightPaneMode('results')}
              className={`rounded px-2 py-1.5 text-xs font-semibold transition-colors disabled:opacity-35 ${
                result && rightPaneMode === 'results'
                  ? 'bg-white text-blue-700 shadow-sm ring-1 ring-slate-200'
                  : 'text-slate-500 hover:bg-white/70'
              }`}
            >Analysis Results</button>
          </div>

          {selectedNode && (rightPaneMode === 'properties' || !result) && (
            <div ref={setPropertiesHost} className="flex-1 overflow-y-auto" data-fta-properties-pane />
          )}

          {selectedAnnotation && (rightPaneMode === 'properties' || !result) && (
            <div className="flex-1 space-y-3 overflow-y-auto p-3" data-fta-annotation-properties>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold text-slate-700">Diagram annotation</p>
                  <p className="font-mono text-[9px] text-slate-400">{selectedAnnotation.id}</p>
                </div>
                <button onClick={deleteSelectedAnnotation}
                  className="flex items-center gap-1 rounded border border-rose-200 px-2 py-1 text-[10px] text-rose-700 hover:bg-rose-50">
                  <Trash2 size={10} /> Delete
                </button>
              </div>
              <div>
                <label className="mb-0.5 block text-xs text-slate-500">Text</label>
                <textarea rows={6} value={String(selectedAnnotation.data.text ?? '')}
                  onChange={event => updateSelectedAnnotation({ text: event.target.value })}
                  className="w-full resize-y rounded border border-slate-300 px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-blue-400" />
              </div>
              <div>
                <label className="mb-0.5 block text-xs text-slate-500">Callout target</label>
                <select value={String(selectedAnnotation.data.targetId ?? '')}
                  onChange={event => updateSelectedAnnotation({ targetId: event.target.value || undefined })}
                  className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs">
                  <option value="">None — text note</option>
                  {nodes.map(node => (
                    <option key={node.id} value={node.id}>
                      {String(node.data.label ?? node.id)} · {EVENT_NODE_TYPES.has(node.type ?? '')
                        ? String(node.data.eventKey ?? node.id)
                        : String(resolvedGateIds.get(node.id) ?? node.id)}
                    </option>
                  ))}
                </select>
                <p className="mt-0.5 text-[9px] leading-tight text-slate-400">A callout uses a dashed leader and remains separate from fault-tree logic.</p>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">Shape</label>
                <div className="grid grid-cols-2 gap-1">
                  {Object.entries(ANNOTATION_SHAPES).map(([shape, option]) => (
                    <button key={shape} onClick={() => updateSelectedAnnotation({ shape })}
                      aria-pressed={String(selectedAnnotation.data.shape ?? 'rounded') === shape}
                      className={`flex items-center gap-2 rounded border px-2 py-1.5 text-[10px] text-slate-600 ${
                        String(selectedAnnotation.data.shape ?? 'rounded') === shape
                          ? 'border-blue-400 bg-blue-50 text-blue-700 ring-1 ring-blue-200'
                          : 'border-slate-200 bg-white hover:bg-slate-50'
                      }`}>
                      <span className={`h-4 w-7 border border-current bg-white ${option.preview}`} aria-hidden />
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">Color</label>
                <div className="flex flex-nowrap items-center justify-between gap-1" data-fta-annotation-color-palette>
                  {Object.entries(ANNOTATION_PALETTE).map(([color, palette]) => (
                    <button key={color} onClick={() => updateSelectedAnnotation({ color })}
                      title={palette.label} aria-label={`${palette.label} annotation color`}
                      aria-pressed={String(selectedAnnotation.data.color ?? 'amber') === color}
                      className={`h-6 w-6 shrink-0 rounded-full border-2 transition-transform hover:scale-110 ${
                        String(selectedAnnotation.data.color ?? 'amber') === color
                          ? 'ring-2 ring-blue-400 ring-offset-1' : ''
                      }`}
                      style={{ backgroundColor: palette.fill, borderColor: palette.accent }} />
                  ))}
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">Fill opacity</label>
                <div className="grid grid-cols-4 gap-1 rounded border border-slate-200 bg-slate-50 p-1">
                  {ANNOTATION_OPACITIES.map(opacity => (
                    <button key={opacity} onClick={() => updateSelectedAnnotation({ fillOpacity: opacity })}
                      aria-pressed={Number(selectedAnnotation.data.fillOpacity ?? 100) === opacity}
                      className={`rounded px-1 py-1 text-[10px] font-medium ${
                        Number(selectedAnnotation.data.fillOpacity ?? 100) === opacity
                          ? 'bg-slate-700 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'
                      }`}>
                      {opacity}%
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {result && rightPaneMode === 'results' && <>
          <div className="p-3 border-b border-gray-100">
            <p className="text-xs text-gray-500">Top Event Probability</p>
            <p className="text-2xl font-bold text-red-600">
              {result.top_event_probability.toExponential(4)}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
              <span className={`rounded-full px-2 py-0.5 font-semibold ${result.analysis_kind === 'dynamic' ? 'bg-teal-100 text-teal-800' : result.analysis_kind === 'static_noncoherent' ? 'bg-rose-100 text-rose-800' : 'bg-indigo-100 text-indigo-800'}`}>
                {result.analysis_kind === 'dynamic' ? 'Dynamic event-time model' : result.analysis_kind === 'static_noncoherent' ? 'Static non-coherent' : 'Static coherent'}
              </span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">
                {String((result.computation?.engine as { engine?: string } | undefined)?.engine ?? result.computation?.exact_engine?.engine ?? 'solver').replace(/_/g, ' ')}
              </span>
            </div>
            {result.simulation && <p className="mt-1 font-mono text-[10px] text-blue-700">
              {((result.simulation.confidence_level ?? 0.95) * 100).toFixed(1)}% CI [{result.simulation.ci_lower.toExponential(3)}, {result.simulation.ci_upper.toExponential(3)}]
            </p>}
            {result.dependency_model && (
              <div className={`mt-2 rounded px-2 py-1.5 text-[10px] leading-snug ${
                result.dependency_model.model === 'beta_factor'
                  ? 'bg-amber-50 text-amber-800 border border-amber-200'
                  : 'bg-gray-50 text-gray-500 border border-gray-200'
              }`}>
                <span className="font-semibold">
                  {result.dependency_model.model === 'beta_factor' ? 'Beta-factor CCF' : 'Independent events'}
                </span>
                {' · '}{result.dependency_model.assumption}
                {result.computation?.exact_engine && (
                  <span className="block mt-0.5">
                    Exact ROBDD: {(result.computation.exact_engine.states_evaluated ?? result.computation.exact_engine.nodes_reachable ?? 0).toLocaleString()} nodes
                  </span>
                )}
              </div>
            )}
            {(result.diagnostics ?? []).map(item => (
              <div key={item.code} className={`mt-1.5 flex gap-1.5 rounded border px-2 py-1 text-[10px] ${item.severity === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-blue-100 bg-blue-50 text-blue-700'}`}>
                <AlertTriangle size={11} className="mt-0.5 shrink-0" /><span>{item.message}</span>
              </div>
            ))}
          </div>

          <div className="flex border-b border-gray-100 text-[10px]">
            {([
              { id: 'qualitative', label: result.analysis_kind === 'dynamic' ? `Sequences (${result.cut_sequences?.length ?? 0})` : result.analysis_kind === 'static_noncoherent' ? `Conditions (${result.failure_conditions?.length ?? 0})` : `MCS (${result.minimal_cut_sets.length})` },
              { id: 'curve', label: 'Time curve' },
              { id: 'nodes', label: 'Nodes' },
              { id: 'importance', label: 'Importance' },
              { id: 'methods', label: 'Methods' },
              { id: 'formulas', label: 'Formulas' },
            ] as const).filter(t => t.id !== 'curve' || Boolean(result.time_curve?.length)).map(t => (
              <button
                key={t.id}
                onClick={() => setResultTab(t.id)}
                className={`flex-1 py-2 font-medium border-b-2 transition-colors ${
                  resultTab === t.id ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500'
                }`}
              >{t.label}</button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {resultTab === 'qualitative' && result.analysis_kind === 'static_coherent' && (
              <div className="flex flex-col gap-1">
                <p className="text-[10px] text-gray-400 mb-1">Click a cut set to highlight its events and animated propagation paths on the diagram.</p>
                {result.minimal_cut_sets.map((mcs, i) => (
                  <button
                    key={i}
                    onClick={() => setActiveMCS(prev => prev === i ? null : i)}
                    className={`text-xs rounded px-2 py-1.5 text-left transition-colors ${
                      activeMCS === i
                        ? 'bg-amber-100 ring-1 ring-amber-400 text-amber-900'
                        : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    <span className={`mr-1 ${activeMCS === i ? 'text-amber-500' : 'text-gray-400'}`}>#{i + 1}</span>
                    {mcs.join(', ')}
                  </button>
                ))}
              </div>
            )}

            {resultTab === 'qualitative' && result.analysis_kind === 'static_noncoherent' && (
              <div className="space-y-1.5">
                <p className="text-[10px] text-slate-500">Disjoint ROBDD failure conditions retain both failed and successful literals because complement logic is non-coherent.</p>
                {(result.failure_conditions ?? []).map((condition, index) => (
                  <button key={index} onClick={() => setActiveMCS(previous => previous === index ? null : index)}
                    className={`w-full rounded border px-2 py-1.5 text-left text-[11px] ${activeMCS === index ? 'border-amber-400 bg-amber-50' : 'border-slate-200 bg-slate-50'}`}>
                    <span className="font-semibold text-slate-500">#{index + 1}</span>
                    <span className="ml-1 text-rose-700">Failed: {condition.required_failed.join(', ') || 'none'}</span>
                    <span className="block pl-5 text-emerald-700">Successful: {condition.required_successful.join(', ') || 'none'}</span>
                    <span className="block pl-5 font-mono text-slate-500">Condition mass = {condition.probability.toExponential(3)}</span>
                  </button>
                ))}
              </div>
            )}

            {resultTab === 'qualitative' && result.analysis_kind === 'dynamic' && (
              <div className="space-y-1.5">
                <p className="text-[10px] text-slate-500">
                  {result.computation?.exact_engine?.exact
                    ? 'Exact first-entry sequences from the ordered-failure CTMC. Contributions partition the top-event probability at mission time.'
                    : 'Observed chronological sequences from trials that reached the top event. Contributions are conditional on a simulated top event.'}
                </p>
                {(result.cut_sequences ?? []).map((sequence, index) => (
                  <div key={index} className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px]">
                    <div><span className="font-semibold text-slate-500">#{index + 1}</span> <span className="font-mono text-slate-700">{sequence.events.join(' → ') || 'Immediate/house-event condition'}</span></div>
                    <div className="mt-0.5 text-[10px] text-slate-500">{(100 * sequence.conditional_contribution).toFixed(2)}% of top-event trials · P̂ = {sequence.estimated_probability.toExponential(3)}</div>
                  </div>
                ))}
              </div>
            )}

            {resultTab === 'curve' && (
              result.time_curve?.length ? <div className="h-80">
                <Plot data={[{
                  x: result.time_curve.map(point => point.time),
                  y: result.time_curve.map(point => point.probability),
                  type: 'scatter', mode: 'lines', name: 'P(TOP)',
                  line: { color: '#dc2626', width: 2.5 },
                } as Plotly.Data]} layout={{
                  autosize: true,
                  margin: { l: 55, r: 15, t: 35, b: 50 },
                  title: { text: 'Top-Event Probability vs Time', font: { size: 13 } },
                  xaxis: { title: { text: 'Mission time' }, gridcolor: '#e5e7eb' },
                  yaxis: { title: { text: 'Probability' }, range: [0, 1], gridcolor: '#e5e7eb' },
                  showlegend: false,
                }} useResizeHandler style={{ width: '100%', height: '100%' }}
                  plotId="fta-top-event-time" reportLabel="Top-Event Probability vs Time" reportGroup="Fault Tree Analysis" />
              </div> : <p className="rounded bg-slate-50 p-3 text-xs text-slate-500">A time curve requires time-to-failure models for every stochastic event.</p>
            )}

            {resultTab === 'nodes' && (
              <div className="space-y-1">
                <p className="mb-1 text-[10px] text-slate-400">Select a row to highlight and frame the corresponding diagram node. Repeated event references highlight together.</p>
                {(result.node_results ?? []).sort((a, b) => b.probability - a.probability).map(row => (
                  <button key={row.node_id} aria-pressed={resultNodeSelection?.source === 'nodes' && resultNodeSelection.rowKey === row.node_id}
                    onClick={() => toggleResultNodeHighlight(
                      'nodes', row.node_id,
                      matchingResultNodes(undefined, row.node_id, row.label),
                    )}
                    className={`grid w-full grid-cols-[1fr_auto] gap-2 rounded border px-2 py-1.5 text-left transition-colors ${
                      resultNodeSelection?.source === 'nodes' && resultNodeSelection.rowKey === row.node_id
                        ? 'border-amber-400 bg-amber-50 ring-1 ring-amber-200'
                        : 'border-slate-100 hover:bg-blue-50'
                    }`}>
                    <span className="min-w-0"><span className="block truncate text-xs font-medium text-slate-700">{row.label}</span><span className="text-[9px] uppercase text-slate-400">{row.type} · {row.node_id}</span></span>
                    <span className="self-center font-mono text-[11px] text-blue-700">{row.probability.toExponential(4)}</span>
                  </button>
                ))}
              </div>
            )}

            {/* #7 Methods comparison */}
            {resultTab === 'methods' && (
              <div className="flex flex-col gap-2">
                <p className="text-[10px] text-gray-400">Top-event probability by method.</p>
                {result.methods && Object.keys(result.methods).length > 0 ? (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gray-500 border-b border-gray-200">
                        <th className="text-left py-1 font-medium">Method</th>
                        <th className="text-right py-1 font-medium">P(TOP)</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono">
                      {Object.entries(result.methods).map(([m, v]) => (
                        <tr key={m} className="border-b border-gray-100">
                          <td className="py-1 font-sans text-gray-700">{METHOD_LABELS[m] ?? m}</td>
                          <td className="py-1 text-right">{v != null ? v.toExponential(5) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="text-xs text-gray-400">No method results.</p>
                )}
                {result.simulation && (
                  <div className="mt-2 bg-blue-50 border border-blue-200 rounded p-2 text-[11px]">
                    <p className="font-semibold text-blue-800 mb-1">Monte Carlo Simulation</p>
                    <p className="font-mono">P(TOP) = {result.simulation.probability.toExponential(5)}</p>
                    <p className="text-blue-700">
                      {((result.simulation.confidence_level ?? 0.95) * 100).toFixed(0)}% Wilson CI: [{result.simulation.ci_lower.toExponential(3)}, {result.simulation.ci_upper.toExponential(3)}]
                    </p>
                    <p className="text-blue-600">
                      Events = {(result.simulation.top_event_count ?? Math.round(result.simulation.probability * result.simulation.n_samples)).toLocaleString()} &middot; n = {result.simulation.n_samples.toLocaleString()} &middot; resolution = {(result.simulation.resolution_limit ?? 1 / result.simulation.n_samples).toExponential(2)}
                    </p>
                    {result.simulation.zero_event_upper_bound != null && (
                      <p className="text-blue-700 mt-0.5">
                        Zero-event one-sided upper bound: {result.simulation.zero_event_upper_bound.toExponential(3)}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* #6 Formulas */}
            {resultTab === 'formulas' && (
              <div className="flex flex-col gap-3">
                {result.formulas ? (
                  <>
                    <div>
                      <p className="text-[10px] font-semibold text-gray-500 uppercase mb-1">Boolean structure</p>
                      <div className="overflow-x-auto rounded bg-gray-50 p-2 text-xs">
                        {result.formulas.boolean_expression_latex
                          ? <Latex block>{result.formulas.boolean_expression_latex}</Latex>
                          : <p className="font-mono break-words">{result.formulas.boolean_expression}</p>}
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold text-gray-500 uppercase mb-1">Top-event probability</p>
                      <div className="overflow-x-auto rounded bg-gray-50 p-2 text-[11px]">
                        {result.formulas.probability_expression_latex
                          ? <Latex block>{result.formulas.probability_expression_latex}</Latex>
                          : <p className="font-mono break-words">{result.formulas.probability_expression}</p>}
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold text-gray-500 uppercase mb-1">Minimal cut sets</p>
                      <div className="flex flex-col gap-1">
                        {result.formulas.cut_sets.map((cs, i) => (
                          <div key={i} className="text-[11px] bg-gray-50 rounded px-2 py-1">
                            {cs.formula_latex
                              ? <Latex>{cs.formula_latex}</Latex>
                              : <span className="font-mono text-gray-700">{cs.formula}</span>}
                            <span className="text-gray-400"> = </span>
                            <span className="font-mono font-semibold text-blue-700">
                              {cs.value != null ? cs.value.toExponential(3) : '—'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-gray-400">No formulas returned.</p>
                )}
              </div>
            )}

            {resultTab === 'importance' && (
              <div>
                {result.importance_eligibility?.reason && <p className="mb-2 rounded border border-amber-200 bg-amber-50 p-2 text-[10px] text-amber-800">{result.importance_eligibility.reason}</p>}
                {result.importance.length > 0 && <p className="mb-2 text-[10px] text-slate-400">Select an importance row to highlight and frame every occurrence of that event in the diagram.</p>}
                {result.importance.length > 0 ? <ResultsTable
                  columns={importanceCols}
                  rows={result.importance.map(row => ({
                    ...row,
                    _row_key: String(row.event_key ?? row.event),
                  })) as Record<string, unknown>[]}
                  rowKey="_row_key"
                  highlightFirst={false}
                  selectedRow={resultNodeSelection?.source === 'importance' ? resultNodeSelection.rowKey : undefined}
                  onRowClick={row => {
                    const rowKey = String(row._row_key)
                    toggleResultNodeHighlight(
                      'importance', rowKey,
                      matchingResultNodes(
                        row.event_key == null ? undefined : String(row.event_key),
                        undefined,
                        String(row.event ?? ''),
                      ),
                    )
                  }}
                  rowTitle={row => `Highlight ${String(row.event)} in the diagram`}
                /> : <p className="text-xs text-slate-400">No valid importance result for this evaluation engine.</p>}
              </div>
            )}
          </div>

          <div className="p-2 border-t border-gray-100 flex flex-col gap-1">
            <button onClick={downloadMCS}
              className="w-full flex items-center justify-center gap-1 text-xs text-gray-500 hover:text-blue-600 border border-gray-200 py-1.5 rounded">
              <Download size={11} /> Export qualitative results
            </button>
            <ExportResultsButton getElement={() => resultsRef.current} baseName="fault-tree-results" />
          </div>
          </>}
        </div>
      )}
      </div>
    </div>
  )
}
