/**
 * videoSession —— "这个节点正在裁剪 / 正在剪辑"的会话状态（组件本地态，**不写进节点 data**）。
 *
 * 与图片节点的 cropSession 同一个理由：裁剪/剪辑的入口按钮在 top-toolbar 段、覆盖层在 content 段，
 * 两者是 BaseNode 渲染出来的**兄弟组件**，只共享 nodeId。内核 data 是唯一跨组件通道，
 * 但把"正在裁剪"写进 data 有两个坏处：
 *   1. 会落盘 —— 刷新后画布一开就停在裁剪模式，用户连节点都拖不动；
 *   2. 会进历史 —— 进/退裁剪变成一个可撤销操作，撤销栈里混进纯 UI 状态。
 *
 * 所以用"按 nodeId 记名字"的模块级响应式集合：同包组件直接共享，出画布即消失。
 * 一个节点同时只可能在一种模式里（进入一种自动退掉另一种），避免两个覆盖层叠在一起。
 *
 * 另一件必须放在会话里的东西：**未确认的草稿**（裁剪框 / 剪辑范围）。
 * 拖裁剪框的每一帧都写库会产生几百条撤销记录，用户按一次撤销只会退回上一帧。
 * 草稿留在会话里，确认时一次性提交 —— 这才是"一次操作一条历史"。
 */
import { reactive } from 'vue'

/**
 * 覆盖层模式。
 * - crop：裁剪画面（框必须在画面内）
 * - clip：剪辑时长（时间轴，不走画面浮层）
 */
export type VideoOverlayMode = 'crop' | 'clip'

/** 节点 id → 当前模式 */
const modes = reactive(new Map<string, VideoOverlayMode>())

/** 当前处于某模式的节点 id（供测试与诊断） */
export function overlayNodeIds(mode: VideoOverlayMode): string[] {
  return [...modes.entries()].filter(([, m]) => m === mode).map(([id]) => id)
}

/** 该节点当前在哪个模式（不在任何模式返回 null） */
export function overlayModeOf(nodeId: string): VideoOverlayMode | null {
  return modes.get(nodeId) ?? null
}

/** 该节点是否正在裁剪 */
export function isCropping(nodeId: string): boolean {
  return modes.get(nodeId) === 'crop'
}

/** 该节点是否正在剪辑 */
export function isClipping(nodeId: string): boolean {
  return modes.get(nodeId) === 'clip'
}

/** 进入某模式（幂等；进入一种自动退掉另一种，两个覆盖层不会同时出现） */
export function beginOverlay(nodeId: string, mode: VideoOverlayMode): void {
  if (!nodeId) return
  modes.set(nodeId, mode)
}

/** 节点 id → 覆盖层草稿 */
const drafts = reactive(new Map<string, Record<string, unknown>>())

/** 读某节点的覆盖层草稿（没有返回空对象） */
export function overlayDraft(nodeId: string): Record<string, unknown> {
  return drafts.get(nodeId) ?? {}
}

/** 写覆盖层草稿（整体替换；幂等） */
export function setOverlayDraft(nodeId: string, draft: Record<string, unknown>): void {
  if (!nodeId) return
  drafts.set(nodeId, { ...draft })
}

/** 退出模式（确认/取消/节点卸载都调它；幂等，草稿一并清掉） */
export function endOverlay(nodeId: string): void {
  modes.delete(nodeId)
  drafts.delete(nodeId)
}
