import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
  type NodeChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Plus, Play, Trash2, Download, LayoutGrid, Copy, Clipboard, GitFork } from 'lucide-react'
import { analyzeFaultTree, FaultTreeResponse, FaultTreeGraph } from '../../api/client'
import ResultsTable from '../shared/ResultsTable'
import { useFolioState, useRevision, getProjectState, writeFolioState } from '../../store/project'
import FolioBar from '../shared/FolioBar'
import LibraryPanel, { LibraryItem } from '../shared/LibraryPanel'
import { CanvasErrorBoundary, sanitizeNodeChanges, sanitizeNodes } from '../shared/CanvasErrorBoundary'
import { useLdaFolios } from '../shared/ldaFolios'
import ExportDiagramButton from '../shared/ExportDiagramButton'
import ExportResultsButton from '../shared/ExportResultsButton'
import NumberField from '../shared/NumberField'

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

// --- Gate / Event node components (traditional FTA SVG shapes) ---

function BasicEventNode({ data, selected }: NodeProps) {
  const highlighted = data.highlighted as boolean
  const desc = String(data.description || '')
  const isMirror = data.mirror as boolean
  const folioName = data.ldaFolioName ? String(data.ldaFolioName) : ''
  return (
    <div className={`relative flex flex-col items-center ${selected ? 'drop-shadow-lg' : ''}`} style={{ width: 96 }}>
      <ProbBadge data={data as Record<string, unknown>} />
      <Handle type="target" position={Position.Top} className="!bg-gray-400" style={{ top: -4 }} />
      <svg viewBox="0 0 70 70" width="70" height="70">
        <circle cx="35" cy="35" r="30"
          fill={highlighted ? '#fef3c7' : 'white'}
          stroke={highlighted ? '#f59e0b' : selected ? '#3b82f6' : '#9ca3af'}
          strokeWidth={highlighted ? 3 : 2.5}
          strokeDasharray={isMirror ? '4 2' : undefined} />
        <text x="35" y="32" textAnchor="middle" fill="#374151" fontSize="10" fontWeight="600">{String(data.label || 'Event')}</text>
        <text x="35" y="45" textAnchor="middle" fill="#6b7280" fontSize="9">p={Number(data.probability ?? 0.01).toExponential(2)}</text>
        {isMirror && (
          // Repeated-event marker: small diamond at bottom (#8).
          <polygon points="35,55 41,62 35,69 29,62" fill="#f59e0b" stroke="#b45309" strokeWidth="1" />
        )}
      </svg>
      {isMirror && (
        <div className="absolute -top-1 -left-1 bg-amber-500 text-white text-[7px] font-bold rounded px-1">REPEAT</div>
      )}
      {folioName && (
        <div className="text-center text-[8px] leading-tight text-emerald-700 mt-0.5">
          LDA: {folioName}
        </div>
      )}
      {desc && (
        <div
          title={desc}
          className="text-center text-[9px] leading-tight text-gray-600 mt-0.5 px-0.5 w-full break-words overflow-hidden"
          style={{ display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical' }}
        >
          {desc}
        </div>
      )}
    </div>
  )
}

function AndGateNode({ data, selected }: NodeProps) {
  return (
    <div className={`relative ${selected ? 'drop-shadow-lg' : ''}`} style={{ width: 80, height: 80 }}>
      <ProbBadge data={data as Record<string, unknown>} />
      <Handle type="target" position={Position.Top} className="!bg-indigo-400" style={{ top: -4 }} />
      <svg viewBox="0 0 80 80" className="w-full h-full">
        <path d="M 10 50 L 10 20 Q 10 5, 40 5 Q 70 5, 70 20 L 70 50 Z"
              fill={selected ? '#4338ca' : '#4f46e5'} stroke="#312e81" strokeWidth="2" />
        <text x="40" y="35" textAnchor="middle" fill="white" fontSize="12" fontWeight="bold">AND</text>
        <text x="40" y="48" textAnchor="middle" fill="rgba(255,255,255,0.8)" fontSize="9">{String(data.label || '')}</text>
      </svg>
      <Handle type="source" position={Position.Bottom} className="!bg-indigo-400" style={{ bottom: -4 }} />
    </div>
  )
}

function OrGateNode({ data, selected }: NodeProps) {
  return (
    <div className={`relative ${selected ? 'drop-shadow-lg' : ''}`} style={{ width: 80, height: 80 }}>
      <ProbBadge data={data as Record<string, unknown>} />
      <Handle type="target" position={Position.Top} className="!bg-orange-400" style={{ top: -4 }} />
      <svg viewBox="0 0 80 80" className="w-full h-full">
        <path d="M 10 55 Q 15 30, 40 5 Q 65 30, 70 55 Q 40 45, 10 55 Z"
              fill={selected ? '#c2410c' : '#ea580c'} stroke="#9a3412" strokeWidth="2" />
        <text x="40" y="35" textAnchor="middle" fill="white" fontSize="12" fontWeight="bold">OR</text>
        <text x="40" y="48" textAnchor="middle" fill="rgba(255,255,255,0.8)" fontSize="9">{String(data.label || '')}</text>
      </svg>
      <Handle type="source" position={Position.Bottom} className="!bg-orange-400" style={{ bottom: -4 }} />
    </div>
  )
}

function VoteGateNode({ data, selected }: NodeProps) {
  return (
    <div className={`relative ${selected ? 'drop-shadow-lg' : ''}`} style={{ width: 80, height: 80 }}>
      <ProbBadge data={data as Record<string, unknown>} />
      <Handle type="target" position={Position.Top} className="!bg-purple-400" style={{ top: -4 }} />
      <svg viewBox="0 0 80 80" className="w-full h-full">
        <path d="M 10 50 L 10 20 Q 10 5, 40 5 Q 70 5, 70 20 L 70 50 Z"
              fill={selected ? '#7e22ce' : '#9333ea'} stroke="#581c87" strokeWidth="2" />
        <text x="40" y="30" textAnchor="middle" fill="white" fontSize="10" fontWeight="bold">{String(data.k ?? 2)}/N</text>
        <text x="40" y="45" textAnchor="middle" fill="rgba(255,255,255,0.8)" fontSize="9">{String(data.label || '')}</text>
      </svg>
      <Handle type="source" position={Position.Bottom} className="!bg-purple-400" style={{ bottom: -4 }} />
    </div>
  )
}

function PANDGateNode({ data, selected }: NodeProps) {
  return (
    <div className={`relative ${selected ? 'drop-shadow-lg' : ''}`} style={{ width: 80, height: 80 }}>
      <ProbBadge data={data as Record<string, unknown>} />
      <Handle type="target" position={Position.Top} className="!bg-teal-400" style={{ top: -4 }} />
      <svg viewBox="0 0 80 80" className="w-full h-full">
        <path d="M 10 50 L 10 20 Q 10 5, 40 5 Q 70 5, 70 20 L 70 50 Z"
              fill={selected ? '#0f766e' : '#0d9488'} stroke="#134e4a" strokeWidth="2" />
        <polygon points="40,52 34,62 46,62" fill="rgba(255,255,255,0.6)" />
        <text x="40" y="30" textAnchor="middle" fill="white" fontSize="10" fontWeight="bold">PAND</text>
        <text x="40" y="45" textAnchor="middle" fill="rgba(255,255,255,0.8)" fontSize="9">{String(data.label || '')}</text>
      </svg>
      <Handle type="source" position={Position.Bottom} className="!bg-teal-400" style={{ bottom: -4 }} />
    </div>
  )
}

function XORGateNode({ data, selected }: NodeProps) {
  return (
    <div className={`relative ${selected ? 'drop-shadow-lg' : ''}`} style={{ width: 80, height: 80 }}>
      <ProbBadge data={data as Record<string, unknown>} />
      <Handle type="target" position={Position.Top} className="!bg-rose-400" style={{ top: -4 }} />
      <svg viewBox="0 0 80 80" className="w-full h-full">
        <path d="M 10 55 Q 15 30, 40 5 Q 65 30, 70 55 Q 40 45, 10 55 Z"
              fill={selected ? '#be123c' : '#e11d48'} stroke="#9f1239" strokeWidth="2" />
        <text x="40" y="35" textAnchor="middle" fill="white" fontSize="12" fontWeight="bold">XOR</text>
        <text x="40" y="48" textAnchor="middle" fill="rgba(255,255,255,0.8)" fontSize="9">{String(data.label || '')}</text>
      </svg>
      <Handle type="source" position={Position.Bottom} className="!bg-rose-400" style={{ bottom: -4 }} />
    </div>
  )
}

function NOTGateNode({ data, selected }: NodeProps) {
  return (
    <div className={`relative ${selected ? 'drop-shadow-lg' : ''}`} style={{ width: 80, height: 80 }}>
      <ProbBadge data={data as Record<string, unknown>} />
      <Handle type="target" position={Position.Top} className="!bg-slate-400" style={{ top: -4 }} />
      <svg viewBox="0 0 80 80" className="w-full h-full">
        <polygon points="40,5 10,60 70,60"
                 fill={selected ? '#334155' : '#475569'} stroke="#1e293b" strokeWidth="2" />
        <circle cx="40" cy="65" r="5" fill="none" stroke="#1e293b" strokeWidth="2" />
        <text x="40" y="35" textAnchor="middle" fill="white" fontSize="11" fontWeight="bold">NOT</text>
        <text x="40" y="50" textAnchor="middle" fill="rgba(255,255,255,0.8)" fontSize="9">{String(data.label || '')}</text>
      </svg>
      <Handle type="source" position={Position.Bottom} className="!bg-slate-400" style={{ bottom: -4 }} />
    </div>
  )
}

function TransferGateNode({ data, selected }: NodeProps) {
  const ref = data.transferToName ? String(data.transferToName) : ''
  return (
    <div className={`relative flex flex-col items-center ${selected ? 'drop-shadow-lg' : ''}`} style={{ width: 80 }}>
      <ProbBadge data={data as Record<string, unknown>} />
      <Handle type="target" position={Position.Top} className="!bg-cyan-400" style={{ top: -4 }} />
      <svg viewBox="0 0 80 80" width="80" height="80">
        <polygon points="10,10 70,40 10,70"
                 fill={selected ? '#0e7490' : '#0891b2'} stroke="#155e75" strokeWidth="2" />
        <text x="35" y="43" textAnchor="middle" fill="white" fontSize="11" fontWeight="bold">XFER</text>
      </svg>
      <div className="text-center text-[8px] leading-tight text-cyan-700 -mt-1">
        {ref ? `→ ${ref}` : '(unset)'}
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-cyan-400" style={{ bottom: -4 }} />
    </div>
  )
}

const nodeTypes = {
  basic: BasicEventNode,
  and: AndGateNode,
  or: OrGateNode,
  vote: VoteGateNode,
  pand: PANDGateNode,
  xor: XORGateNode,
  not: NOTGateNode,
  transfer: TransferGateNode,
}

const importanceCols = [
  { key: 'event', label: 'Event' },
  { key: 'Birnbaum', label: 'Birnbaum' },
  { key: 'Fussell-Vesely', label: 'FV' },
  { key: 'RAW', label: 'RAW' },
  { key: 'RRW', label: 'RRW' },
]

const METHOD_OPTIONS: { id: string; label: string }[] = [
  { id: 'exact', label: 'Exact (inclusion-exclusion over MCS)' },
  { id: 'rare_event', label: 'Rare-event approximation (Σ P(MCS))' },
  { id: 'min_cut_upper_bound', label: 'Min-cut upper bound (1 − Π(1 − P(MCS)))' },
  { id: 'simulation', label: 'Monte Carlo simulation' },
]

const METHOD_LABELS: Record<string, string> = {
  exact: 'Exact',
  rare_event: 'Rare-event',
  min_cut_upper_bound: 'Min-cut UB',
  simulation: 'Simulation',
}

interface CanvasState { nodes: Node[]; edges: Edge[]; exposureTime?: string }
const INITIAL_CANVAS: CanvasState = { nodes: [], edges: [], exposureTime: '1000' }
const faultTreeKey = 'faultTree'

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
    trees[f.id] = {
      nodes: (st.nodes ?? []).map(n => ({
        id: n.id, type: n.type ?? 'basic', data: n.data as Record<string, unknown>,
      })),
      edges: (st.edges ?? []).map(e => ({ source: e.source, target: e.target })),
    }
    names[f.id] = f.name
  }
  return { trees, names }
}

