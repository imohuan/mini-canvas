/**
 * theme-canvas —— 默认主题里的**画布外观**部分（进入画布才启动）。
 *
 * 注册的全是"有画布才看得见"的东西：节点壳、连线、背景、拖线临时线，
 * 以及节点上下工具栏的挂载点。项目页不需要它们，也不该为它们启动画布。
 *
 * 为什么 inject: ['doc']：这些槽最终都要挂在节点/画布上；没有 doc 时启动
 * 只会注册一堆取不到数据的组件，反而让 PENDING 状态更清楚。
 */
import type { PluginModule, PluginScope } from "@mini-canvas/canvas-base"
import { NodeToolbarService } from "@mini-canvas/canvas-render"
import BaseNode from "./components/node/BaseNode.vue"
import CustomEdge from "./components/edge/CustomEdge.vue"
import DefaultBackground from "./components/background/DefaultBackground.vue"
import ConnectionLine from "./components/edge/ConnectionLine.vue"
import MovingHandle from "./components/node/MovingHandle.vue"
import NodeModeTopBar from "./components/node/NodeModeTopBar.vue"
import NodeModeBottomBar from "./components/node/NodeModeBottomBar.vue"

export const name = "theme-canvas"
export const inject = ['doc'] as string[]

export function apply(ctx: PluginScope) {
  const toolbarSvc = ctx.tryGet<NodeToolbarService>("nodeToolbar")
  void toolbarSvc

  ctx.nodes.attach("*", { region: "out:top", id: "theme-default/node-top-slot", component: NodeModeTopBar })
  ctx.nodes.attach("*", { region: "out:bottom", id: "theme-default/node-bottom-slot", component: NodeModeBottomBar })

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

export const themeCanvasPlugin: PluginModule = { name, inject, apply }
