/** 节点默认卡片尺寸（宽 x 高，像素） */
export const DEFAULT_NODE_SIZE = {
  width: 256,
  height: 256,
} as const

/** 性能面板默认节点估算尺寸 */
export const DEFAULT_PERF_NODE_SIZE = {
  width: 180,
  height: 120,
} as const

/** 连线反馈 3D 倾斜角度（度） */
export const CONNECT_FEEDBACK = {
  rotateX: 18,
  rotateY: 18,
  /** 透视距离（px），值越小倾斜感越强 */
  perspective: 800,
  /** hover 时卡片放大系数 */
  scale: 1.018,
} as const
