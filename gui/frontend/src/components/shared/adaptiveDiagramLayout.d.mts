export type AdaptiveLayoutNode = {
  id: string
  kind?: 'gate' | 'event'
  type?: string
  width: number
  height: number
  x?: number
  y?: number
}

export type AdaptiveLayoutEdge = {
  id: string
  source: string
  target: string
  order?: number
}

export type AdaptiveRoute = {
  orientation: 'vertical' | 'horizontal'
  lane: number
  offset: number
  trunk?: 'source' | 'target' | 'midpoint'
  points?: Array<{ x: number; y: number }>
  sourceAnchor?: { x: number; y: number }
  targetAnchor?: { x: number; y: number }
  obstructionCount?: number
}

export type AdaptiveLayoutResult = {
  positions: Record<string, { x: number; y: number }>
  routes: Record<string, AdaptiveRoute>
  staggered: string[]
}

type CommonOptions = {
  layoutOptions?: Partial<DiagramLayoutOptions>
  nodes: AdaptiveLayoutNode[]
  edges: AdaptiveLayoutEdge[]
  density?: 'dense' | 'compact' | 'comfortable' | 'spacious' | 'expanded'
  connectorStyle?: 'smoothstep' | 'bezier' | 'straight'
  snapToGrid?: boolean
  gridSize?: number
  top?: number
  side?: number
}

export function layoutVerticalGraph(options: CommonOptions & {
  viewportWidth?: number
}): AdaptiveLayoutResult

export function layoutHorizontalGraph(options: CommonOptions & {
  viewportHeight?: number
}): AdaptiveLayoutResult

export function rectanglesOverlap(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
  gap?: number,
): boolean

export function orthogonalConnectorPath(options: {
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
  orientation?: 'vertical' | 'horizontal'
  trunk?: 'source' | 'target' | 'midpoint'
  offset?: number
}): string

export function adaptiveConnectorOffset(
  density?: 'dense' | 'compact' | 'comfortable' | 'spacious' | 'expanded',
  connectorStyle?: 'smoothstep' | 'bezier' | 'straight',
): number

export type DiagramLayoutMode = 'compact' | 'normal' | 'expanded'
export type DiagramLayoutOptions = { mode: DiagramLayoutMode; preserveGateOrder: boolean; preserveEventOrder: boolean; optimizeLabelGeometry: boolean }
export const LAYOUT_PROFILES: Record<DiagramLayoutMode, { nodeGap: number; layerGap: number; laneGap: number; corridor: number }>
export function normalizeLayoutOptions(value?: Partial<DiagramLayoutOptions>, density?: string): DiagramLayoutOptions
export function layoutDensity(mode: DiagramLayoutMode): 'compact' | 'comfortable' | 'expanded'
export function orderLayoutNodes<T extends AdaptiveLayoutNode>(nodes: T[], options: DiagramLayoutOptions, horizontal?: boolean, score?: (id: string) => number | undefined): T[]
export function layoutRadialGraph(options: CommonOptions & { initialId?: string }): AdaptiveLayoutResult
export function routedConnectorPath(args: Parameters<typeof orthogonalConnectorPath>[0], route?: AdaptiveRoute): string
export function routeGraphEdges(nodes: AdaptiveLayoutNode[], edges: AdaptiveLayoutEdge[], positions: AdaptiveLayoutResult['positions'], orientation: 'vertical' | 'horizontal', corridor: number): AdaptiveLayoutResult['routes']
export function layoutLargeNestedBlocks<T extends {x:number;y:number;width:number;height:number}>(nodes: (AdaptiveLayoutNode & { parentId?: string; expanded?: boolean; insideBoundary?: boolean })[], boundary:T, options:DiagramLayoutOptions): { positions: AdaptiveLayoutResult['positions']; boundary:T }
export function clearCurveOffset(source:{x:number;y:number}, target:{x:number;y:number}, boxes:Array<{x:number;y:number;width:number;height:number}>, preferred:number, clearance:number): number
