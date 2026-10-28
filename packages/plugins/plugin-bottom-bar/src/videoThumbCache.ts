/**
 * videoThumbCache —— 视频缩略图的**模块级**缓存（用户 2026-10-28）。
 *
 * 为什么必须是模块级、不能放组件里：底栏在拖动节点时会卸载再挂载，
 * 组件内的 ref 随之清空 → 每次拖拽都重新截帧，画面在闪烁（用户实测报的）。
 * 放到模块作用域，跨挂载复用同一份结果，拖多少次都只截一次。
 *
 * 两种尺寸分开缓存：
 * - `small`（50px）：参考卡 / 标签里的方块；
 * - `full`（原始帧）：hover 预览要看细节，不能拿 50px 放大糊掉。
 */

export type ThumbSize = 'small' | 'full'

/** 缓存键 = `尺寸|视频地址` */
const cache = new Map<string, string>()
/** 正在取（同一视频同一尺寸只解一次码） */
const pending = new Map<string, Promise<string | null>>()

/**
 * 缓存键：**先规范化地址**再用。
 *
 * 为什么（用户 2026-10-28 报「@ 下拉里视频那一行是空的、卡片却有图」）：同一个视频在
 * 不同地方拿到的写法不一样 —— 卡片里是 `http://127.0.0.1:8012/api/...`，@ 下拉里是
 * `/api/...`。按原字符串当键，等于两份缓存：卡片那份有帧图，下拉那份永远查不到。
 * 同源的绝对地址一律折成 path+search；blob:/data: 原样保留。
 */
function normalizeUrl(url: string): string {
  if (!url) return url
  if (url.startsWith('blob:') || url.startsWith('data:')) return url
  if (typeof location !== 'undefined') {
    try {
      const u = new URL(url, location.origin)
      if (u.origin === location.origin) return u.pathname + u.search
    } catch {
      /* 非法地址：退回原串 */
    }
  }
  return url
}

const keyOf = (url: string, size: ThumbSize) => size + '|' + normalizeUrl(url)

/** 读缓存（同步，渲染时直接用） */
export function peekVideoThumb(url: string | undefined, size: ThumbSize): string | undefined {
  if (!url) return undefined
  return cache.get(keyOf(url, size))
}

/**
 * 取视频缩略图（有缓存直接返回）。
 *
 * @param capture 由视频插件提供的取帧能力（经 ctx 拿到，不 import 插件代码）
 * @param size    'small' = 50px 方块；'full' = 原始尺寸的一帧（hover 预览用）
 */
export function ensureVideoThumb(
  url: string,
  size: ThumbSize,
  capture: ((videoUrl: string, size?: number) => Promise<string | null>) | undefined,
): Promise<string | null> {
  if (!url) return Promise.resolve(null)
  const hit = cache.get(keyOf(url, size))
  if (hit) return Promise.resolve(hit)
  const inflight = pending.get(keyOf(url, size))
  if (inflight) return inflight
  if (!capture) return Promise.resolve(null)
  const p = (async () => {
    try {
      // small 明确要 50px；full 不传 size → 插件按原始帧给
      const dataUrl = size === 'small' ? await capture(url, 50) : await capture(url)
      if (dataUrl) cache.set(keyOf(url, size), dataUrl)
      return dataUrl
    } catch {
      return null
    } finally {
      pending.delete(keyOf(url, size))
    }
  })()
  pending.set(keyOf(url, size), p)
  return p
}

/** 测试用：清空缓存 */
export function __clearVideoThumbCache(): void {
  cache.clear()
  pending.clear()
}

