/**
 * refSlots —— 底栏「参考标签」的纯逻辑（零 DOM、零 Vue，node 可单测）。
 *
 * 用户口径（2026-10-28 定案，替换掉旧的「类型 + 序号」槽位模型）：
 *
 *   1. 标签身份 = **绑定的节点 id**（`ref-node:<id>`）；显示名 = 节点名称；
 *   2. 还没绑定的手打标签 = `ref-name:<名称>`，名称就是身份；
 *   3. 名称在画布内唯一，所以按名称找节点永远只会命中一个；
 *   4. 序号只用来观察顺序，**不参与任何判定**；
 *   5. 旧格式 `ref-slot:<kind>:<N>` 不兼容 —— 按失效处理，用户重新标记一次。
 *
 * 这里只放「认标签 / 判落点」两件事，DOM 与交互在 NodeBottomBar.vue。
 */

import { SLOT_KIND_META, slotAccepts as slotAcceptsKind, slotAcceptsLabel, slotMismatchHint, type SlotKind, type SlotMedia } from './slotKinds'

/** 参考格种类；`any` = 手打的待绑定标签（还不知道类型） */
export type RefSlotKind = SlotKind

/** 各类槽位的中文名与上传时该允许的文件类型（唯一来源 = slotKinds.ts） */
export const REF_SLOT_META = SLOT_KIND_META

/** 标签身份前缀（与编辑器侧同一套字符串，改动要两边一起改） */
export const REF_NODE_PREFIX = 'ref-node:'
export const REF_NAME_PREFIX = 'ref-name:'
/** 老格式前缀：只用来认出来并标成失效 */
export const LEGACY_SLOT_PREFIX = 'ref-slot:'

export function refNodeChipId(nodeId: string): string {
  return REF_NODE_PREFIX + String(nodeId ?? '')
}

export function refNameChipId(name: string): string {
  return REF_NAME_PREFIX + String(name ?? '').trim()
}

/** 标签 id → 绑定的节点 id（不是绑定标签 → null） */
export function nodeIdOfChip(chipId: string | null | undefined): string | null {
  const s = String(chipId ?? '')
  if (!s.startsWith(REF_NODE_PREFIX)) return null
  const id = s.slice(REF_NODE_PREFIX.length)
  return id || null
}

/** 标签 id → 待绑定名称（不是待绑定标签 → null） */
export function nameOfChip(chipId: string | null | undefined): string | null {
  const s = String(chipId ?? '')
  if (!s.startsWith(REF_NAME_PREFIX)) return null
  const name = s.slice(REF_NAME_PREFIX.length).trim()
  return name || null
}

/** 正文里的一颗参考标签 */
export interface RefChip {
  /** 标签 id：ref-node:<id> / ref-name:<名> / 老格式 ref-slot:* */
  id: string
  /** 正文里显示的名称（绑定标签以它为准刷新） */
  name: string
  /** 绑定的节点 id（待绑定 / 老格式 → null） */
  nodeId: string | null
  /** 待绑定名称（绑定标签 → null） */
  pendingName: string | null
  /** 老格式标签：不兼容，按失效处理 */
  legacy: boolean
}

/**
 * 从**富文本 doc JSON** 里取出参考标签（按出现顺序）。
 *
 * 只认真正的标签节点：正文里手打的 `@名字` 文字不算声明（用户 2026-10-27 口径，
 * 不然残留文字会凭空撑出卡片）。
 */
export function refChipsFromDoc(doc: unknown): RefChip[] {
  const root = doc as { type?: unknown; content?: unknown } | null | undefined
  if (!root || root.type !== 'doc' || !Array.isArray(root.content)) return []
  const out: RefChip[] = []
  const walk = (nodes: unknown[]): void => {
    for (const n of nodes) {
      const node = n as { type?: string; attrs?: { id?: unknown; name?: unknown }; content?: unknown } | null
      if (!node || typeof node !== 'object') continue
      if (node.type === 'resource') {
        const id = typeof node.attrs?.id === 'string' ? node.attrs.id : ''
        const name = typeof node.attrs?.name === 'string' ? node.attrs.name : ''
        if (id.startsWith(REF_NODE_PREFIX)) {
          out.push({ id, name, nodeId: nodeIdOfChip(id), pendingName: null, legacy: false })
        } else if (id.startsWith(REF_NAME_PREFIX)) {
          out.push({ id, name: name || (nameOfChip(id) ?? ''), nodeId: null, pendingName: nameOfChip(id), legacy: false })
        } else if (id.startsWith(LEGACY_SLOT_PREFIX)) {
          out.push({ id, name, nodeId: null, pendingName: null, legacy: true })
        }
      }
      if (Array.isArray(node.content)) walk(node.content)
    }
  }
  walk(root.content)
  return out
}

