// canvas-core-v2 — Cordis 风格画布引擎内核
//
// M1:最小内核(Scope + Context + topo + 类型化事件)
// M4:tracer bullet 全链 demo(services + text 插件 + host)
// M1(浏览器):localStorage adapter + image 插件 + CanvasDemo(vite 演示)

export * from './core'
export * from './services'
// content 组件与宿主共享的注入令牌/桥（插件包 content .vue import HOST_KEY，不反向依赖 demo-web）
export { HOST_KEY } from './components/contentBridge'
export { canvasCommandsPlugin } from './plugins/canvasCommands'
