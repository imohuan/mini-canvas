/**
 * referenceMode —— 底栏顶行「参考」按钮引发的**选择态**会话状态与纯判定。
 *
 * 用户要的语义（照 LibTV 参考站实测 + 用户口述）：
 * 点「参考」→ 整个画布进入**选择态**：顶上浮出一条操作框；画布上的节点里，
 * 只有**能被当前节点接收**的那些变可点（悬停出提示），其余压成灰色半透明；
 * 点一个可选节点 = 把它连到当前节点（建立链接），它随即作为素材出现在底栏素材区里。
 *
 * 「参考」是一个**开关**（用户实测反馈「点击之后就无法取消」）：
 * 再点一次收起；点顶栏「返回节点」也相当于结束参考。
 *
 * 为什么判定要放在这个零 DOM 的模块里：
 * 「谁能连谁」的答案**不是**本插件发明的 —— 它是节点类型自己声明的
 * （输出口产出什么内容类型 / 输入口收哪些内容类型，见 canvas-data 的 PortDef）。
 * 这里只把那份声明读成一句布尔，于是加一个新节点类型不需要动本文件一行。
 *
 * 与内核「缺省即全收」保持同一套语义（见 canvas/connection.ts 的 validateConnection）：
 * 目标没声明 acceptsTypes = 来者不拒；源没声明产出内容类型 = 不知道它产出什么，不能当参考。
 */
import { ref } from 'vue'

/** 端口的能力声明（内核 PortDef 的子集；只取本判定要用的两件） */
export interface PortLike {
  /** 输入口接受的内容类型列表 */
  acceptsTypes?: string[]
  /** 输出口产出的内容类型 */
  contentType?: string
}

/** 节点类型的能力声明（内核 CanvasNodeType 的子集） */
export interface NodeTypeLike {
  inputs?: PortLike[]
  outputs?: PortLike[]
}

/** 源节点产出的内容类型：取第一个声明了 contentType 的输出口；不产出任何东西 → undefined */
export function outputKindOf(type: NodeTypeLike | undefined): string | undefined {
  for (const port of type?.outputs ?? []) {
    if (typeof port.contentType === 'string' && port.contentType) return port.contentType
  }
  return undefined
}

/** 目标节点输入口声明接受的内容类型集合（去重，保声明序） */
export function inputAcceptsOf(type: NodeTypeLike | undefined): string[] {
  const out = new Set<string>()
  for (const port of type?.inputs ?? []) {
    for (const kind of port.acceptsTypes ?? []) out.add(kind)
  }
  return [...out]
}

/**
 * 该源节点能不能作为参考连进目标节点。
 *
 * - 源不产出任何内容类型 → 不能（它没有东西可以当参考）；
 * - 目标没声明任何 acceptsTypes → 能（内核「缺省即全收」的同一套口径）；
 * - 否则要求源的产出内容类型 ∈ 目标接受集。
 */
export function canReference(
  sourceType: NodeTypeLike | undefined,
  ownerType: NodeTypeLike | undefined,
): boolean {
  const kind = outputKindOf(sourceType)
  if (kind === undefined) return false
  const accepts = inputAcceptsOf(ownerType)
  if (accepts.length === 0) return true
  return accepts.includes(kind)
}

/** 选择态里一个节点当前的四种面孔 */
export type ReferenceNodeState =
  /** 就是当前节点自己：不铺盖层、保持原样（顶栏另给「返回节点」） */
  | 'owner'
  /** 可以当参考：透明盖层 + 悬停提示 + 点击建立链接 */
  | 'selectable'
  /** 已经是当前节点的参考：点它解除 */
  | 'connected'
  /** 本节点收不了它：灰掉（半透明灰罩），不可点 */
  | 'blocked'

/** 一个节点在选择态里该显示成什么（纯函数，Node 可测） */
export function referenceNodeState(input: {
  isOwner: boolean
  /** 它能不能连进当前节点（canReference 的结果） */
  canReference: boolean
  /** 它现在是不是已经连着当前节点 */
  connected: boolean
}): ReferenceNodeState {
  if (input.isOwner) return 'owner'
  if (!input.canReference) return 'blocked'
  return input.connected ? 'connected' : 'selectable'
}

