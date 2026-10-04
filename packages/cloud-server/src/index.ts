/**
 * @mini-canvas/cloud-server —— 画布云端服务（`npx mini-canvas-cloud serve`）。
 *
 * 定位：一套**自托管**的后台，同时提供画布数据接口、资源上传、外部插件清单与画布界面托管。
 *
 * 数据全在本机 `.mini-canvas/` 下，一个画布一个文件夹：
 *   canvases/<id>/canvas.json    画布本体（节点 + 边 + 画布信息）
 *   canvases/<id>/view.json      视图状态（视口）
 *   canvases/<id>/history.json   任务记录 / 生成历史
 *   canvases/<id>/resources/     本画布资源（节点里存 `res:<hash>` 相对引用）
 *   providers/                   平台提供方（丢一个 .js 进去就是一个平台）
 * 另有 `kv/` 存"设置 / 快捷"这类按 key 的小数据。不依赖任何外部 SaaS。
 *
 * 与 mcp-server 的关系：互不依赖。mcp-server 面向 AI 工具链（MCP/SSE），
 * 本包面向"浏览器里的画布"（画布文件夹 + 资源 + 静态托管）。
 */
export { createCloudServer, DEFAULT_PORT, DEFAULT_DATA_DIR } from './server.js'
export type { CloudServer, CloudServerOptions } from './server.js'
export { KvStore, settingsFilePath, isKvType } from './store/kvStore.js'
export type { KvType } from './store/kvStore.js'
export { safeExt, extFromMime, mimeOf, mimeFromName, ALLOWED_EXT } from './store/mime.js'
export { CanvasStore } from './store/canvasStore.js'
export {
  DEFAULT_CANVAS_ID,
  isSafeCanvasId,
  canvasDir,
  canvasFilePath,
  canvasResourcesDir,
  canvasesRoot,
} from './store/canvasPaths.js'
export {
  CanvasResourceStore,
  RESOURCE_REF_PREFIX,
  toResourceRef,
  isResourceRef,
  parseResourceRef,
  isSafeResourceName,
} from './store/canvasResources.js'
export type { SavedResource } from './store/canvasResources.js'
export type { CanvasData } from './store/canvasStore.js'
export {
  buildManifest,
  resolvePluginsDir,
  resolveUiDist,
  pluginRoutes,
  uiRoutes,
  resolvePluginAsset,
} from './static.js'
export type { ManifestPluginEntry } from './static.js'
export {
  buildPluginCatalog,
  catalogVersion,
  parseUmdGlobalName,
  parseRequiresGlobals,
} from './plugins/catalog.js'
export type { PluginCatalog, PluginCatalogEntry } from './plugins/catalog.js'
export { kvRoutes } from './routes/kv.js'
export { canvasesRoutes } from './routes/canvases.js'
export { actionsRoutes } from './routes/actions.js'
export { jobsRoutes } from './routes/jobs.js'
export { historyRoutes } from './routes/history.js'
export { mcpRoutes } from './routes/mcp.js'
export { ProviderRegistry } from './providers/registry.js'
export { loadProvidersFromDir, DEFAULT_PROVIDERS_DIR } from './providers/load.js'
export { providerDirSignature, watchProviders } from './providers/watch.js'
export type { ProviderWatcher } from './providers/watch.js'
export { createWeb2ApiProvider, WEB2API_ACTIONS } from './providers/web2api/index.js'
export type {
  Provider,
  ActionDef,
  ActionParam,
  JobInput,
  ProviderNodeType,
  ProviderSubmitResult,
  ProviderPollResult,
} from './providers/types.js'
export { isValidProvider } from './providers/types.js'
export { HistoryStore, DEFAULT_HISTORY_LIMIT, DEFAULT_PAGE_SIZE } from './tasks/history.js'
export { TaskManager, DEFAULT_INTERVAL, DEFAULT_TIMEOUT } from './tasks/taskManager.js'
export type { Job, JobStatus, HistoryEntry, HistoryQuery, HistoryPage } from './tasks/types.js'
export type { TaskDeps } from './tasks/taskManager.js'
export { CanvasDocument } from './mcp/canvasDoc.js'
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
