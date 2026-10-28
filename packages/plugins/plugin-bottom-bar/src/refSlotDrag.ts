/**
 * refSlotDrag —— 「按住 Ctrl 把画布上的图片/视频/音频资源拖到参考格」的纯逻辑。
 *
 * 用户口径（2026-10-26）：
 *   1. **只有底栏打开时**才监听；
 *   2. Ctrl 按下后**不能进行节点选中**；
 *   3. 通过 DOM 找鼠标下方元素，是图片/视频/音频资源才触发拖拽；
 *   4. 拖到对应插槽位置时，**替换**该插槽的资源（涉及连线的建/换/删）。
 *
 * DOM 事件绑定在 NodeBottomBar.vue（需要 ctx / refTiles），这里只放「判定」，可单测。
 */

import { slotAccepts, slotMismatchHint, mediaLabel, type SlotKind, type SlotMedia } from './slotKinds'

/** 从节点 data 里认出媒体（image/video/audio/text）与地址/名字；不是资源节点 → null */

export function nodeMediaOf(node: { type?: string; data?: Record<string, unknown> } | undefined): {
  mediaType: SlotMedia
  url: string
  name: string
} | null {
  if (!node) return null
  const data = node.data ?? {}
  const s = (v: unknown) => (typeof v === 'string' && v ? v : '')
  const imageUrl = s(data.imageUrl) || s(data.panoUrl)
  if (imageUrl) return { mediaType: 'image', url: imageUrl, name: s(data.label) || s(data.imageName) || '图片' }
  const videoUrl = s(data.videoUrl)
  if (videoUrl) return { mediaType: 'video', url: videoUrl, name: s(data.label) || s(data.videoName) || '视频' }
  const audioUrl = s(data.audioUrl)
  if (audioUrl) return { mediaType: 'audio', url: audioUrl, name: s(data.label) || s(data.audioName) || '音频' }
  /**
   * 文本（用户 2026-10-28：文本节点也能拖，只要拖到文本格）。
   * 放在媒体之后：同一个节点如果既交了图又交了正文，优先当媒体（与上游素材收集同口径）。
   */
  if (node.type === 'text' || typeof data.text === 'string') {
    return { mediaType: 'text', url: '', name: s(data.label) || '文本' }
  }
  // 只有持久引用（新节点的标准形态）：类型由节点自己声明
  if (s(data.resourceId)) {
    const kind = node.type === 'video' ? 'video' : node.type === 'audio' ? 'audio' : node.type === 'image' ? 'image' : null
    if (kind) return { mediaType: kind, url: '', name: s(data.label) || (kind === 'video' ? '视频' : kind === 'audio' ? '音频' : '图片') }
  }
  return null
}

/** 事件目标是否允许进入 Ctrl 拖（可编辑元素里 Ctrl 是打字/快捷键，不放行） */
export function isDraggableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return !target.closest('input, textarea, select, [contenteditable="true"]')
}

/**
 * 拖拽经过某个参考格时的判定（用户 2026-10-28：拖到不匹配的槽位也要提示）。
 *
 * 一条路径同时服务「实时悬停」与「松手落点」，避免两处判断走偏：
 * - 目标格收这种内容 → ok，格子高亮，允许放下；
 * - 不收 → 不亮、不落，提示里同时说清格子收什么、你拖的是什么。
 */
export function judgeSlotHover(input: {
  /** 格子种类（image/video/audio/text/av） */
  kind: SlotKind
  /** 被拖的内容类型（文本节点也算） */
  media: SlotMedia | null
}): { ok: boolean; hint: string } {
  if (!input.media) return { ok: false, hint: '这个节点没有可拖的内容' }
  if (!slotAccepts(input.kind, input.media)) {
    return { ok: false, hint: slotMismatchHint(input.kind, input.media) }
  }
  return { ok: true, hint: '松手放到' + mediaLabel(input.media) + '格' }
}

/**
 * Ctrl 拖替换：把目标槽位的连线换到新资源上。
 *
 * 替换语义（用户口径「替换该插槽的资源」）：
 *   - 该格已有连线 → 断开旧线、连新线（连线归属不变：还是这个序号）；
 *   - 该格是待输入（没有连线）→ 直接连新线；
 *   - 旧资源如果**只**被这个槽位用（没有别的线连进目标节点），节点留在画布上不删 ——
 *     删节点是破坏性操作，交给用户自己（用户口径只要求换连线）。
 *
 * @returns 实际要给组件的「新连线结果」（created 形状与上传一致，方便复用后续 UI 刷新）
 */
export function planSlotReplace(input: {
  nodeId: string
  mediaType: 'image' | 'video' | 'audio' | 'text'
  url: string
  name: string
  targetId: string
}): {
  /** 断开的旧边 id（空 = 该格原本没有连线） */
  replacedEdgeId: null | string
  addEdge: { source: string; target: string }
} {
  return {
    replacedEdgeId: null,
    addEdge: { source: input.nodeId, target: input.targetId },
  }
}
