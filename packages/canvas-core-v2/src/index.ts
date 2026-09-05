// canvas-core-v2 — Cordis 风格画布引擎内核
//
// M1:最小内核(Scope + Context + topo + 类型化事件)
// M4:tracer bullet 全链 demo(services + text 插件 + host)
// M1(浏览器):localStorage adapter + image 插件 + CanvasDemo(vite 演示)

export * from './core'
export * from './services'
// content 组件与宿主共享的注入令牌/桥（插件包 content .vue import HOST_KEY，不反向依赖 demo-web）
export { HOST_KEY } from './contracts/contentBridge'
export { NODE_REGISTRY_KEY, NODE_WRITE_KEY } from './contracts/nodeRegistryKey'
export type { NodeWrite } from './contracts/nodeRegistryKey'
// 内核精选的 VueFlow 能力出口（渲染类插件统一从内核 import，不再各自依赖 @vue-flow/core）
export * from './vueFlowBridge'
// 共享注入令牌/配置契约（宿主 provide、渲染插件(default-theme) 消费；符号身份必须同源才能注入命中）
export { CANVAS_PARAMS_KEY, type CanvasParams } from './contracts/canvasParamKey'
export { EDGE_VISUAL_KEY, EDGE_SELECTION_KEY } from './contracts/edgeContext'
export type { EdgeVisual, EdgeSelection } from './contracts/edgeContext'
export { canvasCommandsPlugin } from './plugins/canvasCommands'
// 可复用画布宿主门面（window.MiniCanvas 装配点，热装/热卸/热重载插件）
export { createMiniCanvasHost } from './host/createMiniCanvasHost'
export type {
  MiniCanvasOptions,
  MiniCanvasApi,
  CanvasHostHandle,
} from './host/createMiniCanvasHost'
// 官方渲染宿主组件：把 VueFlow 装配/令牌 provide/数据同步收进内部，调用方一行渲染。
// 依赖 @vue-flow/core(浏览器层)，Node 单测不 import 顶层，故不影响纯逻辑测试面。
export { default as CanvasHost } from './host/CanvasHost.vue'
export type { FlowNode, ThemeAssembly } from './host/canvasHostCore'
