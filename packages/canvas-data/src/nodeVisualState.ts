/**
 * nodeVisualState —— 节点卡片「外观状态」的**唯一三态契约**（纯逻辑，零 Vue / 零 DOM）。
 *
 * 用户口径 2026-11-09：「节点有三个状态：错误 / 加载中 / 加载成功」，并且要是全局性的。
 * 所以这里把三种状态定死，所有消费方（节点壳、顶部/底部状态栏、加载覆盖层、视频播放拦截）
 * 都问同一个函数，不再各写一份「status 是不是 running」的判定。
 *
 * 数据来源仍是 `node.data.runState.status`（底部状态栏 / 云后台写进去的同一把 key）：
 * - running → 加载中
 * - error   → 错误
 * - 其余（done / idle / 缺失 / 脏值）→ 加载成功（可正常显示与交互）
 *
 * 为什么不直接暴露 raw status：任务有一种「失败但仍可操作」的语义（error），
 * 而壳只关心「卡上有没有盖着东西」。中间加一层三态，壳不必认识 running/done/idle 的区别。
 */

/** 节点卡片的三种外观状态 */
export type NodeVisualState = 'loading' | 'error' | 'ready'

/** 与 nodeRunState 同口径的最小形状 */
export interface NodeVisualStateLike {
  data?: unknown
}

/**
 * 读节点的三态。
 *
 * 缺 data / 缺 runState / 非法值一律 ready（不抛）：渲染层每帧都会问它，
 * 一个坏值不该让整张卡变成「加载中」或「错误」。
 */
export function readNodeVisualState(node: NodeVisualStateLike | undefined | null): NodeVisualState {
  const data = node?.data as Record<string, unknown> | undefined | null
  const runState = data?.runState as { status?: unknown } | undefined | null
  const status = runState?.status
  if (status === 'running') return 'loading'
  if (status === 'error') return 'error'
  return 'ready'
}

/** 卡上是否盖着覆盖层（加载中或错误）—— 壳据此收起 resize 把手、放行覆盖层 */
export function isNodeCovered(node: NodeVisualStateLike | undefined | null): boolean {
  return readNodeVisualState(node) !== 'ready'
}
