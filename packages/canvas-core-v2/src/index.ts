// canvas-core-v2 — Cordis 风格画布引擎内核
//
// M1:最小内核(Scope + Context + topo + 类型化事件)
// M4:tracer bullet 全链 demo(services + text 插件 + host)
// M1(浏览器):localStorage adapter + image 插件 + CanvasDemo(vite 演示)

export * from './core'
export * from './services'
export { nodeTextPlugin } from './plugins/nodeText'
export { nodeImagePlugin } from './plugins/nodeImage'
