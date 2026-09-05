// canvas-core-v2 — Cordis 风格画布引擎内核
//
// M1:最小内核(Scope + Context + topo + 类型化事件)
// M4:tracer bullet 全链 demo(services + text 插件 + host)
// M1(浏览器):localStorage adapter + image 插件 + CanvasDemo(vite 演示)

export * from './core'
export * from './services'
// content 组件与宿主共享的注入令牌/桥（插件包 content .vue import HOST_KEY，不反向依赖 demo-web）
export { HOST_KEY } from './components/contentBridge'
export { NODE_REGISTRY_KEY, NODE_WRITE_KEY } from './components/nodeRegistryKey'
export type { NodeWrite } from './components/nodeRegistryKey'
// 内核精选的 VueFlow 能力出口（渲染类插件统一从内核 import，不再各自依赖 @vue-flow/core）
export * from './vueFlowBridge'
export { canvasCommandsPlugin } from './plugins/canvasCommands'
// 可复用画布宿主门面（window.MiniCanvas 装配点，热装/热卸/热重载插件）
export { createMiniCanvasHost } from './host/createMiniCanvasHost'
export type {
  MiniCanvasOptions,
  MiniCanvasApi,
  CanvasHostHandle,
} from './host/createMiniCanvasHost'
