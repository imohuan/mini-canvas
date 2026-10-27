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
import { RENDER_CONTEXT_KEY } from './renderContext'

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

/**
 * 单令牌：CanvasProvider provide、外壳与画布组件经 useCanvasContext() 取。
 *
 * **故意用固定字符串 key 而不是 Symbol**：UMD/ESM 插件包内自带一份 canvas-render
 * （不与宿主共享模块实例），Symbol 会因"两份模块各建一个"而永远对不上 —— 插件组件
 * 在外壳槽里 useCanvasContext() 必然取不到宿主 provide 的那份，抛"缺少画布上下文"
 * （2026-10-28 shell-slots-demo 真机实测）。字符串 key 让两份实现共享同一个注入名，
 * 与 DOM 的 data-* 契约同一思路。
 */
export const CANVAS_CONTEXT_KEY: InjectionKey<CanvasContext> = Symbol.for('mini-canvas-context')

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

/**
 * 读入口专用的“宽松”取 ctx：先基础上下文，再回退渲染上下文。
 *
 * 只给 useUiComponent / useThemeColor / useToolbarOffsets 这类「给我 ctx 就行」的 helper 用；
 * 外壳和业务组件不要拿它当通用入口 —— 那会把“我到底在哪个上下文里”重新变模糊。
 *
 * 为什么需要：仓库里大量现有单测只 provide RENDER_CONTEXT_KEY（历史上渲染上下文是唯一入口）。
 * 读取插槽/目录/设置的 helper 不应该逼这些测试全部重写；真正的边界由 useCanvasContext 守住。
 */
export function useCanvasContextOrRender(): CanvasContext {
  const base = inject(CANVAS_CONTEXT_KEY, null)
  if (base) return base
  const render = inject(RENDER_CONTEXT_KEY, null)
  if (render) {
    return {
      ctx: render.ctx,
      host: render.host,
      api: undefined as unknown as MiniCanvasApi,
      manager: undefined as unknown as PluginManager,
    }
  }
  return useCanvasContext()
}
