/**
 * slotComposer —— SlotComposer / SlotAnchor 的纯逻辑协议（零 Vue）。
 *
 * 两个名字的含义：
 * - SlotComposer：把「宿主内置 UI」与「插件注册的 UI」合成一个有序序列的父组件；
 * - SlotAnchor：宿主内置 UI 的稳定锚点，声明 id / order / before / after。
 *
 * id 规范（与槽名分开，避免把 "shell.dock.agent" 误当成条目 id）：
 * - 槽名用点：shell.dock、shell.status、shell.drawer.tabs；
 * - 条目 id 用斜杠：owner/name，例如 host/agent、host/add、my-plugin/export；
 * - host/ 前缀保留给宿主内置项。
 */

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

/** 条目 id 必须是 owner/name（只用斜杠分隔，不用点） */
export function isSlotItemId(id: string): boolean {
  return /^[A-Za-z0-9_.@:-]+\/[A-Za-z0-9_.@:-]+$/.test(id)
}

/** 槽名必须是点分形式（不出现斜杠）；单段也允许，例如 overlay */
export function isSlotName(name: string): boolean {
  return name.length > 0 && !name.includes('/')
}

/** 合并时本地锚点在前：同 id 时宿主赢，插件不能顶掉内置按钮 */
export function mergeSlotEntries<T>(anchors: readonly T[], plugins: readonly T[]): T[] {
  return [...anchors, ...plugins]
}
