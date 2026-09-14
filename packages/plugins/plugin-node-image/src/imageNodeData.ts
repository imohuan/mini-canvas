/**
 * imageNodeData —— image 节点数据的读写约定与展示文案（纯逻辑，零 DOM/零 Vue，node 可单测）。
 *
 * 为什么单独一层：节点 data 的形状（字段名/单位/上限）是"写回、状态栏、裁剪"三处共用的契约，
 * 散在组件里就会各写一份、各算一套。这里只做纯函数，组件负责调用与渲染。
 *
 * 数据形状（沿用 v1 同名键，便于存量迁移）：
 * - imageUrl      图片地址（dataURL / URL / objectURL）；上传一律转 dataURL，刷新不失效
 * - imageName     文件名（状态栏第一行）
 * - imageWidth/Height 原图像素尺寸（裁剪换算与状态栏尺寸都读它）
 * - imageSize     文件字节数（可选；状态栏显示人类可读大小）
 */

/** 尺寸元信息（宽高 + 可选字节数），供状态栏展示 */
export interface ImageMeta {
  width?: number
  height?: number
  size?: number
}

/** 字节数 → 人类可读（B/KB/MB/GB）；非法值返回空串（调用方据此决定不渲染这一段） */
export function formatFileSize(bytes?: number): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

/**
 * 状态栏的一行元信息：`1920×1080 · 1.2 MB`。
 * 尺寸与大小都缺 → 空串（状态栏不渲染这一行，而不是显示占位符）。
 */
export function describeImageMeta(meta: ImageMeta): string {
  const parts: string[] = []
  if (isPositive(meta.width) && isPositive(meta.height)) parts.push(`${meta.width}×${meta.height}`)
  const size = formatFileSize(meta.size)
  if (size) parts.push(size)
  return parts.join(' · ')
}

/** 状态栏两个按钮要做的动作 */
export type ImageNodeAction = 'rotate' | 'download'

/**
 * 生成下载文件名：去掉 v1 裁剪/扩展留下的 `_crop/_expand/_masked` 后缀与既有图片扩展名，补 `.png`。
 * 名字缺失/清洗后为空 → 回退 `image.png`，保证下载不出现无扩展名的文件。
 */
export function downloadFileName(imageName?: string): string {
  const raw = typeof imageName === 'string' ? imageName.trim() : ''
  const cleaned = raw
    .replace(/_(crop|expand|masked)$/i, '')
    .replace(/\.(png|jpe?g|gif|webp|bmp|svg)$/i, '')
  return `${cleaned || 'image'}.png`
}

function isPositive(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0
}
