/**
 * 本插件用到的持久化 key（**就地内联**，不从 canvas-data 运行期 import）。
 *
 * 为什么要内联：本插件以"外部单文件 JS"加载（data: URL import），裸模块名解析不了，
 * 一旦在产物里留下 `import '@mini-canvas/canvas-data'`，浏览器里就会加载失败。
 *
 * 代价是"可能与数据层漂移"——所以 keys.test.ts 把这里的字面量与
 * canvas-data 导出的 GRAPH_KEY / GRAPH_EDGES_KEY 逐字比对：改了一边没改另一边，测试立刻红。
 */

/** 画布节点图（type='canvas'） */
export const GRAPH_KEY = 'graph'

/** 画布边集（type='canvas'） */
export const GRAPH_EDGES_KEY = 'graph-edges'

/** 画布视口（type='canvas'） */
export const GRAPH_VIEWPORT_KEY = 'graph-viewport'
