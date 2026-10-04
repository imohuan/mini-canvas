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

/** 画布 id（前端界面当前只有一张；与后端 DEFAULT_CANVAS_ID 必须一致） */
export const CANVAS_ID = 'default'

/** 画布内资源引用前缀（与后端 RESOURCE_REF_PREFIX 一致） */
export const RESOURCE_REF_PREFIX = 'res:'

/** 需要处理"画布内引用"的媒体字段（与 canvas-data 的 RESOURCE_URL_FIELDS 一致） */
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
