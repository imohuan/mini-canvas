/**
 * plugin-file-drop —— 纯逻辑引擎（与 DOM/内核无耦合，Node 可单测）。
 *
 * 复刻老版 canvas-core/src/plugins/file-drop 的"判定→读内容→定尺寸→建节点载荷"中的纯部分：
 * - 文件类型判定：ext/mime → 'image' | 'text' | 'unsupported'（v2 无 video 节点，视频归 unsupported）；
 * - 文本截断：MAX_TEXT_LENGTH 超长截断（与老版同文案）；
 * - 图片尺寸适配：真实宽高按比例缩到不超过卡片上限、不低于下限（与老版 fit 同语义）；
 * - 落点级联：多文件从中心级联排布（与老版 baseX + i*40 同语义）；
 * - 节点载荷：payload = { type, position, data, size? }（v2 nodeStore.addNodes 输入可直接消费）。
 *
 * 异步读文件内容(FileReader)、读图片真实尺寸(Image)、URL.createObjectURL 等浏览器专属行为
 * 不放本文件，由 fileDropPlugin 里的 Service 在浏览器环境调用这些纯函数组装载荷。
 */

/** 文件归类结果（v2 只建 image/text；老版 video 在此归 unsupported） */
export type FileKind = 'image' | 'text' | 'unsupported'

/** 判定只需的文件最小形状（File 的结构子集；测试可传假对象） */
export interface FileLike {
  name: string
  type: string
  size?: number
}

/** 图片真实宽高 */
export interface ImageDims {
  width: number
  height: number
}

/** 一个待建节点的载荷（对齐 v2 AddNodeInput 的最小字段；id 由调用方生成） */
export interface NodePayload {
  type: 'image' | 'text'
  position: { x: number; y: number }
  data: Record<string, unknown>
  /** image 节点带声明尺寸（卡片贴近图片比例）；text 缺省走类型默认尺寸 */
  size?: { w: number; h: number }
}

/** 单文件最大读取字符数（老版同值） */
export const MAX_TEXT_LENGTH = 50000

/** image 节点卡片上限（老版 NODE_SIZES.image） */
export const DEFAULT_IMAGE_SIZE = { cardWidth: 420, cardHeight: 300 }
/** 图片适配的最小卡片尺寸（老版硬下限） */
const MIN_IMAGE_W = 120
const MIN_IMAGE_H = 80

const IMAGE_MIME = /^image\//
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i
const TEXT_EXT = /\.(txt|md|markdown)$/i
const TEXT_MIME = /^text\/(plain|markdown|x-markdown)$/

/** 判定一个文件该建什么节点；老版视频/未知在此归 unsupported（v2 简化边界） */
export function classifyFile(file: FileLike): FileKind {
  if (IMAGE_MIME.test(file.type) || IMAGE_EXT.test(file.name)) return 'image'
  if (TEXT_MIME.test(file.type) || TEXT_EXT.test(file.name)) return 'text'
  return 'unsupported'
}

/** 文本超长截断（返回展示文本；老版截断到 MAX_TEXT_LENGTH + 尾部提示原文长度） */
export function clampText(text: string, maxLength = MAX_TEXT_LENGTH): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength) + `\n\n...（内容过长，已截断，共 ${text.length} 字符）`
}

/**
 * 图片卡片尺寸适配：真实宽高按比例缩小到不超上限，且不低于最小下限（等比）。
 * 老版语义：ratio = min(maxW/w, maxH/h, 1)；输出 max(minW, w*ratio) × max(minH, h*ratio)。
 * 输入非法（无真实尺寸）返回 null，由调用方退回默认卡片尺寸。
 */
export function fitImageSize(
  dims: ImageDims,
  maxW = DEFAULT_IMAGE_SIZE.cardWidth,
  maxH = DEFAULT_IMAGE_SIZE.cardHeight,
): { w: number; h: number } {
  const { width, height } = dims
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { w: maxW, h: maxH }
  }
  const ratio = Math.min(maxW / width, maxH / height, 1)
  return {
    w: Math.max(MIN_IMAGE_W, Math.round(width * ratio)),
    h: Math.max(MIN_IMAGE_H, Math.round(height * ratio)),
  }
}

/** 多文件从中心点级联排布（老版：baseX = center - count*10，第 i 个 + i*40）。单文件即中心点。 */
export function spreadPositions(
  center: { x: number; y: number },
  count: number,
  gap = 40,
): Array<{ x: number; y: number }> {
  if (count <= 0) return []
  if (count === 1) return [{ x: center.x, y: center.y }]
  const baseX = center.x - count * (gap / 4)
  const baseY = center.y - count * (gap / 4)
  return Array.from({ length: count }, (_, i) => ({
    x: Math.round(baseX + i * gap),
    y: Math.round(baseY + i * gap),
  }))
}

/** 图片节点载荷（url 为 objectURL；dims 缺省则用默认卡片尺寸） */
export function buildImagePayload(
  file: FileLike,
  url: string,
  position: { x: number; y: number },
  dims: ImageDims | null,
): NodePayload {
  const size = dims ? fitImageSize(dims) : { w: DEFAULT_IMAGE_SIZE.cardWidth, h: DEFAULT_IMAGE_SIZE.cardHeight }
  const data: Record<string, unknown> = {
    imageUrl: url,
    imageName: file.name,
    imageType: file.type,
    ...(file.size !== undefined ? { imageSize: file.size } : {}),
  }
  if (dims) {
    data.imageWidth = dims.width
    data.imageHeight = dims.height
  }
  return { type: 'image', position, data, size }
}

/** 文本节点载荷（text 已截断；data.text 对齐 node-text content 读取字段） */
export function buildTextPayload(
  file: FileLike,
  text: string,
  position: { x: number; y: number },
): NodePayload {
  return {
    type: 'text',
    position,
    data: { text, label: file.name },
  }
}

/** 文本内容载荷（粘贴纯文本用；无文件对象，label 固定文案） */
export function buildPastedTextPayload(
  text: string,
  position: { x: number; y: number },
  label = '粘贴的文本',
): NodePayload {
  return {
    type: 'text',
    position,
    data: { text, label },
  }
}
