/**
 * CanvasContext —— 画布体系最外层的“基础上下文”。
 *
 * 为什么单独立一层：
 * - 内核 ctx 是所有插件/服务/命令的来源，它不属于 VueFlow；
 * - 外壳（左侧抽屉、状态条、底栏）也需要读取 ctx，但它们不在 CanvasHost 里；
 * - 如果它们用 useCanvasRender()，就会把“外壳”和“画布渲染子树”绑死。
 *
 * 因此由 CanvasProvider 在应用最外层 provide 这一份；它只有 ctx / host / api / manager，
 * **不含** flow、renderNodes、visibleRect 这些只有 VueFlow 挂载后才存在的渲染能力。
 * 需要这些东西的组件仍必须放在 CanvasHost 内，用 useCanvasRender()。
 *
 * 失败策略：找不到就抛错，不回退读 RENDER_CONTEXT_KEY。
 * 回退会让“外壳里拿到了画布上下文”变成静默 bug —— 表面上能跑，实际上依赖了不该依赖的东西。
 */
import { inject, type InjectionKey } from 'vue'
import type { Context } from '@mini-canvas/canvas-data'
import type { CanvasHostHandle, MiniCanvasApi } from '../host/createMiniCanvasHost'
import type { PluginManager } from '../host/pluginManager'

/** 外壳与画布共用的一份基础上下文（不含 VueFlow 专属的 flow / 渲染快照）。 */
export interface CanvasContext {
  /** 内核上下文：服务、命令、配置、插槽都从它取。 */
  ctx: Context
  /** 宿主句柄（ctx 的超集：数据服务 + 落盘/停止语义）。 */
  host: CanvasHostHandle
  /** 宿主统一门面：安装/卸载插件、读写节点等。 */
  api: MiniCanvasApi
  /** 宿主统一安装句柄（热装/热卸/清单）。 */
  manager: PluginManager
}

/** 单令牌：CanvasProvider provide、外壳与画布组件经 useCanvasContext() 取。 */
export const CANVAS_CONTEXT_KEY: InjectionKey<CanvasContext> = Symbol('mini-canvas-context')

/**
 * 取基础上下文。
 *
 * 必须在 <CanvasProvider> 的默认插槽内调用；在 Provider 外会抛清晰错误。
 * 若组件需要视口 / 节点渲染快照 / 连线反馈，请放进 <CanvasHost> 内并用 useCanvasRender()。
 */
export function useCanvasContext(): CanvasContext {
  const base = inject(CANVAS_CONTEXT_KEY, null)
  if (!base) {
    throw new Error(
      '[useCanvasContext] 缺少画布上下文：请把组件放在 <CanvasProvider> 内。' +
        '如果这里需要视口 / 节点渲染快照 / 连线反馈，它应该放在 <CanvasHost> 内并使用 useCanvasRender()。',
    )
  }
  return base
}
