/**
 * videoCropService —— 视频"真裁剪"的前端入口（调后台 ffmpeg 插件）。
 *
 * ## 为什么要走后台
 *
 * 浏览器里没有能重编码的现成能力：MediaRecorder 只能实时重录（要播完整段、体积不可控），
 * wasm 版 ffmpeg 又是一个几十 MB 的依赖。后台本来就有 ffmpeg，裁剪交给它才是"真的换了文件"。
 *
 * ## 分工（别越界）
 *
 * - **后台**：读源视频 → ffmpeg crop 重编码 → 写进画布资源 → 返回新地址。**不写节点**。
 * - **前端（本文件）**：发起请求 → 拿到新地址 → 由调用方经 doc 写节点（进撤销栈、自动保存）。
 *
 * 节点数据归前端，是因为撤销 / 保存 / 实时同步都在前端那一侧；后台写节点会把一件事拆成两条历史。
 *
 * ## 失败即回落
 *
 * 后台没装插件、源视频是外链或本地 blob、ffmpeg 不存在……这些都返回 undefined，
 * 调用方按原来的"取景式裁剪"处理（记 cropRect，CSS 放大）。宁可退化成旧行为，也不让按钮点了没反应。
 */
import type { Rect } from './videoCrop'

/** 后台裁剪接口（插件 server/plugin-video-crop.js 提供） */
const CROP_ENDPOINT = '/api/video-crop'
/** 后台按时间切段接口（同一个插件提供） */
const CUT_ENDPOINT = '/api/video-cut'
/** 探测接口：判断后台有没有装真裁剪插件 */
const PING_ENDPOINT = '/api/video-crop/ping'
/** 单次请求的等待上限（大视频转码要时间；超过就放弃并回落） */
const CROP_TIMEOUT_MS = 120_000
/** 源视频超过这个大小就不走后台（几十兆以上的转码要很久，阻塞体验） */
const MAX_SOURCE_BYTES = 200 * 1024 * 1024

export interface BackendCropResult {
  /** 新视频的同源地址（写进节点 videoUrl 用） */
  url: string
  /** 新视频的持久引用（写进节点 resourceId 用） */
  resourceId?: string
  /** 裁后画面尺寸（视频像素） */
  width: number
  height: number
}

/** 后台时间切段的结果：画面尺寸不变，所以只有地址与长度 */
export interface BackendCutResult {
  /** 新视频的同源地址（写进节点 videoUrl 用） */
  url: string
  /** 新视频的持久引用（写进节点 resourceId 用） */
  resourceId?: string
  /** 切出来的这一段有多长（秒） */
  duration: number
}

/** 当前画布 id：URL `?canvas=` 优先，其次 hash 路由 `#/canvas/<id>`；都没有用 default（与全仓同一判据） */
export function currentCanvasId(): string {
  if (typeof window === 'undefined') return 'default'
  try {
    const q = new URLSearchParams(window.location.search).get('canvas')
    if (q && /^[A-Za-z0-9_-]{1,64}$/.test(q)) return q
    const m = /\/canvas\/([A-Za-z0-9_-]{1,64})/.exec(window.location.hash)
    if (m) return m[1]
  } catch {
    /* 取不到就回落默认画布 */
  }
  return 'default'
}

/**
 * 后台是否具备真裁剪能力（装了这个插件、接口活着）。
 *
 * 结果缓存在模块里：一次页面生命周期问一次就够（接口不会中途消失；
 * 真失败了调用点还有回落，不会因为缓存了 true 就卡死）。
 */
let backendAvailable: boolean | null = null

export async function canCropOnBackend(): Promise<boolean> {
  if (backendAvailable !== null) return backendAvailable
  try {
    const res = await fetch(PING_ENDPOINT, { method: 'GET' })
    backendAvailable = res.ok
  } catch {
    backendAvailable = false
  }
  return backendAvailable
}

