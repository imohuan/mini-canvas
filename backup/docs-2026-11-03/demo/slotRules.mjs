/**
 * 「看图」槽位规则（纯函数，零 DOM）。
 *
 * 用户口径（2026-10-25）：
 *   1. 输入框里 @图片123 / @音频123 / @音视频123 要解析成标签；
 *   2. 没有连线时标签也要存在，状态是「待输入」；
 *   3. 待输入槽位可以：拖本地文件、点击上传、按住 Ctrl 拖节点进来。
 *
 * 这里只放「判定」，不碰界面：demo 页与测试都调它，避免两处各写一套规则。
 */

/** 槽位种类 → 显示名 / 后缀单位 */
export const KIND_META = {
  image: { label: '图片', unit: '张', accept: 'image/*' },
  video: { label: '视频', unit: '个', accept: 'video/*' },
  audio: { label: '音频', unit: '个', accept: 'audio/*' },
  av: { label: '音视频', unit: '个', accept: 'video/*,audio/*' },
}

/** 中文 / 英文 → 槽位种类 */
export const KIND_BY_TOKEN = {
  '图片': 'image', image: 'image',
  '视频': 'video', video: 'video',
  '音频': 'audio', audio: 'audio',
  '音视频': 'av', media: 'av', av: 'av',
}

/**
 * 标签正则：@图片123 / @视频1 / @音频1 / @音视频1（也认英文写法）。
 * 数字 1~4 位；前后不要求边界 —— 输入到一半也能先识别出来（demo 的实时体验）。
 */
export function makeTokenRegExp() {
  return /@(图片|视频|音频|音视频|image|video|audio|media|av)\s*(\d{1,4})/gi
}

/** 扩展名兜底（有些系统给不出 MIME） */
const EXT = {
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'svg'],
  video: ['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v'],
  audio: ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus'],
}

/** 文件 → mediaType（image / video / audio / null） */
export function mediaTypeOfFile(file) {
  const type = String((file && file.type) || '').toLowerCase()
  if (type.startsWith('image/')) return 'image'
  if (type.startsWith('video/')) return 'video'
  if (type.startsWith('audio/')) return 'audio'
  const name = String((file && file.name) || '')
  const ext = (name.split('.').pop() || '').toLowerCase()
  for (const [kind, list] of Object.entries(EXT)) {
    if (list.includes(ext)) return kind
  }
  return null
}

/** 槽位收不收这种媒体（「音视频」收视频或音频） */
export function kindMatches(slotKind, mediaType) {
  if (slotKind === 'av') return mediaType === 'video' || mediaType === 'audio'
  return slotKind === mediaType
}

/**
 * 落点判定（demo 与测试共用）。
 *
 * @param slotKind  'image' | 'video' | 'audio' | 'av'
 * @param input     { node?: {name, mime}, fileMediaType?: string, modifier?: boolean }
 * @returns { ok: boolean, reason?: 'no-modifier' | 'unsupported' | 'kind-mismatch', mediaType?: string }
 */
export function judgeDrop(slotKind, input) {
  if (input && input.node) {
    // 拖节点必须按住 Ctrl / ⌘（用户规则 3c）
    if (!input.modifier) return { ok: false, reason: 'no-modifier' }
    const mediaType = mediaTypeOfFile({ name: input.node.name, type: input.node.mime })
    if (!mediaType) return { ok: false, reason: 'unsupported' }
    if (!kindMatches(slotKind, mediaType)) return { ok: false, reason: 'kind-mismatch', mediaType }
    return { ok: true, mediaType }
  }
  const mediaType = input && input.fileMediaType
  if (!mediaType) return { ok: false, reason: 'unsupported' }
  if (!kindMatches(slotKind, mediaType)) return { ok: false, reason: 'kind-mismatch', mediaType }
  return { ok: true, mediaType }
}

/**
 * 正文 → 槽位清单（去重、保序）。
 * @param text    输入框正文
 * @param options { allowAv?: boolean }
 * @returns Array<{ key, kind, index }>
 */
export function parseSlots(text, options = {}) {
  const allowAv = options.allowAv !== false
  const re = makeTokenRegExp()
  const out = []
  const seen = new Set()
  let m
  while ((m = re.exec(String(text || ''))) !== null) {
    const kind = KIND_BY_TOKEN[m[1].toLowerCase()]
    if (!kind) continue
    if (kind === 'av' && !allowAv) continue
    const index = Number(m[2])
    if (!Number.isFinite(index) || index < 1) continue
    const key = kind + ':' + index
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ key, kind, index })
  }
  return out
}