/** 扩展名兜底（有些系统给不出 MIME） */
const EXT_KIND: Array<['image' | 'video' | 'audio', string[]]> = [
  ['image', ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'svg']],
  ['video', ['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v']],
  ['audio', ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus']],
]

/** 文件 / 节点 → 媒体类型（image / video / audio / null） */
export function mediaTypeOf(input: { name?: string; type?: string } | undefined): 'image' | 'video' | 'audio' | null {
  const mime = String(input?.type ?? '').toLowerCase()
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  const name = String(input?.name ?? '')
  const ext = (name.split('.').pop() ?? '').toLowerCase()
  for (const [kind, list] of EXT_KIND) {
    if (list.includes(ext)) return kind
  }
  return null
}

/** 这个槽位收不收这种媒体（规则唯一来源 = slotKinds.ts） */
export function slotAccepts(kind: RefSlotKind, mediaType: SlotMedia | null): boolean {
  return slotAcceptsKind(kind, mediaType)
}

/** 落点判定结果 */
export interface DropVerdict {
  ok: boolean
  /** 失败原因：没按 Ctrl / 类型不支持 / 槽位不收这种媒体 */
  reason?: 'no-modifier' | 'unsupported' | 'kind-mismatch'
  /** 认出来的媒体类型（失败时也带上，便于提示「你给的是音频」） */
  mediaType?: SlotMedia
}

/**
 * 参考格的落点判定。
 *
 * - `any` 格（手打的待绑定标签）：收任何类型；
 * - 已绑定格：按**节点的真实类型**判断（不按名字猜）；
 * - 拖画布节点：必须按住 Ctrl / ⌘；拖本地文件不需要。
 */
export function judgeSlotDrop(
  kind: RefSlotKind,
  input: {
    file?: { name?: string; type?: string }
    node?: { name?: string; mime?: string }
    modifier?: boolean
    /** 节点自带的参考类型（文本节点没有 MIME，只能由调用方从节点内容判断后传进来） */
    mediaType?: SlotMedia
  },
): DropVerdict {
  if (input.node) {
    if (!input.modifier) return { ok: false, reason: 'no-modifier' }
    const mediaType = input.mediaType ?? mediaTypeOf({ name: input.node.name, type: input.node.mime })
    if (!mediaType) return { ok: false, reason: 'unsupported' }
    if (!slotAccepts(kind, mediaType)) return { ok: false, reason: 'kind-mismatch', mediaType }
    return { ok: true, mediaType }
  }
  const mediaType = input.mediaType ?? mediaTypeOf(input.file)
  if (!mediaType) {
    // 文本文件没有 image/video/audio 前缀：待绑定格（any）照样收
    const looksText = isTextFile(input.file)
    if (kind === 'any' && looksText) return { ok: true, mediaType: 'text' }
    return { ok: false, reason: 'unsupported' }
  }
  if (!slotAccepts(kind, mediaType)) return { ok: false, reason: 'kind-mismatch', mediaType }
  return { ok: true, mediaType }
}

/** 看起来是文本文件（MIME 或扩展名任一命中） */
function isTextFile(file: { name?: string; type?: string } | undefined): boolean {
  const mime = String(file?.type ?? '').toLowerCase()
  if (mime.startsWith('text/')) return true
  const ext = (String(file?.name ?? '').split('.').pop() ?? '').toLowerCase()
  return ext === 'txt' || ext === 'md' || ext === 'markdown'
}

/** 失败原因 → 给用户看的一句话 */
export function dropVerdictMessage(kind: RefSlotKind, verdict: DropVerdict): string {
  if (verdict.reason === 'no-modifier') return '拖节点时要按住 Ctrl（Mac 用 ⌘）才能放进参考格'
  if (verdict.reason === 'kind-mismatch') {
    return verdict.mediaType ? slotMismatchHint(kind, verdict.mediaType) : '这个参考格只收' + slotAcceptsLabel(kind)
  }
  return '不支持的文件类型'
}

/**
 * 松手时该落到哪个卡片：给定鼠标点与卡片矩形，返回命中的卡片键。
 *
 * 卡片是 teleport 到 body 的浮层，elementFromPoint 在合成事件下不可靠；
 * 把「点 vs 矩形」的判定放进纯函数，能和真实拖拽用同一套逻辑单测。
 */
export function hitSlotAtPoint(
  point: { x: number; y: number },
  rects: ReadonlyArray<{ key: string; left: number; top: number; right: number; bottom: number }>,
): string | null {
  for (const r of rects) {
    if (point.x >= r.left && point.x <= r.right && point.y >= r.top && point.y <= r.bottom) return r.key
  }
  return null
}
