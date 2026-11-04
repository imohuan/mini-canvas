/**
 * 默认主题拆分出的两个插件（旧入口 themeDefaultPlugin 仍组合它们）。
 *
 * - theme-components：通用组件 / 设置面板 / 外观变量，应用级常驻；
 * - theme-canvas：节点壳 / 连线 / 背景 / 节点工具栏，进画布才启动。
 */
import type { PluginModule } from "@mini-canvas/canvas-base"
import { themeComponentsPlugin, apply as applyComponents } from "./themeComponents"
import { themeCanvasPlugin, apply as applyCanvas } from "./themeCanvas"
import { Config } from "./themeConfig"

export { themeComponentsPlugin } from "./themeComponents"
export { themeCanvasPlugin } from "./themeCanvas"

/**
 * 旧入口：一个插件里同时跑通用组件与画布外观，行为与拆分前一致。
 * 新装配请分开用，让项目页不必启动画布外观。
 */
export const themeDefaultPlugin: PluginModule = {
  name: "theme-default",
  inject: [],
  Config,
  apply(ctx, config) {
    applyComponents(ctx, config as never)
    applyCanvas(ctx)
  },
}