/** 盖层上那句话（空字符串 = 不显示） */
export function referenceHintText(state: ReferenceNodeState, title: string): string {
  if (state === 'connected') return '取消选择 ' + title
  if (state === 'selectable') return '选择 ' + title
  return ''
}

/**
 * 「点一下这个节点」要做的事（纯决策，Node 可测；真正落地由组件调 doc 完成）。
 *
 * - connected → 'disconnect'：解除链接（用户要的「取消选择」）；
 * - selectable → 'connect'：建立链接（用户要的「点哪个哪个就连上」）；
 * - owner / blocked → 'none'：什么都不做。
 */
export type ReferencePickAction = 'connect' | 'disconnect' | 'none'

export function referencePickAction(state: ReferenceNodeState): ReferencePickAction {
  if (state === 'connected') return 'disconnect'
  if (state === 'selectable') return 'connect'
  return 'none'
}

// ==================== 会话（module 级共享响应式） ====================
//
// 为什么用 module 级状态而不是服务：发起方（底栏的「参考」按钮）与消费方（画布浮层）
// 是两个兄弟组件，只共享 ctx。把「正在选参考」写进节点 data 会落盘、还会变成一条可撤销操作
// （纯 UI 状态混进撤销栈）—— 与 plugin-node-image 的 cropSession 同一条理由。

/** 当前正在为哪个节点选参考（null = 不在选择态） */
const owner = ref<string | null>(null)
/** 每次进入选择态自增：浮层据此重置本地态（例如已展示过的悬停提示） */
const epoch = ref(0)

/** 进入选择态（为 ownerId 这个节点选参考） */
export function enterReference(ownerId: string): void {
  if (!ownerId) return
  owner.value = ownerId
  epoch.value += 1
}

/** 退出选择态（再点一次「参考」、点「返回节点」、Esc、点 ✕ 都调它；幂等） */
export function exitReference(): void {
  owner.value = null
}

/** 切换：正在为 ownerId 选参考 → 退出；否则进入（「参考」按钮的两态） */
export function toggleReference(ownerId: string): void {
  if (owner.value === ownerId) exitReference()
  else enterReference(ownerId)
}

/** 当前选择态的宿主节点 id（响应式：组件里放进 computed 即可跟随） */
export function referenceOwner(): string | null {
  return owner.value
}

/** 是否正在选择态 */
export function referenceActive(): boolean {
  return owner.value !== null
}

/** 进入次数（浮层用：变化即重置本地态） */
export function referenceEpoch(): number {
  return epoch.value
}

// ==================== 「返回节点」的聚焦 ====================

/** 聚焦时"太小看不清"的阈值：低于它才把缩放抬上来，否则保持用户当前的阅读尺度 */
export const FOCUS_MIN_ZOOM = 0.6
/** 低于阈值时抬到的缩放（= 100%，节点以自然大小呈现） */
export const FOCUS_ZOOM = 1

/**
 * 聚焦某节点时的目标缩放（纯函数，Node 可测）。
 *
 * 规则只有一条：当前缩放小于阈值（节点显得太小）才抬到 100%；否则**原样保留**——
 * 用户正放大看细节时，点一下「返回节点」不该把他的阅读尺度也重置掉。
 */
export function resolveFocusZoom(currentZoom: number): number {
  const z = Number.isFinite(currentZoom) && currentZoom > 0 ? currentZoom : 1
  return z < FOCUS_MIN_ZOOM ? FOCUS_ZOOM : z
}

/** 聚焦的目标视口（中心点 + 缩放）：把节点矩形中心移到屏幕中心 */
export function focusViewportFor(
  rect: { x: number; y: number; w: number; h: number },
  currentZoom: number,
): { x: number; y: number; zoom: number } {
  return {
    x: rect.x + rect.w / 2,
    y: rect.y + rect.h / 2,
    zoom: resolveFocusZoom(currentZoom),
  }
}

