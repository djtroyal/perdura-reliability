import { BaseEdge, type Edge, type EdgeProps } from '@xyflow/react'
import { orthogonalConnectorPath } from './adaptiveDiagramLayout.mjs'

type AdaptiveEdgeData = {
  adaptiveRoute?: {
    orientation?: 'vertical' | 'horizontal'
    trunk?: 'source' | 'target' | 'midpoint'
    offset?: number
  }
}

type AdaptiveEdge = Edge<AdaptiveEdgeData, 'adaptiveOrthogonal'>

/** A deterministic shared-trunk router for traditional FTA/RBD branch lines. */
export default function AdaptiveOrthogonalEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  markerStart,
  markerEnd,
  style,
  interactionWidth,
  label,
  labelStyle,
  labelShowBg,
  labelBgStyle,
  labelBgPadding,
  labelBgBorderRadius,
}: EdgeProps<AdaptiveEdge>) {
  const route = data?.adaptiveRoute
  const path = orthogonalConnectorPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    orientation: route?.orientation ?? 'vertical',
    trunk: route?.trunk ?? 'source',
    offset: route?.offset ?? 32,
  })
  return <BaseEdge
    id={id}
    path={path}
    markerStart={markerStart}
    markerEnd={markerEnd}
    style={style}
    interactionWidth={interactionWidth}
    label={label}
    labelStyle={labelStyle}
    labelShowBg={labelShowBg}
    labelBgStyle={labelBgStyle}
    labelBgPadding={labelBgPadding}
    labelBgBorderRadius={labelBgBorderRadius}
  />
}
