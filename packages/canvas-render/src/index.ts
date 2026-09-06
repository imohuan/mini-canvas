// canvas-render —— 渲染宿主层（内核 canvas-core-v2 之外的浏览器装配/渲染面）
//
// 与内核的关系：
// - 内核 @mini-canvas/canvas-core-v2 只定义纯逻辑核心（core + services + 注册机制，零 Vue/vue-flow）。
// - 本包承载"渲染宿主"：CanvasHost(官方 VueFlow 宿主组件)、canvasHostCore(store→flow 映射/主题装配纯逻辑)、
//   createMiniCanvasHost(建宿主 + window.MiniCanvas 装配门面)、vueFlowBridge(vue-flow 精选 re-export)、
//   render 注入令牌（CanvasHost provide、渲染插件 content/壳/边 消费）。
// 依赖方向：本包 runtime 依赖内核；渲染插件(theme-default/node-text)依赖本包拿 vue-flow 原语 + 令牌。
//
// 注：edgeGeometry(边几何纯算法)已随实现插件迁到 plugin-theme-default/src/edgeGeometry.ts，
//     由 CustomEdge 本地 import —— 本包与内核均不再提供。

// content 组件与宿主共享的注入令牌/桥（插件包 content .vue import HOST_KEY，不反向依赖 demo）
export { HOST_KEY } from './contracts/contentBridge'
export { NODE_REGISTRY_KEY, NODE_WRITE_KEY } from './contracts/nodeRegistryKey'
export type { NodeWrite } from './contracts/nodeRegistryKey'
// 画布外观参数 / 边外观与选中 注入令牌（宿主 provide、默认皮消费）
export { CANVAS_PARAMS_KEY, type CanvasParams } from './contracts/canvasParamKey'
export { EDGE_VISUAL_KEY, EDGE_SELECTION_KEY } from './contracts/edgeContext'
export type { EdgeVisual, EdgeSelection } from './contracts/edgeContext'
// 调试可视化开关令牌（端口调试/吸附调试；宿主 provide、BaseNode/MovingHandle 消费）
export { DEBUG_KEY, type CanvasDebug } from './contracts/debugContext'
// 拖线连接过程反馈状态契约（canvas-render 能力层提供、BaseNode/ConnectionLine 消费）
export type {
  ConnectionFeedbackState,
  ActiveConnection,
  HoverFeedback,
  HoverPortSide,
  FlowPoint,
  AimedTarget,
} from './contracts/connectionContext'
// 画布交互状态契约（CanvasHost 维护 createInteractionState、provide 进渲染上下文；theme/UI 消费做显隐/行为）
export {
  createInteractionState,
  updateActivity,
  clearActivity,
  emptyActivity,
  beginNodeDrag,
  endNodeDrag,
  beginViewportMove,
  endViewportMove,
} from './contracts/interactionContext'
export type {
  CanvasInteractionState,
  InteractionActivity,
} from './contracts/interactionContext'
// 拖线反馈纯几何/决策/文案（能力层基座，Node 可测）
export { resolveFeedback, isReverse } from './connection/resolveFeedback'
export type { ResolveFeedbackInput, ResolveResult, HoverDecision, ValidateEdge } from './connection/resolveFeedback'
export {
  computeSnapZones,
  computeSnapZoneSides,
  computeSideBandRect,
  computeBodyZones,
  hitTest,
  closestZone,
  zoneDirectionAnchor,
  DEFAULT_SNAP_RATIOS,
  DEFAULT_SNAP_ZONE_CONFIG,
} from './connection/geometry'
export type {
  SnapRatios,
  NodeRect,
  SnapZone,
  SnapZoneSide,
  SnapZoneShape,
  SnapZoneConfig,
  BodyZone,
  ConnectDirection,
} from './connection/geometry'
// 内容类型端口能力 + 容量/挤出判定
export {
  contentTypeAccepted,
  decideCapacity,
  evaluateContentConnect,
} from './connection/capability'
export type {
  ContentType,
  PortContentCapability,
  NodeContentCapability,
  ContentDecision,
  ContentConnectResult,
} from './connection/capability'
// 输入口容量挤出纯函数
export { oldestIncomingToEvict } from './connection/edgeCapacity'
export { reasonText, DEFAULT_REASON_TEXT } from './connection/reasonText'
// 渲染宿主统一上下文：CanvasHost 内层(CanvasSurface) provide 单令牌，消费方走 useCanvasRender()（新代码首选）
export { RENDER_CONTEXT_KEY, useCanvasRender } from './contracts/renderContext'
export type { CanvasRenderContext } from './contracts/renderContext'
// 内核精选的 VueFlow 能力出口（渲染类插件统一从本包 import，不再各自依赖 @vue-flow/core）
export * from './vueFlowBridge'
// 官方渲染宿主组件：把 VueFlow 装配/令牌 provide/数据同步收进内部，调用方一行渲染。
export { default as CanvasHost } from './host/CanvasHost.vue'
// 设置面板数据契约(面板消费的最小 settings 接口)仍归渲染抽象层；成品面板组件 PluginSettingsPanel 已迁 @mini-canvas/ui
export type { SettingsPanelSource, SettingSchema, SettingEntry } from './components/settingsPanelTypes'
// 可替换设置面板宿主：读 themeRegistry.winner('settingsPanel') 渲染当前赢家，把 ctx.settings 喂给它（见 plugin-theme-default/settings.ts 注册默认皮）
export { default as SettingsHost } from './components/SettingsHost.vue'
// 把 ctx.get('settings')(内核 SettingsStore) 适配成设置面板消费的最小接口(SettingsPanelSource) 的复用入口
export { settingsSourceFrom } from './components/settingsSource'
// 通用 UI 槽宿主：给槽名就渲染该槽全部 occupant（<SlotHost slot="overlay" />），插件侧 ctx.slots.register 填
export { default as SlotHost } from './components/SlotHost.vue'
export type { FlowNode, ThemeAssembly } from './host/canvasHostCore'
export {
  nodesFromStore,
  pruneDanglingEdges,
  assembleTheme,
  edgeId,
  DEFAULT_EDGE_VISUAL,
  DEFAULT_HANDLE_VISUAL,
  DEFAULT_DEBUG_VISUAL,
} from './host/canvasHostCore'
// 点选/清空选中语义纯函数（宿主与插件共用；Shift 加选/普通单选/点空白清空）
export { clickNode, clickEdge, clickPane } from './host/selectionInteractions'
// 节点布局只读服务（实测尺寸 + 绝对坐标；插件/工具读，宿主注入'nodeLayout'服务）
export { NodeLayoutService } from './layout/nodeLayout'
// 视口服务（CanvasHost attach VueFlow backend 后可用；插件读/控视图）
export { ViewportService } from './viewport/viewportService'
export type { ViewportBackend, ViewportState, FlowPoint as ViewportFlowPoint } from './viewport/viewportService'
export type { LayoutRect } from './layout/nodeLayout'

export type { SelectionClickOptions } from './host/selectionInteractions'

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
// 统一诊断日志（前缀 [v2:<scope>]），供默认皮组件/宿主共用
export { createV2Logger } from './utils/log'



