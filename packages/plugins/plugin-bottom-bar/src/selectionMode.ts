/**
 * selectionMode —— 「参考选择」与「Ctrl 拖拽」共用的**唯一会话**。
 *
 * 用户口径（2026-10-28）：两种模式本来就是同一套选择态，只是触发方式不同：
 * - 点底栏「参考」= 进入参考模式，点击节点添加资源；
 * - 按住 Ctrl = 临时进入拖拽模式；
 * - 参考模式中按 Ctrl → 切到拖拽，松开 Ctrl 回到参考；
 * - 基础 UI 中按 Ctrl → 拖拽，松开回基础 UI。
 *
 * 因此状态只记两件事：参考开着没有、Ctrl 拖拽开着没有。
 * 显示优先级固定为：拖拽模式 > 参考模式 > 基础 UI。
 *
 * 为什么仍写 globalThis 并广播事件：发起方（底栏）与消费方（顶栏/节点盖层）
 * 可能来自不同模块实例（热重载 UMD 拷贝 vs bundle 拷贝），模块 ref 不共享。
 */
import { ref } from 'vue'

/** 选择态种类；null = 基础 UI */
export type SelectionMode = 'reference' | 'ctrl-drag'

/** 跨模块实例读取的一份快照 */
export interface SelectionSnapshot {
  active: boolean
  mode: SelectionMode | null
  /** 参考模式是否开着（Ctrl 拖拽时仍然保留） */
  reference: boolean
  /** Ctrl 拖拽是否正在进行 */
  dragging: boolean
  /** 当前宿主节点 id（拖拽优先） */
  owner: string
  epoch: number
}

/** 参考模式的宿主（null = 参考没开） */
const refOwner = ref<string | null>(null)
/** Ctrl 拖拽是否开着 */
const dragActive = ref(false)
/** Ctrl 拖拽的宿主 */
const dragOwner = ref('')
/** 每次状态变化 +1：顶栏/节点盖层据此重建悬停态 */
const epoch = ref(0)

/**
 * 「返回节点」在拖拽模式退出后，直到 Ctrl 松开前都不要自动弹回拖拽。
 * 存 globalThis：顶栏与底栏可能来自不同模块实例。
 */
function ctrlSuppressionKey(): string {
  return '__miniCanvasCtrlSuppressed'
}

export function suppressCtrlUntilRelease(): void {
  ;(globalThis as Record<string, unknown>)[ctrlSuppressionKey()] = true
}

export function ctrlSuppressed(): boolean {
  return (globalThis as Record<string, unknown>)[ctrlSuppressionKey()] === true
}

export function clearCtrlSuppression(): void {
  ;(globalThis as Record<string, unknown>)[ctrlSuppressionKey()] = false
}

function modeOf(): SelectionMode | null {
  if (dragActive.value) return 'ctrl-drag'
  return refOwner.value ? 'reference' : null
}

export function selectionMode(): SelectionMode | null {
  return modeOf()
}

export function selectionActive(): boolean {
  return modeOf() !== null
}

export function selectionOwner(): string {
  return dragActive.value ? dragOwner.value : (refOwner.value ?? '')
}

export function selectionEpoch(): number {
  return epoch.value
}

export function referenceActive(): boolean {
  return refOwner.value !== null
}

export function referenceOwner(): string | null {
  return refOwner.value
}

/** 兼容旧入口：参考与拖拽共用一个 epoch */
export function referenceEpoch(): number {
  return epoch.value
}

export function ctrlDragActive(): boolean {
  return dragActive.value
}

export function ctrlDragOwner(): string {
  return dragActive.value ? dragOwner.value : ''
}

/** 兼容旧入口：参考与拖拽共用一个 epoch */
export function ctrlDragEpoch(): number {
  return epoch.value
}

function snapshot(): SelectionSnapshot {
  const mode = modeOf()
  return {
    active: mode !== null,
    mode,
    reference: refOwner.value !== null,
    dragging: dragActive.value,
    owner: dragActive.value ? dragOwner.value : (refOwner.value ?? ''),
    epoch: epoch.value,
  }
}

