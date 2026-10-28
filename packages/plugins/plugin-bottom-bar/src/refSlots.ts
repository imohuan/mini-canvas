/**
 * refSlots —— 底栏输入框里「@素材标签 + 待输入槽位」的纯逻辑（零 DOM、零 Vue，node 可单测）。
 *
 * 用户口径（2026-10-25，附截图）：
 *   1. 输入框里 `@图片123` / `@音频123` / `@音视频123` 要解析成标签；
 *   2. **没有连线也要有标签**，状态是「待输入」，输入框上方的预览框同步显示；
 *   3. 待输入槽位可以：拖本地文件、点击上传、按住 Ctrl 拖节点进来。
 *
 * 这里只放「认标签 / 判落点」两件事。DOM 与交互在 NodeBottomBar.vue，
 * 这样规则可以单独测，不用起浏览器。
 */

import { SLOT_KIND_META, slotAccepts as slotAcceptsKind, slotAcceptsLabel, slotMismatchHint, type SlotKind, type SlotMedia } from './slotKinds'

/** 槽位种类（与素材 kind 对齐；av = 音视频混合；text = 文本） */
export type RefSlotKind = SlotKind

/** 各类槽位的中文名与上传时该允许的文件类型（唯一来源 = slotKinds.ts） */
export const REF_SLOT_META = SLOT_KIND_META

/** 中文 / 英文写法 → 槽位种类 */
const KIND_BY_WORD: Record<string, RefSlotKind> = {
  '图片': 'image', image: 'image',
  '视频': 'video', video: 'video',
  '音频': 'audio', audio: 'audio',
  '音视频': 'av', media: 'av', av: 'av',
  '文本': 'text', text: 'text',
}

/**
 * 标签正则：`@图片1` / `@音视频12`（1~4 位数字；也认英文写法）。
 *
 * 为什么不用 `/g` 常量：`lastIndex` 是可变状态，多个调用方共用一个正则会互相干扰
 * （踩过：上一次没扫完，下一次从中间开始）。每次都新建一个。
 */
export function tokenRegExp(): RegExp {
  return /@(图片|视频|音频|文本|音视频|image|video|audio|text|media|av)\s*(\d{1,4})/gi
}

/** 一个被 @ 到的槽位 */
export interface RefSlotRef {
  /** 稳定键：`image:1` —— 正文标签、槽位、落盘都用它 */
  key: string
  kind: RefSlotKind
  index: number
}

export function refSlotKey(kind: RefSlotKind, index: number): string {
  return kind + ':' + index
}

/**
 * 把声明序号**归一化**成 1..n（用户口径 2026-10-27）。
 *
 * 为什么需要：正文里写 `@图片1 @图片9` 时，若按原序号保留就会撑出 9 个格子；
 * 归一化后变成 图片1、图片2 —— 序号连续、格子数量 = 声明数量，
 * 缩略图规则也退化成「该类型数组第 N 项」，不用维护两套编号。
 *
 * 规则：同类型按**出现顺序**重编 1..n；不同类型各自从 1 开始，互不影响。
 * 已经是 1..n 时结果不变（幂等）。
 *
 * @returns `renamed` 保留原顺序的「原槽位 → 新序号」；`map` 用原 key 反查新序号
 */
export function normalizeRefSlots(slots: ReadonlyArray<RefSlotRef>): {
  renamed: Array<{ slot: RefSlotRef; index: number }>
  map: Map<string, number>
} {
  const seq: Record<string, number> = {}
  const map = new Map<string, number>()
  const renamed = slots.map((slot) => {
    seq[slot.kind] = (seq[slot.kind] ?? 0) + 1
    const index = seq[slot.kind]
    map.set(slot.key, index)
    return { slot, index }
  })
  return { renamed, map }
}


/**
 * 从正文里认出所有槽位（去重、保持出现顺序）。
 * @param options.allowAv 是否认「@音视频」（设置里可关）
 */
export function parseRefSlots(text: string, options: { allowAv?: boolean } = {}): RefSlotRef[] {
  const allowAv = options.allowAv !== false
  const re = tokenRegExp()
  const out: RefSlotRef[] = []
  const seen = new Set<string>()
  let m: RegExpExecArray | null
  while ((m = re.exec(String(text ?? ''))) !== null) {
    const kind = KIND_BY_WORD[m[1].toLowerCase()]
    if (!kind) continue
    if (kind === 'av' && !allowAv) continue
    const index = Number(m[2])
    if (!Number.isFinite(index) || index < 1) continue
    const key = refSlotKey(kind, index)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ key, kind, index })
  }
  return out
}

/**
 * 从**富文本 doc JSON** 里取出真正的槽位标签（`ref-slot:image:3` 这种）。
 *
 * 为什么不再拿纯文本正则扫（用户 2026-10-27 报「只有 2 条连线却出现 9 个槽位」）：
 * 纯文本扫会把「正文里剩下的一串 @图片10 文字」也当成声明，把参考区撑到第 10 格。
 * 现在文字就是文字，只有点了「标记」转出来的标签节点才算声明。
 */
export function refSlotsFromDoc(doc: unknown): RefSlotRef[] {
  const root = doc as { type?: unknown; content?: unknown } | null | undefined
  if (!root || root.type !== 'doc' || !Array.isArray(root.content)) return []
  const out: RefSlotRef[] = []
  const seen = new Set<string>()
  const walk = (nodes: unknown[]): void => {
    for (const n of nodes) {
      const node = n as { type?: string; attrs?: { id?: unknown }; content?: unknown } | null
      if (!node || typeof node !== 'object') continue
      if (node.type === 'resource') {
        const id = typeof node.attrs?.id === 'string' ? node.attrs.id : ''
        const m = /^ref-slot:(image|video|audio|text|av):(\d+)$/.exec(id)
        if (m) {
          const kind = m[1] as RefSlotKind
          const index = Number(m[2])
          const key = refSlotKey(kind, index)
          if (index >= 1 && !seen.has(key)) {
            seen.add(key)
            out.push({ key, kind, index })
          }
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
 * 待输入槽位的落点判定。
 *
 * - 拖本地文件：只看类型是否匹配，**不需要**按 Ctrl；
 * - 画布节点：必须按住 Ctrl / ⌘（用户规则 3c），并且类型要匹配。
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
  if (!mediaType) return { ok: false, reason: 'unsupported' }
  if (!slotAccepts(kind, mediaType)) return { ok: false, reason: 'kind-mismatch', mediaType }
  return { ok: true, mediaType }
}

/** 失败原因 → 给用户看的一句话 */
export function dropVerdictMessage(kind: RefSlotKind, verdict: DropVerdict): string {
  if (verdict.reason === 'no-modifier') return '拖节点时要按住 Ctrl（Mac 用 ⌘）才能放进槽位'
  if (verdict.reason === 'kind-mismatch') {
    return verdict.mediaType ? slotMismatchHint(kind, verdict.mediaType) : '这个槽位只收' + slotAcceptsLabel(kind)
  }
  return '不支持的文件类型'
}

/**
 * 松手时该落到哪个槽位：给定鼠标点与槽位矩形，返回命中的槽位键。
 *
 * 为什么要单独抽出来：真机里槽位是 teleport 到 body 的浮层，`elementFromPoint` 在
 * 合成事件下不可靠；把「点 vs 矩形」的判定放进纯函数，能和真实拖拽用同一套逻辑单测。
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
