/**
 * @plume-canvas/plugin-theme-canvas —— 默认主题的**画布外观**半边（进入画布才启动）。
 *
 * 注册的全是"有画布才看得见"的东西：节点壳、连线、背景、拖线临时线，
 * 以及节点上下工具栏的挂载点。项目页不需要它们，也不该为它们启动画布。
 *
 * 为什么 inject: ['doc']：这些槽最终都要挂在节点/画布上；没有 doc 时启动
 * 只会注册一堆取不到数据的组件，反而让 PENDING 状态更清楚。
 *
 * 与通用组件半边的关系：互不 import。共享的默认值与设置键在 @plume-canvas/theme-contract；
 * 本包自己的 Config 只声明画布相关字段（端口 / 标题 / 吸附带 / 连线）。
 */
import type { InferConfig, PluginModule, PluginScope } from "@plume-canvas/canvas-base"
import { NodeToolbarService } from "@plume-canvas/canvas-render"
import { CanvasConfig } from "@plume-canvas/theme-contract"
import BaseNode from "./components/node/BaseNode.vue"
import CustomEdge from "./components/edge/CustomEdge.vue"
import DefaultBackground from "./components/background/DefaultBackground.vue"
import ConnectionLine from "./components/edge/ConnectionLine.vue"
import MovingHandle from "./components/node/MovingHandle.vue"
import NodeModeTopBar from "./components/node/NodeModeTopBar.vue"
import NodeModeBottomBar from "./components/node/NodeModeBottomBar.vue"

export const name = "theme-canvas"
export const inject = ['doc'] as string[]
/** 本包的配置声明：端口 / 标题 / 吸附带 / 连线（纯数据来自 theme-contract）。 */
export const Config = CanvasConfig

export interface ThemeCanvasConfig extends InferConfig<typeof Config> {}

export function apply(ctx: PluginScope, config?: ThemeCanvasConfig) {
  void config
  const toolbarSvc = ctx.tryGet<NodeToolbarService>("nodeToolbar")
  void toolbarSvc

  ctx.nodes.attach("*", { region: "out:top", id: "theme-canvas/node-top-slot", component: NodeModeTopBar })
  ctx.nodes.attach("*", { region: "out:bottom", id: "theme-canvas/node-bottom-slot", component: NodeModeBottomBar })

  ctx.theme.register("nodeShell", BaseNode)
  ctx.theme.register("edge", CustomEdge)
  ctx.theme.register("background", DefaultBackground)
  ctx.theme.register("connectionLine", ConnectionLine)
  ctx.theme.register("edgeDefaultType", "custom")

  // 端口 / 拖线临时线也进通用目录：业务插件（多选）按名取同款组件。
  const ui = ctx.registryOf<unknown>("ui")
  ui.add("movingHandle", MovingHandle, { id: "default" })
  ui.add("connectionLine", ConnectionLine, { id: "default" })
  ui.add("nodeModeTopBar", NodeModeTopBar, { id: "default" })
  ui.add("nodeModeBottomBar", NodeModeBottomBar, { id: "default" })
}

export const themeCanvasPlugin: PluginModule = { name, inject, Config, apply }

/**
 * 节点工具栏基础设施出口：
 * - NodeToolbarService / NodeToolbarMode：模式注册表 + 会话（服务已按名 'nodeToolbar' 上架）。
 * - NodeModeTopBar / NodeModeBottomBar：默认渲染器（BaseNode 的上/下段经它们透传或替换）。
 */
export { NodeToolbarService } from "@plume-canvas/canvas-render"
export type { NodeToolbarMode } from "@plume-canvas/canvas-render"
export { default as NodeModeTopBar } from "./components/node/NodeModeTopBar.vue"
export { default as NodeModeBottomBar } from "./components/node/NodeModeBottomBar.vue"

/**
 * 渲染件出口（供其它插件复用同一套外观）。
 *
 * - MovingHandle：节点浮动端口，支持 preview 模式（只复用外观、不注册真实连接点）。
 * - ConnectionLine / CustomEdge：拖线临时线与正式边（临时线内部委托给 CustomEdge）。
 */
export { default as MovingHandle } from "./components/node/MovingHandle.vue"
/**
 * 节点加载态视觉件（随节点壳一起住在本包）。
 *
 * 视频内容 / 预览 / 状态栏直接 import 本入口复用同一份实现；
 * 节点壳自己也在用，所以它属于「画布外观」而不是某个业务插件。
 */
export { default as NodeLoadingState } from "./components/node/NodeLoadingState.vue"
export { default as ConnectionLine } from "./components/edge/ConnectionLine.vue"
export { default as CustomEdge } from "./components/edge/CustomEdge.vue"

