/**
 * mediaPreview —— 全屏媒体预览的会话状态（module 级共享响应式，零 DOM）。
 *
 * 用户要求（2026-09-30）：素材卡点开预览时「要的是全屏，是整个视图」，
 * 不是缩在底栏那一小块里看。素材卡（底栏）与预览浮层是两个兄弟组件，只共享 ctx，
 * 故状态放这里 —— 与 cropSession / referenceMode 同一条理由（纯 UI 状态不该进节点 data）。
 */
import { ref } from 'vue'

/** 一个待预览的素材（只带渲染需要的字段） */
export interface PreviewItem {
  /** 素材名（标题栏显示） */
  name: string
  /** 素材来源节点 id（删除=断开它连出的线；无来源的老素材没有） */
  nodeId?: string
  /** 图片/视频地址 */
  url?: string
  /** 文本内容 */
  text?: string
  /** 媒体种类（决定用 img / video / 纯文本渲染） */
  kind: 'image' | 'video' | 'audio' | 'text'
  /**
   * 同组素材的地址（同类、有 url 的按底栏当前顺序）。
   * 交给 MediaViewer 的 `list` —— 预览里就自带 ← / → 切换与页码（它本来就支持）。
   */
  list?: string[]
  /** 当前这张在 list 里的下标（MediaViewer 用它决定先从第几张看起） */
  index?: number
  /** 与 list 一一对应的素材节点 id（删除时按「当前正在看的那张」找连线；可不给） */
  ids?: string[]
  /** 与 list 一一对应的素材名（切换后标题跟着换；可不给） */
  names?: string[]
}

const current = ref<PreviewItem | null>(null)
/** 预览是从哪个节点的底栏点开的（删除连线时找「素材 → 这个节点」用） */
let currentOwner = ''

/** 打开全屏预览（owner = 点开时所在节点的 id） */
export function openPreview(item: PreviewItem, owner?: string): void {
  current.value = item
  currentOwner = owner ?? ''
}

/** 预览发起节点的 id（没有返回空串） */
export function previewOwner(): string {
  return currentOwner
}

/** 关闭全屏预览（Esc / 点背景 / 关闭按钮都调它；幂等） */
export function closePreview(): void {
  current.value = null
  currentOwner = ''
}

/**
 * 记下「用户切到了 list 里的第几张」（MediaViewer 的 index 事件）。
 * 用户口径（2026-10-12）：多张图要能按 ← / → 切换 —— 切换后标题与删除按钮必须跟着当前那张走，
 * 所以把下标写回会话（而不是留在浮层里各算一份）。
 */
export function setPreviewIndex(i: number): void {
  const cur = current.value
  if (!cur?.list?.length) return
  const idx = Math.min(Math.max(i, 0), cur.list.length - 1)
  if (idx === (cur.index ?? 0)) return
  current.value = { ...cur, index: idx }
}

/** 当前正在看的那张（切换后就是新下标；没有 list 时就是它自己） */
export function currentPreview(): PreviewItem | null {
  const cur = current.value
  if (!cur?.list?.length) return cur
  const i = Math.min(Math.max(cur.index ?? 0, 0), cur.list.length - 1)
  return {
    ...cur,
    index: i,
    url: cur.list[i],
    ...(cur.ids?.[i] ? { nodeId: cur.ids[i] } : {}),
    ...(cur.names?.[i] ? { name: cur.names[i] } : {}),
  }
}

/** 当前预览项（null = 没在预览） */
export function previewItem(): PreviewItem | null {
  return current.value
}

/** 是否正在预览 */
export function previewActive(): boolean {
  return current.value !== null
}
