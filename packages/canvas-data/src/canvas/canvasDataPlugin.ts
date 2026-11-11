/**
 * canvasDataPlugin —— 画布数据会话插件（插件名 `canvas-data`）。
 *
 * 分层里这一层负责「这张画布的数据」：节点/边存储、文档门面 doc、选中、历史、图写入、
 * 节点工厂与画布通用命令。它是**可装卸**的会话单元：
 *
 * - 项目页：没装它，`doc` / `selection` 都不存在，依赖它们的业务插件停在 PENDING；
 * - 进入画布：`mountCanvas` 把它装进根 Context，服务出现，画布插件自动激活；
 * - 离开画布：卸掉它，内核把依赖方回退 PENDING，注册的节点类型/槽/主题条目一起回收。
 *
 * 为什么 `core: false`：core 会拒绝动态卸载，而离开画布必须能把它卸掉；
 * 应用级的 save / resources / 注册表容器由 `canvas-base` 提供，不在这一层反复注入。
 *
 * 为什么还要工厂：宿主在 start() 之前就要拿到 nodeStore（建视口）、doc 等实例，
 * 所以实例在调用时建好，`plugin` 只负责在 apply 里把它们注入内核。
 */
import type { PluginModule } from '@plume-canvas/kernel'
import { createCanvasBasePlugin, type CanvasBaseOptions, type CanvasBaseServices } from './canvasBasePlugin'

/** 画布数据会话插件名 */
export const CANVAS_DATA_PLUGIN_NAME = 'canvas-data'

export interface CanvasDataAssembly {
  /** 插件名（= CANVAS_DATA_PLUGIN_NAME） */
  name: string
  /** 交给 ctx.installPlugin(...) 的插件模块（core: false，可热卸） */
  plugin: PluginModule
  /** 已建好的服务实例 */
  services: CanvasBaseServices
}

/**
 * 建一个画布数据会话插件。
 *
 * 参数与 `createCanvasBasePlugin` 一致（adapter / appBase / persistSettings …），
 * 只是固定了名字与 `core: false` —— 这两条是「它是会话、可以被卸掉」的硬约束，
 * 不该由调用方每次自己记。
 */
export function createCanvasDataPlugin(
  opts: Omit<CanvasBaseOptions, 'pluginName' | 'core'> = {},
): CanvasDataAssembly {
  const assembly = createCanvasBasePlugin({
    ...opts,
    pluginName: CANVAS_DATA_PLUGIN_NAME,
    core: false,
  })
  return { name: assembly.name, plugin: assembly.plugin, services: assembly.services }
}
