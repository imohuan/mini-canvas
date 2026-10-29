/**
 * flipImage —— 图片节点的水平 / 垂直翻转（像素级重绘，与图片插件 rotateImage 同一套语义）。
 *
 * 为什么放本插件而不改 plugin-node-image：镜像入口只服务本插件的「旋转与镜像」模式；
 * 用到的服务（doc / resources / settings）都是跨插件公共契约，不 import 其它插件（硬规则）。
 *
 * 写回口径与图片插件一致：
 * - 新字节进资源库（resources.put），节点只留 resourceId + 迁移期显示地址 imageUrl；
 * - data 与卡片尺寸在同一次 doc.updateNode 里提交 → 一次撤销退干净；
 * - 环境不支持（node 单测 / 无 canvas）时各步骤安全返回 false，不写坏数据。
 */
import type { Context } from '@mini-canvas/canvas-base'

export type FlipAxis = 'horizontal' | 'vertical'

/** 翻转的位图读写口（与图片插件 ExpandBitmapIO 同款设计：抽出来是为了 node 单测可注入假实现） */
export interface FlipBitmapIO {
  load(url: string): Promise<{ source: unknown; width: number; height: number } | null>
  paint(width: number, height: number, axis: FlipAxis, source: unknown): Promise<Blob | null>
  release(source: unknown): void
}

/** 图片预览上限的兜底值（与图片插件 DEFAULT_IMAGE_FIT_LIMITS 同值；插件间不 import，这里抄数值） */
const FALLBACK_LIMITS = { maxWidth: 420, maxHeight: 300 } as const

/** 本文件用到的 doc / resources / settings 最小形状（按名字取服务，不认具体实现） */
interface DocPort {
  getNode(id: string): { type: string; data: Record<string, unknown> } | undefined
  updateNode(id: string, patch: { data: Record<string, unknown>; size?: { w: number; h: number } }): void
}
interface ResourcesPort {
  put(blob: Blob, opts?: { kind?: string; name?: string }): Promise<string>
  resolve(ref: string): Promise<string | undefined>
}
interface SettingsPort {
  get(key: string): unknown
}

function docOf(ctx: Context): DocPort | undefined {
  try {
    return ctx.get<DocPort>('doc') ?? undefined
  } catch {
    return undefined
  }
}

function resourcesOf(ctx: Context): ResourcesPort | undefined {
  try {
    return ctx.tryGet<ResourcesPort | undefined>('resources') ?? undefined
  } catch {
    return undefined
  }
}

/**
 * 读图片预览上限（设置面板可配；读不到用兜底值，不猜）。
 *
 * settings 是内核能力层的**内置服务**（ctx.tryGet('settings') 拿到的是 SettingsStore 真身，
 * get(key) 同步返回），不走 services 表 —— ctx.inject('settings', …) 会被内置服务挡住。
 * 测试要注入自定义读取口走 overrides 参数，与图片插件 readImageFitLimits(svc) 同一条缝。
 */
export function readFitLimits(
  ctx: Context,
  overrides?: { get(key: string): unknown },
): { maxWidth: number; maxHeight: number } {
  const settings: SettingsPort | undefined = overrides ?? (ctx.tryGet<SettingsPort>('settings') as SettingsPort | undefined)
  const num = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback
  return {
    maxWidth: num(settings?.get('imageFitMaxWidth'), FALLBACK_LIMITS.maxWidth),
    maxHeight: num(settings?.get('imageFitMaxHeight'), FALLBACK_LIMITS.maxHeight),
  }
}

/** 卡片尺寸 = 图片等比 + 封顶（不放大小图）；算不出（非法尺寸）返回 undefined → 不动尺寸 */
export function cardSizePatch(
  width: number,
  height: number,
  limits: { maxWidth: number; maxHeight: number },
): { w: number; h: number } | undefined {
  if (!(width > 0) || !(height > 0)) return undefined
  const ratio = Math.min(limits.maxWidth / width, limits.maxHeight / height, 1)
  if (!Number.isFinite(ratio) || ratio <= 0) return undefined
  return { w: Math.max(1, Math.round(width * ratio)), h: Math.max(1, Math.round(height * ratio)) }
}

/** 「现在能真正读到像素」的地址：旧 imageUrl 优先，只有引用时交给资源服务现取 */
async function displayUrlOf(ctx: Context, data: Record<string, unknown> | undefined): Promise<string | undefined> {
  const direct = typeof data?.imageUrl === 'string' ? data.imageUrl : ''
  if (direct) return direct
  const ref = typeof data?.resourceId === 'string' ? data.resourceId : ''
  if (!ref) return undefined
  const resources = resourcesOf(ctx)
  if (!resources) return undefined
  try {
    return (await resources.resolve(ref)) || undefined
  } catch {
    return undefined
  }
}

