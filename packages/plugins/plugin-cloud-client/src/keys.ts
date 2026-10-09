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
