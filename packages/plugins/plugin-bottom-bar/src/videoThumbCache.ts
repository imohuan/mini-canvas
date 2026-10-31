/**
 * videoThumbCache —— 视频缩略图在**底栏渲染侧的同步视图**（用户 2026-10-30 统一后）。
 *
 * 真正的取图与持久化只有一份：video 插件的 `ctx.get('video').thumb(url)`
 * （见 plugin-node-video/src/videoThumbUnified.ts）。本文件只负责两件事：
 * 1. **同步读**（`peekVideoThumb`）：Vue 模板/computed 渲染时必须同步拿到地址；
 * 2. **地址规范化**：同一视频在不同地方写法不同（绝对 / 相对 / blob），
 *    统一折成同一个键，避免"卡片有图、下拉没图"。
 *
 * 持久化（重启后仍命中）由统一服务的资源库那层负责，这里不重复做。
 */

/** 截图宽度上限（用户口径：不小于 1080；原视频更窄就按原宽，绝不放大） */
export const VIDEO_THUMB_MAX_WIDTH = 1080

/** 本会话已解析到的地址（统一服务返回什么就记什么；重启后由资源库重新 resolve） */
const cache = new Map<string, string>()
/** 正在取（同一视频只解一次码；与统一服务的单飞叠加也不会重复生成） */
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

const keyOf = (url: string) => normalizeUrl(url)

/** 读缓存（同步，渲染时直接用） */
export function peekVideoThumb(url: string | undefined): string | undefined {
  if (!url) return undefined
  return cache.get(keyOf(url))
}

/**
 * 取视频缩略图（有缓存直接返回）。
 *
 * @param capture 由视频插件提供的**统一入口**（`ctx.get('video').thumb`）；
 *   内部已含资源库持久缓存 + 纯色帧跳过 + 单飞，本函数只加一层同步视图缓存。
 */
export function ensureVideoThumb(
  url: string,
  capture: ((videoUrl: string) => Promise<string | null>) | undefined,
): Promise<string | null> {
  if (!url) return Promise.resolve(null)
  const hit = cache.get(keyOf(url))
  if (hit) return Promise.resolve(hit)
  const inflight = pending.get(keyOf(url))
  if (inflight) return inflight
  if (!capture) return Promise.resolve(null)
  const p = (async () => {
    try {
      /**
       * 只传地址、不传宽度：统一服务的第 1 档口径是固定的「原生帧 + 1080 上限」，
       * 这样这里（拿不到源尺寸）与视频节点（知道源尺寸）命中**同一个名字、同一张图**。
       * 从前这里多传一个 maxWidth，名字里就会多一段尺寸，同一视频各存一份。
       */
      const dataUrl = await capture(url)
      if (dataUrl) cache.set(keyOf(url), dataUrl)
      return dataUrl
    } catch {
      return null
    } finally {
      pending.delete(keyOf(url))
    }
  })()
  pending.set(keyOf(url), p)
  return p
}

/** 测试用：清空缓存 */
export function __clearVideoThumbCache(): void {
  cache.clear()
  pending.clear()
}

