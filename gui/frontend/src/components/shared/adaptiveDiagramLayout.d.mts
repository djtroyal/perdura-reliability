export type AdaptiveLayoutNode = {
  id: string
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
}

export type AdaptiveLayoutResult = {
  positions: Record<string, { x: number; y: number }>
  routes: Record<string, AdaptiveRoute>
  staggered: string[]
}

type CommonOptions = {
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
