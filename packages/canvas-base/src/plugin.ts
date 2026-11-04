/**
 * canvasBasePlugin —— 应用级画布底座插件（插件名 `canvas-base`）。
 *
 * 分层里的「base」负责整个应用生命周期都在的东西：存储通道 save、资源 store、
 * 节点/主题注册表容器、命令表、配置持久化桥。它**不**提供 doc / selection ——
 * 那是 `canvas-data` 会话插件的职责，只在打开某张画布时存在。
 *
 * 为什么放在 canvas-base 包：插件作者只认 `@mini-canvas/canvas-base` 这一个入口；
 * 应用装配（根级 Provider）也应该从同一处拿到这个身份，而不是去 canvas-data 里找工厂。
 * 实现直接复用 canvas-data 的工厂，逻辑只有一份。
 */
import type { PluginModule } from '@mini-canvas/kernel'
import {
  CANVAS_APP_BASE_PLUGIN_NAME,
  createCanvasAppBasePlugin,
  type CanvasAppBaseOptions,
  type CanvasAppBaseServices,
} from '@mini-canvas/canvas-data'

/** 应用级底座插件名（= 'canvas-base'） */
export const CANVAS_BASE_PLUGIN_NAME = CANVAS_APP_BASE_PLUGIN_NAME

/** 应用级底座装配结果：插件模块 + 已建好的服务实例。 */
export interface CanvasBasePluginAssembly {
  name: string
  plugin: PluginModule
  services: CanvasAppBaseServices
}

/**
 * 建一个应用级底座插件。
 *
 * 实例在调用时就建好：根级 Provider 要在 start() 之前拿到 save / 注册表容器。
 * 参数与 canvas-data 的工厂一致（adapter / persistSettings …）。
 */
export function createCanvasBaseAppPlugin(
  opts: CanvasAppBaseOptions = {},
): CanvasBasePluginAssembly {
  return createCanvasAppBasePlugin(opts)
}

/**
 * 只取插件模块、不要实例的便捷入口。
 *
 * 为什么是**函数**而不是常量：底座里的 SaveServiceImpl / ResourceStore 都是实例态，
 * 一个模块级常量会让两个 Context（多画布预览、测试里的多个 ctx）共用同一份 save，
 * 数据互相串。每次调用建一份新的，才是正确语义。
 */
export function canvasBasePlugin(opts: CanvasAppBaseOptions = {}): PluginModule {
  return createCanvasBaseAppPlugin(opts).plugin
}