export default function FaultTreePage() {
  const [persisted, , folios] = useFolioState<CanvasState>(faultTreeKey, INITIAL_CANVAS)
  const revision = useRevision()
  const ldaFolios = useLdaFolios()
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(sanitizeNodes(persisted.nodes ?? []))
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(persisted.edges)
  const [selectedNode, setSelectedNode] = useState<Node | null>(null)
  const [result, setResult] = useState<FaultTreeResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resultTab, setResultTab] = useState<'mcs' | 'importance' | 'formulas' | 'methods'>('mcs')
  const [activeMCS, setActiveMCS] = useState<number | null>(null)
  const [clipboard, setClipboard] = useState<Record<string, unknown> | null>(null)
  const [globalExposure, setGlobalExposure] = useState<string>(persisted.exposureTime ?? '1000')
  const [method, setMethod] = useState<string>('exact')
  const [nSimulations, setNSimulations] = useState<string>('10000')
  const [simSeed, setSimSeed] = useState<string>('')
  const flowWrapperRef = useRef<HTMLDivElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)

  // Other trees (folios) usable as transfer targets (excludes current tree).
  const transferTargets = useMemo(
    () => folios.folios.filter(f => f.id !== folios.activeId),
    [folios.folios, folios.activeId],
  )

  // Compute which node IDs should be highlighted:
  // 1. MCS highlighting: when a cut set is selected, highlight its events.
  // 2. Mirror highlighting: when a basic event is selected, highlight all
  //    nodes sharing the same eventKey (auto-mirror siblings).
  const highlightedNodes = useMemo<Set<string>>(() => {
    const ids = new Set<string>()
    if (activeMCS != null && result) {
      const keys = new Set(result.minimal_cut_sets[activeMCS] ?? [])
      for (const n of nodes) {
        if (n.type !== 'basic') continue
        const key = String(n.data.eventKey ?? n.data.label ?? n.id)
        if (keys.has(key)) ids.add(n.id)
      }
    }
    if (selectedNode?.type === 'basic') {
      const selKey = String(selectedNode.data.eventKey ?? selectedNode.data.label ?? selectedNode.id)
      const siblings = nodes.filter(n =>
        n.type === 'basic' && n.id !== selectedNode.id
        && String(n.data.eventKey ?? n.data.label ?? n.id) === selKey)
      if (siblings.length > 0) {
        ids.add(selectedNode.id)
        siblings.forEach(n => ids.add(n.id))
      }
    }
    return ids
  }, [activeMCS, result, nodes, selectedNode])

  useEffect(() => {
    setNodes(nds => nds.map(n => {
      const isHighlighted = highlightedNodes.has(n.id)
      if ((n.data.highlighted as boolean) === isHighlighted) return n
      return { ...n, data: { ...n.data, highlighted: isHighlighted } }
    }))
  }, [highlightedNodes]) // eslint-disable-line react-hooks/exhaustive-deps

  // Persist canvas to the project store, debounced. Writes are addressed to the
  // folio the current canvas belongs to (`ownerFolio`), not whichever folio is
  // active when the timer fires — so switching folios can never drop or
  // misplace a pending write.
  const latest = useRef({ nodes, edges, exposureTime: globalExposure })
  latest.current = { nodes, edges, exposureTime: globalExposure }
  const ownerFolio = useRef(folios.activeId)
  const persistTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => {
    if (persistTimer.current) clearTimeout(persistTimer.current)
    persistTimer.current = setTimeout(
      () => writeFolioState(faultTreeKey, ownerFolio.current, latest.current), 250)
  }, [nodes, edges, globalExposure]) // eslint-disable-line react-hooks/exhaustive-deps
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
      setEdges(persisted.edges ?? [])
      setGlobalExposure(persisted.exposureTime ?? '1000')
      setSelectedNode(null)
      setResult(null)
      setActiveMCS(null)
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
    (connection: Connection) => { setResult(null); clearAnnotations(); setEdges(eds => addEdge(connection, eds)) },
    [setEdges, clearAnnotations],
  )

  const onNodesChangeWrapped = useCallback(
    (changes: NodeChange[]) => {
      // Adding/removing nodes invalidates the last result's annotations.
      if (changes.some(c => c.type === 'add' || c.type === 'remove')) {
        setResult(null); clearAnnotations()
      }
      onNodesChange(sanitizeNodeChanges(changes))
    },
    [onNodesChange, clearAnnotations],
  )

  const nextNodeId = () => {
    const maxId = nodes.reduce((m, n) => {
      const match = /^n(\d+)$/.exec(n.id)
      return match ? Math.max(m, parseInt(match[1], 10)) : m
    }, 0)
    return `n${maxId + 1}`
  }

  const addNode = (type: 'basic' | 'and' | 'or' | 'vote' | 'pand' | 'xor' | 'not' | 'transfer') => {
    const id = nextNodeId()
    const defaults: Record<string, unknown> = { label: `${type.toUpperCase()}_${id}` }
    if (type === 'basic') { defaults.probability = 0.01; defaults.eventKey = id }
    if (type === 'vote') defaults.k = 2
    const newNode: Node = {
      id,
      type,
      position: { x: 200 + Math.random() * 200, y: 100 + Math.random() * 200 },
      data: defaults,
    }
    setResult(null); clearAnnotations()
    setNodes(nds => [...nds, newNode])
  }

  // #8 Copy: stash the selected node's data.
  const copyNode = () => {
    if (!selectedNode || selectedNode.type !== 'basic') return
    setClipboard({ ...selectedNode.data })
  }

  // #8 Paste: a NEW independent event — fresh unique eventKey so it is treated
  // as a distinct event in the cut-set logic.
  const pasteAsCopy = () => {
    if (!clipboard) return
    const id = nextNodeId()
    const newNode: Node = {
      id,
      type: 'basic',
      position: { x: 200 + Math.random() * 200, y: 100 + Math.random() * 200 },
      data: { ...clipboard, eventKey: id, mirror: false, computedP: undefined,
        label: `${String(clipboard.label ?? 'EVENT')}_copy` },
    }
    setResult(null); clearAnnotations()
    setNodes(nds => [...nds, newNode])
  }

  // #8 Mirror: references the SAME underlying basic event (shared eventKey) so
  // the backend de-duplicates it in cut sets / probability.
  const pasteAsMirror = () => {
    if (!clipboard) return
    const id = nextNodeId()
    // Preserve the source's eventKey (fall back to its label) so identity is shared.
    const sharedKey = String(clipboard.eventKey ?? clipboard.label ?? id)
    const newNode: Node = {
      id,
      type: 'basic',
      position: { x: 200 + Math.random() * 200, y: 100 + Math.random() * 200 },
      data: { ...clipboard, eventKey: sharedKey, mirror: true, computedP: undefined },
    }
    setResult(null); clearAnnotations()
    setNodes(nds => [...nds, newNode])
  }

  const autoLayout = () => {
    const children = new Map<string, string[]>()
    const hasParent = new Set<string>()
    edges.forEach(e => {
      children.set(e.source, [...(children.get(e.source) ?? []), e.target])
      hasParent.add(e.target)
    })
    const roots = nodes.filter(n => !hasParent.has(n.id)).map(n => n.id)
    if (roots.length === 0) return
    const layers = new Map<string, number>()
    const queue = [...roots]
    roots.forEach(r => layers.set(r, 0))
    while (queue.length > 0) {
      const cur = queue.shift()!
      for (const child of (children.get(cur) ?? [])) {
        const newLayer = layers.get(cur)! + 1
        if (!layers.has(child) || layers.get(child)! < newLayer) {
          layers.set(child, newLayer)
          queue.push(child)
        }
      }
    }
    nodes.forEach(n => { if (!layers.has(n.id)) layers.set(n.id, 0) })
    const byLayer = new Map<number, string[]>()
    layers.forEach((layer, id) => {
      byLayer.set(layer, [...(byLayer.get(layer) ?? []), id])
    })
    const xGap = 160, yGap = 140, startY = 50
    setNodes(nds => nds.map(n => {
      const layer = layers.get(n.id) ?? 0
      const nodesInLayer = byLayer.get(layer) ?? [n.id]
      const idx = nodesInLayer.indexOf(n.id)
      const totalWidth = (nodesInLayer.length - 1) * xGap
      return {
        ...n,
        position: { x: 400 - totalWidth / 2 + idx * xGap, y: startY + layer * yGap },
      }
    }))
  }

  const deleteSelected = () => {
    if (!selectedNode) return
    setNodes(nds => nds.filter(n => n.id !== selectedNode.id))
    setEdges(eds => eds.filter(e => e.source !== selectedNode.id && e.target !== selectedNode.id))
    setSelectedNode(null)
    setResult(null); clearAnnotations()
  }

  const updateData = (key: string, value: unknown) => {
    if (!selectedNode) return
    setNodes(nds => nds.map(n =>
      n.id === selectedNode.id ? { ...n, data: { ...n.data, [key]: value } } : n
    ))
    setSelectedNode(prev => prev ? { ...prev, data: { ...prev.data, [key]: value } } : null)
  }

  const updateDataMulti = (updates: Record<string, unknown>) => {
    if (!selectedNode) return
    setNodes(nds => nds.map(n =>
      n.id === selectedNode.id ? { ...n, data: { ...n.data, ...updates } } : n
    ))
    setSelectedNode(prev => prev ? { ...prev, data: { ...prev.data, ...updates } } : null)
  }

  // Auto-mirror: when a basic event's label matches another basic event,
  // sync the eventKey so the backend treats them as the same underlying event.
  const syncMirrorByLabel = useCallback((editedId: string, newLabel: string) => {
    setNodes(nds => {
      if (!newLabel.trim()) return nds
      const match = nds.find(n =>
        n.type === 'basic' && n.id !== editedId
        && String(n.data.label ?? '') === newLabel.trim())
      if (!match) {
        // No match: ensure this event has its own unique key and is not mirrored
        return nds.map(n => n.id === editedId
          ? { ...n, data: { ...n.data, eventKey: n.id, mirror: false } } : n)
      }
      const sharedKey = String(match.data.eventKey ?? match.data.label ?? match.id)
      return nds.map(n => {
        if (n.id === editedId) {
          return { ...n, data: { ...n.data, eventKey: sharedKey, mirror: true } }
        }
        // Mark the original as well (it may not have been flagged mirror yet)
        if (n.id === match.id && !n.data.mirror) {
          return n // original stays non-mirror; it's the "primary"
        }
        return n
      })
    })
  }, [setNodes])

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(node)
  }, [])

  const onPaneClick = useCallback(() => setSelectedNode(null), [])

  const analyze = async () => {
    if (!nodes.length) { setError('Add nodes to the fault tree first.'); return }
    setError(null)
    setLoading(true)
    setActiveMCS(null)
    const globalT = globalExposure.trim() === '' ? undefined : parseFloat(globalExposure)
    // Refresh node display probabilities for distribution events.
    const refreshed = nodes.map(n => {
      if (n.type !== 'basic') return n
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
      const apiEdges = edges.map(e => ({ source: e.source, target: e.target }))
      // Snapshot every folio so transfer gates can resolve their targets (#9).
      // Override the active tree with the just-refreshed in-memory graph.
      const { trees } = collectAllTrees()
      trees[folios.activeId] = { nodes: apiNodes, edges: apiEdges }
      const res = await analyzeFaultTree(apiNodes, apiEdges, {
        exposureTime: globalT ?? null,
        methods: [method],
        nSimulations: method === 'simulation' ? (parseInt(nSimulations) || 10000) : undefined,
        seed: method === 'simulation' && simSeed.trim() ? parseInt(simSeed) : undefined,
        trees,
        treeId: folios.activeId,
      })
      setResult(res)
      // #5 Annotate each node with its computed probability. Basic events use
      // their own probability; gates that map 1:1 to a cut set get that value.
      annotateNodes(refreshed, res)
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Analysis error.')
    } finally {
      setLoading(false)
    }
  }

  // #5 Compute a per-node probability to show on the diagram after analysis.
  const annotateNodes = (graphNodes: Node[], res: FaultTreeResponse) => {
    // Build children map for the current canvas.
    const children = new Map<string, string[]>()
    edges.forEach(e => children.set(e.source, [...(children.get(e.source) ?? []), e.target]))
    const byId = new Map(graphNodes.map(n => [n.id, n]))

    // Collect all folio trees so transfer gates can evaluate their referenced
    // tree's probability locally (the backend already does this; here we mirror
    // the logic for the per-node badge display).
    const { trees: allTrees } = collectAllTrees()

    // Evaluate a sub-tree (another folio) and return its root's probability.
    const subTreeMemo = new Map<string, number>()
    const evalSubTree = (treeId: string, visiting: Set<string>): number => {
      if (subTreeMemo.has(treeId)) return subTreeMemo.get(treeId)!
      if (visiting.has(treeId)) return 0 // cycle
      visiting.add(treeId)
      const tree = allTrees[treeId]
      if (!tree) return 0
      const subChildren = new Map<string, string[]>()
      const subById = new Map<string, { type: string; data: Record<string, unknown> }>()
      for (const n of tree.nodes) { subById.set(n.id, n) }
      for (const e of tree.edges) {
        subChildren.set(e.source, [...(subChildren.get(e.source) ?? []), e.target])
      }
      const hasParent = new Set<string>()
      tree.edges.forEach(e => hasParent.add(e.target))
      const roots = tree.nodes.filter(n => !hasParent.has(n.id))
      if (roots.length !== 1) return 0
      const evalSub = (id: string, seen: Set<string>): number => {
        if (seen.has(id)) return 0
        seen.add(id)
        const nd = subById.get(id)
        if (!nd) return 0
        const kids = subChildren.get(id) ?? []
        if (nd.type === 'basic') return Math.min(1, Math.max(0, Number(nd.data.probability ?? 0)))
        if (nd.type === 'transfer' && kids.length === 0) {
          const ref = String(nd.data.transferTo ?? nd.data.ref_tree ?? '')
          return ref ? evalSubTree(ref, new Set(visiting)) : 0
        }
        if (kids.length === 0) return 0
        const cps = kids.map(k => evalSub(k, new Set(seen)))
        switch (nd.type) {
          case 'and': case 'pand': return cps.reduce((a, b) => a * b, 1)
          case 'or': return 1 - cps.reduce((a, b) => a * (1 - b), 1)
          case 'not': return 1 - cps[0]
          case 'transfer': return cps[0]
          default: return 1 - cps.reduce((a, b) => a * (1 - b), 1)
        }
      }
      const p = Math.min(1, Math.max(0, evalSub(roots[0].id, new Set())))
      subTreeMemo.set(treeId, p)
      return p
    }

    const memo = new Map<string, number>()
    const evalNode = (id: string, seen: Set<string>): number => {
      if (memo.has(id)) return memo.get(id)!
      if (seen.has(id)) return 0
      seen.add(id)
      const node = byId.get(id)
      if (!node) return 0
      const kids = children.get(id) ?? []
      let p: number
      if (node.type === 'basic') {
        p = Math.min(1, Math.max(0, Number(node.data.probability ?? 0)))
      } else if (node.type === 'transfer' && kids.length === 0) {
        // Transfer gate with no local children — evaluate the referenced tree.
        const ref = String(node.data.transferTo ?? node.data.ref_tree ?? '')
        p = ref ? evalSubTree(ref, new Set()) : 0
      } else if (kids.length === 0) {
        p = 0
      } else {
        const cps = kids.map(k => evalNode(k, new Set(seen)))
        switch (node.type) {
          case 'and':
          case 'pand':
            p = cps.reduce((a, b) => a * b, 1)
            break
          case 'or':
            p = 1 - cps.reduce((a, b) => a * (1 - b), 1)
            break
          case 'vote': {
            const k = Number(node.data.k ?? 2)
            p = 1 - cps.reduce((a, b) => a * (1 - b), 1)
            void k
            break
          }
          case 'xor':
            p = cps.reduce((acc, pi, i) => acc + pi * cps.reduce((a, pj, j) => j === i ? a : a * (1 - pj), 1), 0)
            break
          case 'not':
            p = 1 - cps[0]
            break
          case 'transfer':
            p = cps[0]
            break
          default:
            p = 1 - cps.reduce((a, b) => a * (1 - b), 1)
        }
      }
      p = Math.min(1, Math.max(0, p))
      memo.set(id, p)
      return p
    }

    // Root = node without parent.
    const hasParent = new Set<string>()
    edges.forEach(e => hasParent.add(e.target))
    const roots = graphNodes.filter(n => !hasParent.has(n.id)).map(n => n.id)
    roots.forEach(r => evalNode(r, new Set()))
    // Ensure all nodes evaluated.
    graphNodes.forEach(n => evalNode(n.id, new Set()))
    // Root gets the authoritative top-event probability from the backend.
    if (roots.length === 1) memo.set(roots[0], res.top_event_probability)

    setNodes(nds => nds.map(n => ({
      ...n, data: { ...n.data, computedP: memo.get(n.id) },
    })))
  }

  const downloadMCS = () => {
    if (!result) return
    const rows = result.minimal_cut_sets.map((mcs, i) => `${i + 1},"${mcs.join(', ')}"`)
    const blob = new Blob([`Order,Events\n${rows.join('\n')}`], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'minimal_cut_sets.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col h-[calc(100vh-57px)]">
      {/* #9 Folio bar doubles as the fault-tree list / hierarchy sidebar. */}
      <FolioBar api={folios} label="Tree" />
      <div className="flex flex-1 overflow-hidden">
      {/* Left toolbar */}
      <div className="w-56 flex-shrink-0 bg-white border-r border-gray-200 p-3 flex flex-col gap-2 overflow-y-auto">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Add Node</p>

        {([
          { type: 'basic', label: 'Basic Event', color: 'border-gray-400 text-gray-700' },
          { type: 'and', label: 'AND Gate', color: 'border-indigo-400 text-indigo-700' },
          { type: 'or', label: 'OR Gate', color: 'border-orange-400 text-orange-700' },
          { type: 'vote', label: 'VOTE Gate', color: 'border-purple-400 text-purple-700' },
          { type: 'pand', label: 'PAND Gate', color: 'border-teal-400 text-teal-700' },
          { type: 'xor', label: 'XOR Gate', color: 'border-rose-400 text-rose-700' },
          { type: 'not', label: 'NOT Gate', color: 'border-slate-400 text-slate-700' },
          { type: 'transfer', label: 'Transfer', color: 'border-cyan-400 text-cyan-700' },
        ] as const).map(({ type, label, color }) => (
          <button
            key={type}
            onClick={() => addNode(type)}
            className={`flex items-center gap-2 px-3 py-1.5 text-xs border rounded hover:bg-gray-50 transition-colors ${color}`}
          >
            <Plus size={12} /> {label}
          </button>
        ))}

        <div className="border-t border-gray-100 my-1" />

        <button
          onClick={deleteSelected}
          disabled={!selectedNode}
          className="flex items-center gap-2 px-3 py-1.5 text-xs text-red-600 border border-red-200 rounded hover:bg-red-50 disabled:opacity-40 transition-colors"
        >
          <Trash2 size={12} /> Delete Selected
        </button>

        <div className="flex gap-1">
          <button
            onClick={copyNode}
            disabled={!selectedNode || selectedNode.type !== 'basic'}
            className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs text-gray-700 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40 transition-colors"
            title="Copy basic event"
          >
            <Copy size={12} /> Copy
          </button>
          <button
            onClick={pasteAsCopy}
            disabled={!clipboard}
            className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs text-gray-700 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40 transition-colors"
            title="Paste as a NEW independent event"
          >
            <Clipboard size={12} /> Paste
          </button>
        </div>
        <button
          onClick={pasteAsMirror}
          disabled={!clipboard}
          className="flex items-center justify-center gap-1 px-2 py-1.5 text-xs text-amber-700 border border-amber-300 rounded hover:bg-amber-50 disabled:opacity-40 transition-colors"
          title="Mirror: a repeated reference to the SAME event (shared identity)"
        >
          <GitFork size={12} /> Mirror (repeated event)
        </button>

        <button
          onClick={autoLayout}
          className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-700 border border-gray-300 rounded hover:bg-gray-50 transition-colors"
        >
          <LayoutGrid size={12} /> Auto Layout
        </button>

        {/* Node editor */}
        {selectedNode && (
          <div className="border-t border-gray-100 pt-2 flex flex-col gap-2">
            <p className="text-xs font-medium text-gray-600">
              Edit: <span className="capitalize">{selectedNode.type}</span>
              <span className="text-gray-400 ml-1 font-normal">({selectedNode.id})</span>
            </p>
            <div>
              <label className="text-xs text-gray-500 block mb-0.5">Label / ID</label>
              <input
                value={String(selectedNode.data.label ?? '')}
                onChange={e => {
                  updateData('label', e.target.value)
                  if (selectedNode.type === 'basic') syncMirrorByLabel(selectedNode.id, e.target.value)
                }}
                className="w-full text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-0.5">Description</label>
              <textarea
                rows={2}
                value={String(selectedNode.data.description ?? '')}
                onChange={e => updateData('description', e.target.value)}
                placeholder="Optional description..."
                className="w-full text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400 resize-none"
              />
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
                    updateDataMulti({ transferTo: id || undefined, transferToName: name || undefined })
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
              </div>
            )}

            {selectedNode.type === 'basic' && (() => {
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
                        { v: 'lda', l: 'LDA' },
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

                  {/* #4 LDA folio dropdown */}
                  {source === 'lda' && (
                    <div>
                      <label className="text-xs text-gray-500 block mb-0.5">LDA folio (fitted distribution)</label>
                      <select
                        value={String(selectedNode.data.ldaFolioId ?? '')}
                        onChange={e => {
                          const src = ldaFolios.find(f => f.id === e.target.value)
                          if (!src) { updateDataMulti({ ldaFolioId: '', ldaFolioName: undefined }); return }
                          const prob = computeCDF(src.dist, src.dist_params, effectiveT)
                          updateDataMulti({
                            ldaFolioId: src.id, ldaFolioName: src.name,
                            distribution: src.dist, dist_params: src.dist_params,
                            probability: Math.min(1, Math.max(0, prob)),
                          })
                        }}
                        className="w-full text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
                      >
                        <option value="">— select folio —</option>
                        {ldaFolios.map(f => (
                          <option key={f.id} value={f.id}>{f.name} — {f.label}</option>
                        ))}
                      </select>
                      {ldaFolios.length === 0 && (
                        <p className="text-[10px] text-gray-400 mt-0.5">No fitted Life-Data folios available.</p>
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
                          {hasOverride ? `Override τ = ${overrideVal}` : `Using global t = ${globalT}`}
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
                    <div>
                      <label className="text-xs text-gray-500 block mb-0.5"
                        title="Probability (0–1) that this basic event occurs.">
                        Probability
                      </label>
                      <NumberField
                        value={String(selectedNode.data.probability ?? 0.01)}
                        min={0} max={1} step={0.001}
                        onChange={v => updateData('probability', parseFloat(v))}
                        className="w-full"
                      />
                    </div>
                  )}
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
            {selectedNode.data.eventKey != null && selectedNode.type === 'basic' && (
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
        )}

        <LibraryPanel
          mode="probability"
          selectedLabel={selectedNode?.type === 'basic'
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

        <div className="mt-auto">
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

          {/* #7 Calculation method (single select) */}
          <div className="mb-2 border-t border-gray-100 pt-2">
            <label className="text-[11px] font-medium text-gray-600 block mb-1">Calculation method</label>
            <div className="flex flex-col gap-1">
              {METHOD_OPTIONS.map(m => (
                <label key={m.id} className="flex items-start gap-1.5 text-[10px] text-gray-600 cursor-pointer">
                  <input
                    type="radio"
                    name="fta-method"
                    checked={method === m.id}
                    onChange={() => setMethod(m.id)}
                    className="mt-0.5"
                  />
                  <span className="leading-tight">{m.label}</span>
                </label>
              ))}
            </div>
            {method === 'simulation' && (
              <div className="mt-1.5 space-y-1.5">
                <div>
                  <label className="text-[10px] text-gray-500 block mb-0.5">Number of simulations</label>
                  <NumberField
                    value={nSimulations}
                    min={1000} max={10000000} step={1000}
                    onChange={v => setNSimulations(v)}
                    className="w-full"
                    placeholder="10000"
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
              </div>
            )}
          </div>

          {error && <p className="text-xs text-red-600 bg-red-50 p-2 rounded mb-2">{error}</p>}
          <button
            onClick={analyze}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium py-2 rounded transition-colors"
          >
            <Play size={12} />
            {loading ? 'Analyzing...' : 'Analyze Fault Tree'}
          </button>
        </div>
      </div>

      {/* Canvas */}
      <CanvasErrorBoundary onReset={autoLayout}>
        <div className="flex-1 relative" ref={flowWrapperRef}>
          {/* #19 Export diagram */}
          <div className="absolute top-3 right-3 z-10">
            <ExportDiagramButton getElement={() => flowWrapperRef.current} baseName="fault-tree" />
          </div>
          {result && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 bg-white/90 backdrop-blur border border-red-200 rounded-lg shadow-lg px-4 py-2 flex items-center gap-3">
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Top Event</span>
              <span className="text-lg font-bold text-red-600">{result.top_event_probability.toExponential(4)}</span>
            </div>
          )}
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChangeWrapped}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            nodeTypes={nodeTypes}
            fitView
            deleteKeyCode="Delete"
          >
            <Background color="#e5e7eb" gap={20} />
            <Controls />
            <MiniMap />
          </ReactFlow>
        </div>
      </CanvasErrorBoundary>

      {/* Results panel */}
      {result && (
        <div ref={resultsRef} className="w-80 flex-shrink-0 bg-white border-l border-gray-200 flex flex-col overflow-hidden">
          <div className="p-3 border-b border-gray-100">
            <p className="text-xs text-gray-500">Top Event Probability</p>
            <p className="text-2xl font-bold text-red-600">
              {result.top_event_probability.toExponential(4)}
            </p>
          </div>

          <div className="flex border-b border-gray-100 text-[11px]">
            {([
              { id: 'mcs', label: `MCS (${result.minimal_cut_sets.length})` },
              { id: 'methods', label: 'Methods' },
              { id: 'formulas', label: 'Formulas' },
              { id: 'importance', label: 'Import.' },
            ] as const).map(t => (
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
            {resultTab === 'mcs' && (
              <div className="flex flex-col gap-1">
                <p className="text-[10px] text-gray-400 mb-1">Click a cut set to highlight its events on the diagram.</p>
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
                      95% CI: [{result.simulation.ci_lower.toExponential(3)}, {result.simulation.ci_upper.toExponential(3)}]
                    </p>
                    <p className="text-blue-600">
                      SE = {result.simulation.std_error.toExponential(3)} &middot; n = {result.simulation.n_samples.toLocaleString()}
                    </p>
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
                      <p className="text-xs font-mono bg-gray-50 rounded p-2 break-words">{result.formulas.boolean_expression}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold text-gray-500 uppercase mb-1">Top-event probability</p>
                      <p className="text-[11px] font-mono bg-gray-50 rounded p-2 break-words">{result.formulas.probability_expression}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold text-gray-500 uppercase mb-1">Minimal cut sets</p>
                      <div className="flex flex-col gap-1">
                        {result.formulas.cut_sets.map((cs, i) => (
                          <div key={i} className="text-[11px] bg-gray-50 rounded px-2 py-1">
                            <span className="font-mono text-gray-700">{cs.formula}</span>
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
              <ResultsTable
                columns={importanceCols}
                rows={result.importance as Record<string, unknown>[]}
                rowKey="event"
              />
            )}
          </div>

          <div className="p-2 border-t border-gray-100 flex flex-col gap-1">
            <button onClick={downloadMCS}
              className="w-full flex items-center justify-center gap-1 text-xs text-gray-500 hover:text-blue-600 border border-gray-200 py-1.5 rounded">
              <Download size={11} /> Export MCS
            </button>
            <ExportResultsButton getElement={() => resultsRef.current} baseName="fault-tree-results" />
          </div>
        </div>
      )}
      </div>
    </div>
  )
}
