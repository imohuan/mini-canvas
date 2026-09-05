// canvas-render —— 渲染宿主层（内核 canvas-core-v2 之外的浏览器装配/渲染面）
//
// 与内核的关系：
// - 内核 @mini-canvas/canvas-core-v2 只定义纯逻辑核心（core + services + 注册机制，零 Vue/vue-flow）。
// - 本包承载"渲染宿主"：CanvasHost(官方 VueFlow 宿主组件)、canvasHostCore(store→flow 映射/主题装配纯逻辑)、
//   createMiniCanvasHost(建宿主 + window.MiniCanvas 装配门面)、vueFlowBridge(vue-flow 精选 re-export)、
//   render 注入令牌（CanvasHost provide、渲染插件 content/壳/边 消费）。
// 依赖方向：本包 runtime 依赖内核；渲染插件(theme-default/node-text)依赖本包拿 vue-flow 原语 + 令牌。
//
// 注：edgeGeometry(边几何纯算法)留在内核 @mini-canvas/canvas-core-v2/contracts/edgeGeometry，
//     CustomEdge 继续从内核子路径 import —— 本包不重复提供。

// content 组件与宿主共享的注入令牌/桥（插件包 content .vue import HOST_KEY，不反向依赖 demo）
export { HOST_KEY } from './contracts/contentBridge'
export { NODE_REGISTRY_KEY, NODE_WRITE_KEY } from './contracts/nodeRegistryKey'
export type { NodeWrite } from './contracts/nodeRegistryKey'
// 画布外观参数 / 边外观与选中 注入令牌（宿主 provide、默认皮消费）
export { CANVAS_PARAMS_KEY, type CanvasParams } from './contracts/canvasParamKey'
export { EDGE_VISUAL_KEY, EDGE_SELECTION_KEY } from './contracts/edgeContext'
export type { EdgeVisual, EdgeSelection } from './contracts/edgeContext'
// 内核精选的 VueFlow 能力出口（渲染类插件统一从本包 import，不再各自依赖 @vue-flow/core）
export * from './vueFlowBridge'
// 官方渲染宿主组件：把 VueFlow 装配/令牌 provide/数据同步收进内部，调用方一行渲染。
export { default as CanvasHost } from './host/CanvasHost.vue'
// 分组化配置的 schema 驱动 UI 面板（读 ctx.settings 组/schema 自动长控件，改即 settings.set）
export { default as PluginSettingsPanel } from './components/PluginSettingsPanel.vue'
export type { SettingsPanelSource, SettingSchema, SettingEntry } from './components/settingsPanelTypes'
export type { FlowNode, ThemeAssembly } from './host/canvasHostCore'
export {
  nodesFromStore,
  pruneDanglingEdges,
  assembleTheme,
  edgeId,
  DEFAULT_EDGE_VISUAL,
  DEFAULT_HANDLE_VISUAL,
} from './host/canvasHostCore'
// 可复用画布宿主门面（window.MiniCanvas 装配点，热装/热卸/热重载插件）
export { createMiniCanvasHost } from './host/createMiniCanvasHost'
export type {
  MiniCanvasOptions,
  MiniCanvasApi,
  CanvasHostHandle,
} from './host/createMiniCanvasHost'
// 统一安装句柄 manager + 外部来源加载 + 装配清单(目标 D)
export { createPluginManager } from './host/pluginManager'
export type {
  PluginManager,
  PluginEntrySource,
  PluginManifest,
  PluginManifestEntry,
  InstalledPluginInfo,
} from './host/pluginManager'
// 高频值合帧工具(目标 B2 性能约束③)
export { createCoalescer, rafScheduler, manualScheduler } from './utils/coalesce'
export type { CoalesceScheduler } from './utils/coalesce'