/**
 * 翻转一张图片节点：取图 → 按轴镜像重绘 → 存资源库 → 写回 data + 卡片尺寸（一次写完）。
 * @returns 是否写成功（节点不存在 / 没有图 / 环境不支持 / 资源库缺失 → false）
 */
export async function flipImageNode(
  ctx: Context,
  nodeId: string,
  axis: FlipAxis,
  io: FlipBitmapIO = defaultFlipIO,
): Promise<boolean> {
  const doc = docOf(ctx)
  const node = doc?.getNode(nodeId)
  if (!doc || !node || node.type !== 'image') return false
  const data = node.data ?? {}
  const sourceUrl = await displayUrlOf(ctx, data)
  if (!sourceUrl) {
    ctx.tryGet<{ show?(t: string): void }>('tip')?.show?.('翻转失败：取不到图片地址')
    return false
  }
  const loaded = await io.load(sourceUrl)
  if (!loaded || !(loaded.width > 0) || !(loaded.height > 0)) {
    if (loaded) io.release(loaded.source)
    ctx.tryGet<{ show?(t: string): void }>('tip')?.show?.('翻转失败：图片读不出来')
    return false
  }
  let blob: Blob | null = null
  try {
    blob = await io.paint(loaded.width, loaded.height, axis, loaded.source)
  } finally {
    io.release(loaded.source)
  }
  if (!blob) return false
  const resources = resourcesOf(ctx)
  if (!resources?.put) {
    ctx.tryGet<{ show?(t: string): void }>('tip')?.show?.('翻转失败：资源库不可用')
    return false
  }
  let resourceId = ''
  try {
    resourceId = await resources.put(blob, { kind: 'image' })
  } catch {
    ctx.tryGet<{ show?(t: string): void }>('tip')?.show?.('翻转失败：资源库写入出错')
    return false
  }
  if (!resourceId) {
    ctx.tryGet<{ show?(t: string): void }>('tip')?.show?.('翻转失败：资源库没有返回引用')
    return false
  }
  let displayUrl: string | undefined
  try {
    displayUrl = (await resources.resolve(resourceId)) || undefined
  } catch {
    displayUrl = undefined
  }
  if (!displayUrl) {
    ctx.tryGet<{ show?(t: string): void }>('tip')?.show?.('翻转失败：新地址解析不出来')
    return false
  }
  // 翻转不换宽高，但卡片尺寸仍按上限重算（原节点可能是按旧上限/手工调过的尺寸）
  const size = cardSizePatch(loaded.width, loaded.height, readFitLimits(ctx))
  doc.updateNode(nodeId, {
    data: {
      ...data,
      resourceId,
      imageUrl: displayUrl,
      imageWidth: loaded.width,
      imageHeight: loaded.height,
      imageSize: undefined,
    },
    ...(size ? { size } : {}),
  })
  return true
}

/** 释放位图（ImageBitmap 需要显式 close，<img> 不用） */
function releaseSource(source: unknown): void {
  const maybe = source as { close?: () => void } | undefined
  if (typeof maybe?.close === 'function') maybe.close()
}

/** 生产实现：全部走浏览器原生能力（fetch + createImageBitmap，退回 <img>；node 环境返回 null） */
export const defaultFlipIO: FlipBitmapIO = {
  async load(url: string): Promise<{ source: unknown; width: number; height: number } | null> {
    if (typeof document === 'undefined') return null
    // 主路：fetch + createImageBitmap（跨域 blob 更稳）；失败（CSP/网络/dataURL 限制）退回 <img> 解码
    if (typeof createImageBitmap === 'function' && typeof fetch === 'function') {
      try {
        const res = await fetch(url)
        if (res.ok) {
          const blob = await res.blob()
          const bitmap = await createImageBitmap(blob)
          return { source: bitmap as unknown, width: bitmap.width, height: bitmap.height }
        }
      } catch {
        /* 落到 <img> 退路 */
      }
    }
    return new Promise((resolve) => {
      const img = new Image()
      img.onload = () => resolve({ source: img, width: img.naturalWidth, height: img.naturalHeight })
      img.onerror = () => resolve(null)
      img.src = url
    })
  },
  async paint(width: number, height: number, axis: FlipAxis, source: unknown): Promise<Blob | null> {
    if (typeof document === 'undefined' || width <= 0 || height <= 0) return null
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const c2d = canvas.getContext('2d')
    if (!c2d) return null
    c2d.save()
    if (axis === 'horizontal') {
      c2d.translate(width, 0)
      c2d.scale(-1, 1)
    } else {
      c2d.translate(0, height)
      c2d.scale(1, -1)
    }
    c2d.drawImage(source as CanvasImageSource, 0, 0)
    c2d.restore()
    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob && blob.size > 0 ? blob : null), 'image/png')
    })
  },
  release(source: unknown): void {
    releaseSource(source)
  },
}
