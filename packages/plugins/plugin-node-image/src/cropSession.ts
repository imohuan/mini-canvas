/**
 * cropSession —— 图片节点「正在裁剪 / 正在扩展」的会话状态（组件本地态，**不写进节点 data**）。
 *
 * 为什么需要它：编辑浮层画在 overlay 段（BaseNode 卡片外面），而入口按钮在 top-toolbar 段——
 * 两者是 BaseNode 渲染出来的**兄弟组件**，只共享 nodeId。内核 data 是唯一跨组件通道，
 * 但把「正在裁剪」写进 data 有两个坏处：
 *   1. 会落盘。内核保存只过滤 data.transient/isTemp，_overlay 这类临时字段会被存下来，刷新后
 *      画布一开就停在裁剪模式（v1 靠宿主手动 strip，v2 没有这层）；
 *   2. 会进历史。进/退裁剪变成一个可撤销操作，撤销栈里会混进纯 UI 状态。
 *
 * 所以这里用一个「按 nodeId 记模式」的模块级响应式表：同包组件直接共享，出画布即消失。
 * 纯状态逻辑，无 DOM，node 可单测。
 *
 * 另一件放这里的是**未确认的草稿**（裁剪框 / 扩展框）：拖框的每一帧都写库会产生几百条
 * 撤销记录，用户按一次撤销只退回上一帧。草稿留在会话里，确认时一次性提交。
 */

import { reactive } from 'vue'

/** 编辑模式：裁剪（框在画面内）/ 扩展（框包住画面，往外扩画布） */
export type ImageEditMode = 'crop' | 'expand'

/** 节点 id → 当前模式（一个节点同时只可能在一种模式里） */
const modes = reactive(new Map<string, ImageEditMode>())

/** 当前处于某模式的节点 id（供测试与诊断；只读快照） */
export function editNodeIds(mode: ImageEditMode): string[] {
  return [...modes.entries()].filter(([, m]) => m === mode).map(([id]) => id)
}

/** 当前裁剪中的节点 id（保留旧名字，存量调用方零改动） */
export function croppingIds(): string[] {
  return editNodeIds('crop')
}

/** 该节点是否正在裁剪 */
export function isCropping(nodeId: string): boolean {
  return modes.get(nodeId) === 'crop'
}

/** 该节点是否正在扩展 */
export function isExpanding(nodeId: string): boolean {
  return modes.get(nodeId) === 'expand'
}

/** 该节点是否处于任一种编辑态（决定浮层与顶栏按钮组要不要切换） */
export function isEditing(nodeId: string): boolean {
  return modes.has(nodeId)
}

/** 进入某模式（幂等；进入一种自动退掉另一种，两个浮层不会同时出现） */
export function beginEdit(nodeId: string, mode: ImageEditMode): void {
  if (!nodeId) return
  modes.set(nodeId, mode)
}

/** 进入裁剪模式（幂等；保留旧名字，存量调用方零改动） */
export function beginCrop(nodeId: string): void {
  beginEdit(nodeId, 'crop')
}

/** 进入扩展模式（幂等） */
export function beginExpand(nodeId: string): void {
  beginEdit(nodeId, 'expand')
}

/** 退出编辑态（确认/取消/节点卸载都调它；幂等，草稿一并清掉）。旧名 endCrop 同义。 */
export function endEdit(nodeId: string): void {
  modes.delete(nodeId)
  drafts.delete(nodeId)
}

/** 退出编辑态（旧名字，存量调用方零改动） */
export function endCrop(nodeId: string): void {
  endEdit(nodeId)
}

/** 节点 id → 草稿（`{ _cropRect }` 或 `{ _expandRect }`） */
const drafts = reactive(new Map<string, Record<string, unknown>>())

/** 读草稿（没有返回空对象） */
export function editDraft(nodeId: string): Record<string, unknown> {
  return drafts.get(nodeId) ?? {}
}

/** 写草稿（整体替换；幂等） */
export function setEditDraft(nodeId: string, draft: Record<string, unknown>): void {
  if (!nodeId) return
  drafts.set(nodeId, { ...draft })
}

