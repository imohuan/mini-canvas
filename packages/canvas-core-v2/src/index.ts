// canvas-core-v2 — Cordis 风格画布引擎内核
//
// M1:最小内核(Scope + Context + topo + 类型化事件)
// M4:tracer bullet 全链 demo(services + text 插件 + host)
// M1(浏览器):localStorage adapter + image 插件 + CanvasDemo(vite 演示)

export * from './core'
export * from './services'
// 边几何纯算法（渲染层 CustomEdge 经本包子路径 import；留内核，见 docs/plan/canvas-render-layer-plan.md）。
export {
  Position,
  normalizePosition,
  getSourcePosition,
  getTargetPosition,
  buildEdgePath,
  sampleEdgePath,
  findClosestPointOnPath,
} from './contracts/edgeGeometry'
export type {
  EdgeType,
  XYPosition,
  EdgeAppearance,
} from './contracts/edgeGeometry'
