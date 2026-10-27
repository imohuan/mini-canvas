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

/**
 * Ctrl 键按下时，要不要进入选择态（纯判定，Node 可测）。
 *
 * 用户口径（2026-10-27）：**只有底栏真的显示**才触发。
 *
 * 这里刻意喂 `barShown`（底栏本体是否渲染），不喂「有没有选中节点」或
 * 「画布上有没有 .nb-overlay 外壳」—— 可视化节点（type='ui'）没有任何底栏动作，
 * 但它的 overlay 外壳照样存在（NodeBottomBarOverlay 只判单选）。把外壳当底栏
 * 就会在可视化节点上误触（真机复现过）。
 */
export function canEnterCtrlDragMode(input: {
  /** 按下的键（KeyboardEvent.key） */
  key: string
  /** 是否是按住不放的重复 keydown */
  repeat: boolean
  /** 当前节点的底栏本体是否真的渲染（.nb-root 在、且不是空壳） */
  barShown: boolean
  /** 参考选择态是否已在进行（两个会话不共存） */
  referenceActive: boolean
  /** 焦点是否在输入/可编辑区（那里 Ctrl 是文本快捷键） */
  editableTarget: boolean
}): boolean {
  if (input.key !== 'Control' || input.repeat) return false
  if (!input.barShown) return false
  if (input.referenceActive) return false
  if (input.editableTarget) return false
  return true
}

/**
 * 拖拽启动的**对象数据通道**：覆盖层（长在节点里）拿到 props.id/props.data 的对象数据，
 * 直接调用这里注册的处理器发起拖拽 —— 不再走 window pointerdown + DOM closest 判定
 * （用户口径：DOM 判定会误触节点选中）。
 * 处理器由底栏宿主注册（影子/全局监听都在它那里）。
 */
type StartDragHandler = (nodeId: string, ev: PointerEvent) => void
let startDragHandler: StartDragHandler | null = null
export function registerStartDragHandler(h: StartDragHandler | null): void {
  startDragHandler = h
}
export function requestStartDrag(nodeId: string, ev: PointerEvent): boolean {
  if (!startDragHandler) return false
  startDragHandler(nodeId, ev)
  return true
}

/** 盖层悬停提醒（connected 的提醒 = 用户口径：已连接的要有提醒） */
export function ctrlDragHintText(state: CtrlDragNodeState, title: string): string {
  if (state === 'connected') return '已连接 · 不可重复拖拽'
  if (state === 'selectable') return '按住拖到参考格 ' + title
  return ''
}
