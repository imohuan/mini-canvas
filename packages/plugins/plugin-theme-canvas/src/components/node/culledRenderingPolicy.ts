/**
 * culledRenderingPolicy —— 视口外节点绘制策略（纯逻辑，可单测）。
 *
 * 宿主经 data._cullState 下发节点可见状态（'visible' | 'culled' | 'culled-linked'；
 * transient 不下发），本模块把"状态 × 设置档"折叠成壳的绘制决策：
 * - reduced：内容段/控制栏/区域条是否不挂载（culledReduced）
 * - visibleCard：卡片本体是否可见（skeleton 隐身 / ghost 空心框 / full 原样）
 * 三档切换即时生效的前提是纯函数无内部状态 —— 状态变化由调用方 ref 驱动。
 */
export type CullState = 'visible' | 'culled' | 'culled-linked'
export type CulledRendering = 'skeleton' | 'full' | 'ghost'

export const CULLED_RENDERING_DEFAULT: CulledRendering = 'skeleton'

/** 非法值回落默认（settings 旁路写入的坏值兜底） */
export function normalizeCulledRendering(value: unknown): CulledRendering {
  return value === 'skeleton' || value === 'full' || value === 'ghost' ? value : CULLED_RENDERING_DEFAULT
}

export interface CulledPolicyResult {
  /** true = 内容段/控制栏/区域条/多选标记全部不挂载（骨架与 ghost 共用） */
  reduced: boolean
  /** true = 卡片本体可见（ghost 空心框；skeleton 隐身；full 恒可见） */
  visibleCard: boolean
  /** true = ghost 档生效（画可见空心占位框） */
  ghost: boolean
}

export function culledPolicy(state: unknown, rendering: CulledRendering): CulledPolicyResult {
  const culled = state === 'culled' || state === 'culled-linked'
  if (!culled || rendering === 'full') return { reduced: false, visibleCard: true, ghost: false }
  return { reduced: true, visibleCard: rendering === 'ghost', ghost: rendering === 'ghost' }
}
