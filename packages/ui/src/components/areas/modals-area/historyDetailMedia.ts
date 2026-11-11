/**
 * 生成详情里的媒体类型归一化（纯函数，可单测）。
 *
 * 历史里的参考素材 / 产物有两种写法：
 *   · 后台新记录：kind 是英文 image / video / audio / text；
 *   · 旧记录或手工数据：kind 可能是中文，或地址带扩展名但 kind 缺失。
 * 详情面板要按“能真正加载的媒体”选预览件，不能只看 kind —— 地址后缀是最稳的兜底。
 */
export type HistoryMediaKind = 'image' | 'video' | 'audio' | 'text' | 'other'

const KIND_ALIASES: Record<string, HistoryMediaKind> = {
  image: 'image',
  img: 'image',
  图片: 'image',
  video: 'video',
  movie: 'video',
  视频: 'video',
  audio: 'audio',
  sound: 'audio',
  music: 'audio',
  音频: 'audio',
  text: 'text',
  txt: 'text',
  文本: 'text',
}

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'svg'])
const VIDEO_EXT = new Set(['mp4', 'webm', 'mov', 'm4v', 'mkv'])
const AUDIO_EXT = new Set(['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus'])

function extensionOf(url: string): string {
  const clean = url.split('?')[0]?.split('#')[0] ?? ''
  const dot = clean.lastIndexOf('.')
  return dot >= 0 ? clean.slice(dot + 1).toLowerCase() : ''
}

/**
 * 一条资源该用哪种预览。
 *
 * 判断顺序：
 *   1. data URL 的 MIME；
 *   2. 文件扩展名（最不容易被旧 kind 写错）；
 *   3. 声明的 kind；
 *   4. 没有地址、只有文字 → 文本。
 */
export function historyMediaKind(input: { kind?: string; url?: string; value?: string }): HistoryMediaKind {
  const url = typeof input.url === 'string' ? input.url.trim() : ''
  if (url.startsWith('data:')) {
    if (url.startsWith('data:image/')) return 'image'
    if (url.startsWith('data:video/')) return 'video'
    if (url.startsWith('data:audio/')) return 'audio'
  }
  const ext = extensionOf(url)
  if (IMAGE_EXT.has(ext)) return 'image'
  if (VIDEO_EXT.has(ext)) return 'video'
  if (AUDIO_EXT.has(ext)) return 'audio'

  const declared = KIND_ALIASES[(input.kind ?? '').trim().toLowerCase()]
  if (declared) return declared
  if (!url && typeof input.value === 'string' && input.value.trim()) return 'text'
  return 'other'
}

/** 面板上显示的中文类型名 */
export function historyMediaLabel(kind: HistoryMediaKind): string {
  return kind === 'image' ? '图片'
    : kind === 'video' ? '视频'
      : kind === 'audio' ? '音频'
        : kind === 'text' ? '文本'
          : '其他'
}
