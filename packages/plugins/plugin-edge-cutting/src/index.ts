// plugin-edge-cutting —— 连接线切割插件：按住 Alt 拖拽"刀光"划过连接线即可将其删除（可撤销）。
export { edgeCuttingPlugin, name, apply } from './edgeCuttingPlugin'
export type { EdgeCuttingOptions } from './edgeCuttingPlugin'
export {
  isPolylineHitByCut,
  doSegmentsIntersect,
  segmentDistance,
} from './geometry'
export type { ScreenPoint } from './geometry'
export {
  DEFAULT_TOLERANCE_PX,
  DEFAULT_SAMPLE_STEP_PX,
  TRAIL_POINTS,
  BLADE_POINTS,
  filterHitEdges,
  bladeOnly,
  rectsOverlap,
  toPathData,
  cssEscape,
  edgePathSelectors,
} from './edgeCuttingCore'
export { EdgeCuttingOverlay } from './edgeCuttingOverlay'
export type { BladeStyle } from './edgeCuttingOverlay'
