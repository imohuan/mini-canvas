/**
 * 输入框标签（chip）左侧的缩略图解析。
 *
 * 用户口径 2026-11-06：引用节点 / 资产后，标签里现在只有类型图标，希望直接看到缩略图。
 *
 * 三类来源：
 *   · 图片节点 / 图片资产：地址本身就能塞进 <img>，直接给；
 *   · 视频节点 / 视频资产：mp4 塞进 <img> 会裂图，必须走视频插件的统一取图
 *     `ctx.get('video').thumb(url)`（底栏就是这么取首帧的），再同步缓存地址；
 *   · 音频 / 文本 / 文件夹 / 技能 / MCP：没有缩略图，保留类型图标。
 *
 * 为什么要「同步读 + 异步取」两层：chip 由 ProseMirror 直接造 DOM，渲染那一刻只能同步
 * 拿地址；视频首帧要解码，所以先画图标，取到后再补图（补图走 refreshChips）。
 */
import type { Context } from '@plume-canvas/canvas-base'

/** 同一视频只取一次：成功记地址，失败记一笔，避免每次重渲染都去解码一遍。 */
const thumbCache = new Map<string, string>()
const failed = new Set<string>()
const pending = new Map<string, Promise<string | null>>()

/** 地址规范化：同源绝对地址折成 path+search，blob/data 原样（底栏同一口径）。 */
function keyOf(url: string): string {
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

/** 同步读：已经取到的视频首帧（渲染时用）。 */
export function peekAgentVideoThumb(url: string | undefined): string | undefined {
  if (!url) return undefined
  return thumbCache.get(keyOf(url))
}

/**
 * 资源引用（resourceId）→ 可显示地址的缓存。
 *
 * 为什么要它：图片 / 视频节点**长期只存 resourceId**（显示地址每次现取、不写回 data），
 * 所以标签拿不到 imageUrl，得问资源服务要一次地址。取到的地址同样只留在内存里。
 */
const refCache = new Map<string, string>()
const refPending = new Map<string, Promise<string | null>>()

/** 同步读：已经解析过的 resourceId → 地址 */
export function peekAgentResourceUrl(ref: string | undefined): string | undefined {
  if (!ref) return undefined
  return refCache.get(ref)
}

/** 异步把 resourceId 解析成地址（单飞去重；资源服务没装 / 解析失败给 null） */
export function ensureAgentResourceUrl(ctx: Context, ref: string | undefined): Promise<string | null> {
  if (!ref) return Promise.resolve(null)
  const hit = refCache.get(ref)
  if (hit) return Promise.resolve(hit)
  const inflight = refPending.get(ref)
  if (inflight) return inflight
  const svc = ctx.tryGet<{ resolve?(r: string): Promise<string | undefined> }>('resources')
  if (!svc?.resolve) return Promise.resolve(null)
  const p = (async () => {
    try {
      const url = await svc.resolve!(ref)
      if (url) refCache.set(ref, url)
      return url ?? null
    } catch {
      return null
    } finally {
      refPending.delete(ref)
    }
  })()
  refPending.set(ref, p)
  return p
}

/**
 * 异步取视频首帧：交给视频插件的统一入口，成功写进本模块缓存。
 *
 * 视频插件没装 / 没有这个能力时返回 null —— 标签保留播放图标，不出现裂图。
 */
export function ensureAgentVideoThumb(
  ctx: Context,
  url: string | undefined,
): Promise<string | null> {
  if (!url) return Promise.resolve(null)
  const key = keyOf(url)
  const hit = thumbCache.get(key)
  if (hit) return Promise.resolve(hit)
  // 取过一次没取到：不再重复解码（视频插件没装时连服务都拿不到，那条路不走这里）
  if (failed.has(key)) return Promise.resolve(null)
  const inflight = pending.get(key)
  if (inflight) return inflight
  const svc = ctx.tryGet<{ thumb?(videoUrl: string | undefined): Promise<string | null> }>('video')
  if (!svc?.thumb) return Promise.resolve(null)
  const p = (async () => {
    try {
      const dataUrl = await svc.thumb!(url)
      if (dataUrl) thumbCache.set(key, dataUrl)
      else failed.add(key)
      return dataUrl
    } catch {
      failed.add(key)
      return null
    } finally {
      pending.delete(key)
    }
  })()
  pending.set(key, p)
  return p
}

/** 测试用：清空缓存 */
export function __clearAgentChipThumbs(): void {
  thumbCache.clear()
  failed.clear()
  pending.clear()
  refCache.clear()
  refPending.clear()
}

/** 资产扩展名 → 标签类型（与 assetKindOf 同口径，避免为类型引一个包） */
export function mediaKindOfExt(ext: string | undefined): 'image' | 'video' | 'audio' | 'other' {
  const e = String(ext ?? '').toLowerCase()
  if (/^(png|jpe?g|gif|webp|avif|bmp|svg)$/.test(e)) return 'image'
  if (/^(mp4|webm|mov|m4v|mkv)$/.test(e)) return 'video'
  if (/^(mp3|wav|ogg|m4a|aac|flac)$/.test(e)) return 'audio'
  return 'other'
}
