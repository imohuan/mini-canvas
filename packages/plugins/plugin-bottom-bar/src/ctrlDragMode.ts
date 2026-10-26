/**
 * ctrlDragMode —— Ctrl 拖拽选择态的会话状态（module 级共享响应式）。
 *
 * 用户口径（2026-10-26）：按住 Ctrl（底栏开着）= 进入类似「参考选择」的选择态：
 * 画布上可拖的资源节点高亮（紫描边+角标）、已连接的显示提醒（禁止拖拽）、
 * 拖拽本身是"从可选节点按下开始拖"，与参考选择的"点击"同一套视觉语言。
 *
 * 与 referenceMode（参考按钮会话）互相独立：两个会话不共存，但视觉/结构刻意保持一致。
 */
import { ref } from 'vue'

export type CtrlDragNodeState = 'owner' | 'selectable' | 'connected' | 'blocked'

const active = ref(false)
/** 发起节点（底栏宿主） */
const owner = ref('')
/** 会话代数：每次进入 +1（组件据此重建悬停态等） */
const epoch = ref(0)

export function ctrlDragActive(): boolean {
  return active.value
}
export function ctrlDragOwner(): string {
  return active.value ? owner.value : ''
}
export function ctrlDragEpoch(): number {
  return epoch.value
}
/** 进入 Ctrl 拖选择态（owner = 底栏宿主节点） */
export function enterCtrlDragMode(ownerId: string): void {
  owner.value = ownerId
  active.value = true
  epoch.value += 1
  ;(globalThis as { __miniCanvasCtrlDrag?: { active: boolean; owner: string } }).__miniCanvasCtrlDrag = { active: true, owner: ownerId }
  globalThis.dispatchEvent?.(new CustomEvent('mini-canvas:ctrl-drag-mode'))
}
/** 退出（幂等） */
export function exitCtrlDragMode(): void {
  if (!active.value) return
  active.value = false
  epoch.value += 1
  ;(globalThis as { __miniCanvasCtrlDrag?: { active: boolean; owner: string } }).__miniCanvasCtrlDrag = { active: false, owner: '' }
  globalThis.dispatchEvent?.(new CustomEvent('mini-canvas:ctrl-drag-mode'))
}

/** 节点在 Ctrl 拖选择态里的面孔（复用参考选择的状态语义） */
export function ctrlDragNodeState(input: {
  isOwner: boolean
  isMedia: boolean
  connected: boolean
}): CtrlDragNodeState {
  if (input.isOwner) return 'owner'
  if (!input.isMedia) return 'blocked'
  return input.connected ? 'connected' : 'selectable'
}

/** 盖层悬停提醒（connected 的提醒 = 用户口径：已连接的要有提醒） */
export function ctrlDragHintText(state: CtrlDragNodeState, title: string): string {
  if (state === 'connected') return '已连接 · 不可重复拖拽'
  if (state === 'selectable') return '按住拖到参考格 ' + title
  return ''
}
