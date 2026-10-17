/**
 * node-ui 调试态事件总线（模块级、零依赖）。
 *
 * 为什么需要：调试连接建立后，标题右侧的「调试」标签（titleExtraSlot 组件）要随
 * 调试过程实时变化 —— 连接建立、收到 eval、执行结果。UiContent（持有调试链路）
 * 在这些时机发事件；DebugBadge 组件订阅同一总线更新自己。
 *
 * 事件形状：{ nodeId, kind: 'connected' | 'eval' | 'error' | 'disconnected', detail?: string }
 */
export type UiDebugEvent = {
  nodeId: string
  kind: 'connected' | 'eval' | 'result' | 'error' | 'disconnected'
  detail?: string
  at: number
}

type Listener = (e: UiDebugEvent) => void

const listeners = new Set<Listener>()

export function subscribeUiDebugEvents(l: Listener): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

/** 某节点的最近一次调试事件（新挂载的标签立即恢复显示，不等下一次事件） */
let lastByNode = new Map<string, UiDebugEvent>()
export function lastUiDebugEvent(nodeId: string): UiDebugEvent | undefined {
  return lastByNode.get(nodeId)
}
export function emitUiDebugEvent(e: Omit<UiDebugEvent, 'at'>): void {
  const full: UiDebugEvent = { ...e, at: Date.now() }
  lastByNode.set(e.nodeId, full)
  for (const l of listeners) {
    try { l(full) } catch { /* ignore */ }
  }
}
