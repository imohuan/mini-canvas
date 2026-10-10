/**
 * 本插件用到的常量（**就地内联**，不从 canvas-data 运行期 import）。
 *
 * 为什么要内联：本插件以"外部单文件 js"加载（fetch 文本 → import(data:URL)），
 * 裸模块名解析不了，产物里一旦留下 import '@mini-canvas/...' 就会在浏览器里加载失败。
 *
 * 代价是"可能与数据层漂移"——所以测试把这里的字面量与数据层导出的逐字比对：
 * 改了一边没改另一边，立刻红。
 */

/** 画布数据在 SaveService 里的裸 key（type='canvas'） */
export const GRAPH_KEY = 'graph'
export const GRAPH_EDGES_KEY = 'graph-edges'
export const GRAPH_VIEWPORT_KEY = 'graph-viewport'

/** 后台动作清单的版本信号键（type='config'） */
export const PROVIDERS_VERSION_KEY = 'providers-version'
/** 历史变化的版本信号键（type='config'） */
export const HISTORY_REV_KEY = 'history-rev'

/**
 * 默认画布 id（与后端 DEFAULT_CANVAS_ID 一致）。
 *
 * 现在界面是多画布的：当前画布 id 由 `canvasId()` 现算（URL 的 `?canvas=` 参数优先），
 * 拿不到才落回这个默认值。`CANVAS_ID` 保留给「不需要知道当前是哪张」的固定默认场景与单测。
 */
export const CANVAS_ID = 'default'

/** 当前画布 id（多画布）：URL `?canvas=<id>` 优先，否则回落到默认画布。 */
export function canvasId(): string {
  if (typeof window !== 'undefined') {
    try {
      const id = new URLSearchParams(window.location.search).get('canvas')
      if (id && /^[A-Za-z0-9_-]{1,64}$/.test(id)) return id
      // 前端用的是 hash 路由 `#/canvas/<id>`：从哈希里再认一次（界面就是这么跳的）
      const m = /\/canvas\/([A-Za-z0-9_-]{1,64})/.exec(window.location.hash)
      if (m) return m[1]
    } catch {
      /* 取不到 URL（异常环境）→ 回落默认 */
    }
  }
  return CANVAS_ID
}

/** 存资源地址的媒体字段（与 canvas-data 的 RESOURCE_URL_FIELDS 一致；下单前按它查有没有没上传的本地地址） */
export const RESOURCE_URL_FIELDS = [
  'imageUrl',
  'videoUrl',
  'audioUrl',
  'posterUrl',
  'thumbUrl',
  'maskUrl',
  'panoUrl',
  'leftImageUrl',
  'rightImageUrl',
] as const

/**
 * 各类节点的媒体字段（与 canvas-data 的 MEDIA_URL_FIELDS_BY_TYPE 同口径）—— 「重建地址该写回哪个键」。
 * 判据与节点自身一致：node.type 优先。
 *
 * 注意**没有** audio 一项：数据层那边也没有（音频靠"类型未知 → 扫 data 里现有的 audioUrl"兜底）。
 * 两边故意保持逐字一致，免得同一份输入在两条路径上算出不同结果。
 */
const MEDIA_URL_FIELDS_BY_TYPE: Record<string, readonly string[]> = {
  video: ['videoUrl'],
  image: ['imageUrl'],
  panorama: ['panoUrl'],
  '3d-preview': ['imageUrl'],
  'image-compare': ['leftImageUrl', 'rightImageUrl'],
}

/**
 * 按节点 data.resourceId（引用）重建可显示地址（imageUrl / videoUrl …），写回 data。
 *
 * 为什么插件里要有这一份：云端恢复时服务器只存引用，而渲染层只认真地址；少这一步图片/视频节点
 * 就是空白（用户 2026-10-10 报的「刷新后图/视频变空白」）。
 *
 * 为什么不定 import 数据层的 restoreNodeMediaUrls：本插件产物必须**零 import 自包含**
 * （见 vite.config.ts）。故就地实现最小版，并由 constants.test 与数据层逐字比对防漂移。
 *
 * 「该写哪个字段」不能只看 data 里现有的键：保存会清掉失效的临时地址，字段可能已经不在 data 里，
 * 只按现有键恢复等于什么都没恢复（视频就是这样变成「无视频」的）。所以先按类型给字段，类型未知才扫 data。
 */
export async function restoreMediaUrls(
  nodes: Array<{ type?: string; data?: Record<string, unknown> }>,
  restore: (resourceId: string, kind: string) => Promise<string | undefined>,
): Promise<number> {
  let restored = 0
  for (const node of nodes) {
    const data = node.data
    const resourceId = typeof data?.resourceId === 'string' ? data.resourceId : undefined
    if (!resourceId || !data) continue
    const declared = MEDIA_URL_FIELDS_BY_TYPE[String(node.type ?? '')]
    const fields = declared
      ? [...declared]
      : RESOURCE_URL_FIELDS.filter((k) => typeof data[k] === 'string')
    const pending = fields.filter((k) => {
      const v = data[k]
      return v === undefined || (typeof v === 'string' && /^(blob:|data:)/i.test(v))
    })
    if (pending.length === 0) continue
    // 与数据层同口径：只把 video 单独分出来，其余一律按 image 取（后端也这么分流）
    const kind = node.type === 'video' ? 'video' : 'image'
    const url = await restore(resourceId, kind)
    for (const k of pending) {
      if (url) data[k] = url
      else delete data[k]
    }
    if (url) restored += 1
  }
  return restored
}

