/**
 * slotComposer —— SlotComposer / SlotAnchor 的纯逻辑协议（零 Vue）。
 *
 * 两个名字的含义：
 * - SlotComposer：把「宿主内置 UI」与「插件注册的 UI」合成一个有序序列的父组件；
 * - SlotAnchor：宿主内置 UI 的稳定锚点，声明 id / order / before / after。
 *
 * id 规范与判定统一走 @mini-canvas/kernel 的 naming 模块（全仓唯一事实源）：
 * - 槽名用点：shell.dock、shell.status、shell.drawer.tabs
 * - 条目 id 用斜杠：owner/name，例如 host/agent、my-plugin/export
 * - host/ 前缀保留给宿主内置项
 */
export { isSlotItemId, isSlotName } from '@mini-canvas/kernel'

/** 宿主锚点或插件条目的最小排序描述 */
export interface SlotComposerEntry {
  /** 槽内条目 id（owner/name） */
  id: string
  order?: number
  /** 排在该条目之前（槽内条目 id） */
  before?: string
  /** 排在该条目之后（槽内条目 id） */
  after?: string
}

/** 合并时本地锚点在前：同 id 时宿主赢，插件不能顶掉内置按钮 */
export function mergeSlotEntries<T>(anchors: readonly T[], plugins: readonly T[]): T[] {
  return [...anchors, ...plugins]
}
