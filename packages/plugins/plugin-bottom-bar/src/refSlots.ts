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

/** 槽位种类（与素材 kind 对齐；av = 音视频混合） */
export type RefSlotKind = 'image' | 'video' | 'audio' | 'av'

/** 各类槽位的中文名与上传时该允许的文件类型 */
export const REF_SLOT_META: Record<RefSlotKind, { label: string; accept: string }> = {
  image: { label: '图片', accept: 'image/*' },
  video: { label: '视频', accept: 'video/*' },
  audio: { label: '音频', accept: 'audio/*' },
  av: { label: '音视频', accept: 'video/*,audio/*' },
}

/** 中文 / 英文写法 → 槽位种类 */
const KIND_BY_WORD: Record<string, RefSlotKind> = {
  '图片': 'image', image: 'image',
  '视频': 'video', video: 'video',
  '音频': 'audio', audio: 'audio',
  '音视频': 'av', media: 'av', av: 'av',
}

/**
 * 标签正则：`@图片1` / `@音视频12`（1~4 位数字；也认英文写法）。
 *
 * 为什么不用 `/g` 常量：`lastIndex` 是可变状态，多个调用方共用一个正则会互相干扰
 * （踩过：上一次没扫完，下一次从中间开始）。每次都新建一个。
 */
export function tokenRegExp(): RegExp {
  return /@(图片|视频|音频|音视频|image|video|audio|media|av)\s*(\d{1,4})/gi
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

/** 这个槽位收不收这种媒体（「音视频」收视频或音频） */
export function slotAccepts(kind: RefSlotKind, mediaType: 'image' | 'video' | 'audio' | null): boolean {
  if (!mediaType) return false
  if (kind === 'av') return mediaType === 'video' || mediaType === 'audio'
  return kind === mediaType
}

/** 落点判定结果 */
export interface DropVerdict {
  ok: boolean
  /** 失败原因：没按 Ctrl / 类型不支持 / 槽位不收这种媒体 */
  reason?: 'no-modifier' | 'unsupported' | 'kind-mismatch'
  /** 认出来的媒体类型（失败时也带上，便于提示「你给的是音频」） */
  mediaType?: 'image' | 'video' | 'audio'
}

/**
 * 待输入槽位的落点判定。
 *
 * - 拖本地文件：只看类型是否匹配，**不需要**按 Ctrl；
 * - 画布节点：必须按住 Ctrl / ⌘（用户规则 3c），并且类型要匹配。
 */
export function judgeSlotDrop(
  kind: RefSlotKind,
  input: { file?: { name?: string; type?: string }; node?: { name?: string; mime?: string }; modifier?: boolean },
): DropVerdict {
  if (input.node) {
    if (!input.modifier) return { ok: false, reason: 'no-modifier' }
    const mediaType = mediaTypeOf({ name: input.node.name, type: input.node.mime })
    if (!mediaType) return { ok: false, reason: 'unsupported' }
    if (!slotAccepts(kind, mediaType)) return { ok: false, reason: 'kind-mismatch', mediaType }
    return { ok: true, mediaType }
  }
  const mediaType = mediaTypeOf(input.file)
  if (!mediaType) return { ok: false, reason: 'unsupported' }
  if (!slotAccepts(kind, mediaType)) return { ok: false, reason: 'kind-mismatch', mediaType }
  return { ok: true, mediaType }
}

/** 失败原因 → 给用户看的一句话 */
export function dropVerdictMessage(kind: RefSlotKind, verdict: DropVerdict): string {
  const want = kind === 'av' ? '视频或音频' : REF_SLOT_META[kind].label
  if (verdict.reason === 'no-modifier') return '拖节点时要按住 Ctrl（Mac 用 ⌘）才能放进槽位'
  if (verdict.reason === 'kind-mismatch') return '这个槽位只收' + want
  return '不支持的文件类型'
}
