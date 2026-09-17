/**
 * videoNodeData —— video 节点数据的读写约定与展示文案（纯逻辑，零 DOM / 零 Vue，node 可单测）。
 *
 * 单独一层的理由与图片节点同：data 的形状（字段名/单位）是"写回、状态栏、截图、裁剪剪辑"共用的契约，
 * 散在组件里必然各写一份各算一套。
 *
 * 数据形状（对齐 v1 同名键，便于存量迁移）：
 * - videoUrl        视频地址（dataURL / URL / objectURL）
 * - videoName       文件名（状态栏第一行）
 * - videoWidth/Height  视频原始像素尺寸（裁剪换算与卡片比例都读它）
 * - videoDuration   时长（秒；进度条与剪辑范围读它）
 * - videoSize       文件字节数（可选；状态栏显示人类可读大小）
 * - clipStart/clipEnd  剪辑范围（秒；可选，缺省 = 整段）
 * - cropRect        裁剪框（**视频像素坐标**；可选，缺省 = 整幅画面）
 * - cropSourceWidth/cropSourceHeight  裁剪前的原始尺寸（把裁剪框映射回原画面用）
 */

/** 视频元信息（宽高 + 时长 + 可选字节数），供状态栏与比例计算 */
export interface VideoMeta {
  width?: number
  height?: number
  duration?: number
  size?: number
}

/** 视频像素坐标下的矩形（裁剪框与裁剪结果共用） */
export interface RectLike {
  x: number
  y: number
  width: number
  height: number
}

function isPositive(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0
}

/**
 * 有限数守卫（允许 0）；其余一律回落 fallback。
 *
 * `null` 必须当"缺失"而不是 0 —— JS 里 `Number(null) === 0`，照直转换会把一个被清空的字段
 * 读成合法的 0（时长被读成 0 秒 → 进度条塌掉、剪辑范围算成空）。`undefined` 与 `null` 同理。
 */
export function finiteOr(value: unknown, fallback: number): number {
  if (value === null || value === undefined || value === '') return fallback
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

/** 字节数 → 人类可读（B/KB/MB/GB）；非法值返回空串（调用方据此不渲染这一段） */
export function formatFileSize(bytes?: number): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

/** 秒 → `m:ss`（对齐 v1 formatTime；负数/非数按 0） */
export function formatTime(seconds: unknown): string {
  const total = Math.max(0, Math.floor(Number(seconds) || 0))
  const mins = Math.floor(total / 60)
  const secs = total % 60
  return `${mins}:${String(secs).padStart(2, '0')}`
}

/**
 * 状态栏的一行元信息：`1920×1080 · 0:12 · 3.4 MB`。
 * 三段都缺 → 空串（状态栏不渲染这一行，而不是显示占位符）。
 */
export function describeVideoMeta(meta: VideoMeta): string {
  const parts: string[] = []
  if (isPositive(meta.width) && isPositive(meta.height)) parts.push(`${meta.width}×${meta.height}`)
  if (isPositive(meta.duration)) parts.push(formatTime(meta.duration))
  const size = formatFileSize(meta.size)
  if (size) parts.push(size)
  return parts.join(' · ')
}

/**
 * 生成下载文件名：去掉既有视频扩展名，补 `.mp4`（下载的是原始字节，扩展名只为让系统认得出）。
 * 名字缺失/清洗后为空 → 回退 `video.mp4`。
 */
export function downloadFileName(videoName?: string): string {
  const raw = typeof videoName === 'string' ? videoName.trim() : ''
  const cleaned = raw.replace(/\.(mp4|webm|ogg|mov|avi|mkv|wmv|m4v)$/i, '')
  return `${cleaned || 'video'}.mp4`
}

/** 截图产出的图片文件名：`名字_帧序号.png`（去扩展名后拼） */
export function frameFileName(videoName: string | undefined, at: number): string {
  const raw = typeof videoName === 'string' ? videoName.trim() : ''
  const base = raw.replace(/.[^./]+$/, '') || 'video'
  return `${base}_${formatTime(at).replace(':', '-')}.png`
}