/** 把状态写给跨模块实例 + 广播一次 */
function publish(): void {
  const s = snapshot()
  ;(globalThis as { __miniCanvasSelection?: SelectionSnapshot }).__miniCanvasSelection = s
  // 兼容旧拷贝/旧热重载模块：它们可能还在读这两个键
  ;(globalThis as { __miniCanvasRefSel?: { active: boolean; owner: string } }).__miniCanvasRefSel = {
    active: s.reference,
    owner: s.reference ? (refOwner.value ?? '') : '',
  }
  ;(globalThis as { __miniCanvasCtrlDrag?: { active: boolean; owner: string } }).__miniCanvasCtrlDrag = {
    active: s.dragging,
    owner: s.dragging ? dragOwner.value : '',
  }
  globalThis.dispatchEvent?.(new CustomEvent('mini-canvas:selection-mode'))
  // 旧事件名继续发：其它已编译的拷贝仍能收到（新代码只监听 selection-mode）
  globalThis.dispatchEvent?.(new CustomEvent('mini-canvas:reference-mode'))
  globalThis.dispatchEvent?.(new CustomEvent('mini-canvas:ctrl-drag-mode'))
}

/** 节点盖层用：优先读 globalThis 快照，拿不到才读本模块 ref */
export function readSelectionSnapshot(): SelectionSnapshot {
  const g = (globalThis as { __miniCanvasSelection?: SelectionSnapshot }).__miniCanvasSelection
  return g && typeof g === 'object' ? g : snapshot()
}

/** 进入参考模式（为 ownerId 这个节点选参考） */
export function enterReference(ownerId: string): void {
  if (!ownerId) return
  if (refOwner.value === ownerId) return
  refOwner.value = ownerId
  epoch.value += 1
  publish()
}

/** 只退出参考（Ctrl 拖拽若开着，保持拖拽） */
export function exitReference(): void {
  if (refOwner.value === null) return
  refOwner.value = null
  epoch.value += 1
  publish()
}

/** 切换参考：正在为 ownerId 选参考 → 退出；否则进入 */
export function toggleReference(ownerId: string): void {
  if (refOwner.value === ownerId) exitReference()
  else enterReference(ownerId)
}

/** 进入 Ctrl 拖拽模式（参考模式保留在下面） */
export function enterCtrlDragMode(ownerId: string): void {
  if (!ownerId) return
  dragOwner.value = ownerId
  dragActive.value = true
  epoch.value += 1
  publish()
}

/** 退出 Ctrl 拖拽：有参考就自然回到参考，没有就回基础 UI */
export function exitCtrlDragMode(): void {
  if (!dragActive.value) return
  dragActive.value = false
  dragOwner.value = ''
  epoch.value += 1
  publish()
}

/** 完全退出选择态（Esc / 关闭 / 底栏消失） */
export function exitSelection(): void {
  if (refOwner.value === null && !dragActive.value) return
  refOwner.value = null
  dragActive.value = false
  dragOwner.value = ''
  epoch.value += 1
  publish()
}

/**
 * 选择态是否还该留着（纯判定，Node 可测）。
 *
 * 用户 2026-10-28 真机复现的 bug：以前这里写成「必须恰好单选宿主」，而按 Ctrl 进拖拽、
 * 拖动资源时选中集本来就会短暂变化 —— 每帧判一次就把刚进入的拖拽模式关掉，
 * 表现是「按 Ctrl 完全没反应」。正确语义只有一条：**宿主不在选中集里才收**。
 */
export function shouldKeepSelection(input: {
  /** 当前选中节点 id 集合 */
  selected: ReadonlySet<string>
  /** 选择态宿主（参考/拖拽的发起节点） */
  owner: string
}): boolean {
  if (!input.owner) return false
  return input.selected.has(input.owner)
}

