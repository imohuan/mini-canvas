/**
 * @mini-canvas/cloud-server —— 画布云端服务（`npx mini-canvas-cloud serve`）。
 *
 * 定位：一套**自托管**的后台，同时提供画布数据接口、资源上传、外部插件清单与画布界面托管。
 * 数据全在本机 `.mini-canvas/`（kv/*.json + uploads/*），不依赖任何外部 SaaS。
 *
 * 与 mcp-server 的关系：互不依赖。mcp-server 面向 AI 工具链（MCP/SSE），
 * 本包面向"浏览器里的画布"（KV + 资源 + 静态托管）。
 */
export { createCloudServer, DEFAULT_PORT, DEFAULT_DATA_DIR } from './server.js'
export type { CloudServer, CloudServerOptions } from './server.js'
export { KvStore, kvFileName, isKvType } from './store/kvStore.js'
export type { KvType } from './store/kvStore.js'
export { FileStore, safeExt, extFromMime, contentId, mimeOf, isSafeFileId, ALLOWED_EXT } from './store/fileStore.js'
export type { StoredFile } from './store/fileStore.js'
export {
  buildManifest,
  resolvePluginsDir,
  resolveUiDist,
  pluginRoutes,
  uiRoutes,
} from './static.js'
export type { ManifestPluginEntry } from './static.js'
export { kvRoutes } from './routes/kv.js'
export { fileRoutes } from './routes/files.js'
export { mcpRoutes } from './routes/mcp.js'
export { CanvasDocument, GRAPH_KEY, GRAPH_EDGES_KEY, GRAPH_VIEWPORT_KEY, edgeIdOf } from './mcp/canvasDoc.js'
export type {
  CanvasNode,
  CanvasEdge,
  CanvasSnapshot,
  BatchResult,
  AddNodeInput,
  AddEdgeInput,
  NodeBatchInput,
  EdgeBatchInput,
} from './mcp/canvasDoc.js'
export { createCanvasMcpServer, listTools, TOOL_LIST } from './mcp/server.js'
export type { McpTool } from './mcp/server.js'