/** 仅测试用：清掉探针缓存 */
export function resetCropBackendProbe(): void {
  backendAvailable = null
}

/**
 * 请求后台把视频按框裁成新文件。
 *
 * @param srcUrl  节点当前的**可显示地址**（同源 `/api/canvases/<画布>/resources/<hash>`）
 * @param rect    视频像素坐标的裁剪框
 * @returns 成功给新地址；后台不可用 / 源不是画布资源 / 转码失败 → undefined（调用方回落）
 */
export async function cropVideoOnBackend(input: {
  nodeId: string
  srcUrl: string
  rect: Rect
}): Promise<BackendCropResult | undefined> {
  if (!input.nodeId || !input.srcUrl) return undefined
  if (!(await canCropOnBackend())) return undefined

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = controller ? setTimeout(() => controller.abort(), CROP_TIMEOUT_MS) : null
  try {
    const res = await fetch(CROP_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        canvasId: currentCanvasId(),
        nodeId: input.nodeId,
        srcUrl: input.srcUrl,
        rect: {
          x: Math.round(input.rect.x),
          y: Math.round(input.rect.y),
          width: Math.round(input.rect.width),
          height: Math.round(input.rect.height),
        },
      }),
      ...(controller ? { signal: controller.signal } : {}),
    })
    const body = (await res.json().catch(() => null)) as
      | { ok?: boolean; url?: string; resourceId?: string; width?: number; height?: number; error?: string }
      | null
    if (!res.ok || !body?.ok || typeof body.url !== 'string') return undefined
    if (typeof body.width !== 'number' || typeof body.height !== 'number') return undefined
    if (body.width <= 0 || body.height <= 0) return undefined
    return {
      url: body.url,
      ...(typeof body.resourceId === 'string' && body.resourceId ? { resourceId: body.resourceId } : {}),
      width: body.width,
      height: body.height,
    }
  } catch {
    return undefined
  } finally {
    if (timer !== null) clearTimeout(timer)
  }
}

/** 源视频大小上限（供调用方判断要不要走后台；本地文件拿得到 size 才有意义） */
export const BACKEND_CROP_MAX_SOURCE_BYTES = MAX_SOURCE_BYTES

/**
 * 请求后台把视频按时间切成一个新文件（真剪辑：文件里只剩这一段）。
 *
 * 与裁剪共用同一个后台插件、同一个探针：能力判断问的是「这台后台有没有 ffmpeg 插件」，
 * 与操作是裁画面还是切时间无关。
 *
 * @param start 起始秒；@param end 结束秒
 * @returns 成功给新地址与长度；后台不可用 / 源不是画布资源 / 转码失败 → undefined（调用方回落）
 */
export async function cutVideoOnBackend(input: {
  nodeId: string
  srcUrl: string
  start: number
  end: number
}): Promise<BackendCutResult | undefined> {
  if (!input.nodeId || !input.srcUrl) return undefined
  if (!(input.end > input.start)) return undefined
  if (!(await canCropOnBackend())) return undefined

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = controller ? setTimeout(() => controller.abort(), CROP_TIMEOUT_MS) : null
  try {
    const res = await fetch(CUT_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        canvasId: currentCanvasId(),
        nodeId: input.nodeId,
        srcUrl: input.srcUrl,
        start: input.start,
        end: input.end,
      }),
      ...(controller ? { signal: controller.signal } : {}),
    })
    const body = (await res.json().catch(() => null)) as
      | { ok?: boolean; url?: string; resourceId?: string; duration?: number; error?: string }
      | null
    if (!res.ok || !body?.ok || typeof body.url !== 'string') return undefined
    if (typeof body.duration !== 'number' || !(body.duration > 0)) return undefined
    return {
      url: body.url,
      ...(typeof body.resourceId === 'string' && body.resourceId ? { resourceId: body.resourceId } : {}),
      duration: body.duration,
    }
  } catch {
    return undefined
  } finally {
    if (timer !== null) clearTimeout(timer)
  }
}
