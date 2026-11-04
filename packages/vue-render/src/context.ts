/**
 * 应用级上下文令牌（与 canvas-render 的历史实现保持同一个 Symbol.for 名称）。
 *
 * 为什么用固定字符串 key 而不是普通 Symbol：UMD/ESM 插件包内自带一份实现，
 * Symbol 会因"两份模块各建一个"永远对不上；Symbol.for 让两份实现共享同一个注入名。
 *
 * 这里的 CanvasContext 故意只声明应用级字段（ctx），画布专属 host/api/manager
 * 由 canvas-render 在它的 CanvasContext 里补全；两边结构兼容，旧引用不用改。
 */
import { inject, type InjectionKey } from 'vue'
import type { Context } from '@mini-canvas/kernel'

/** 只声明本包用到的能力段（画布能力层提供，不 import 任何具体包）。 */
export type ContextWithSlots = Context & {
  slots: {
    occupants(slot: string): Array<{
      id: string
      order: number
      before?: string
      after?: string
      component: unknown
    }>
  }
}

/**
 * 兼容超集：canvas-render 的 CanvasContext 有 host/api/manager；
 * 这里把它们声明成可选，既能让项目页只读 ctx，也不破坏画布页的旧用法。
 */
export interface CanvasContext {
  ctx: ContextWithSlots
  /** 画布宿主（只在画布内存在） */
  host?: unknown
  /** 宿主统一门面（只在画布内存在） */
  api?: unknown
  /** 安装句柄（只在画布内存在） */
  manager?: unknown
}

export const CANVAS_CONTEXT_KEY: InjectionKey<CanvasContext> = Symbol.for('mini-canvas-context')

export function useCanvasContext(): CanvasContext {
  const base = inject(CANVAS_CONTEXT_KEY, null)
  if (!base) {
    throw new Error(
      '[useCanvasContext] 缺少应用上下文：请把组件放在 <AppProvider> / <CanvasProvider> 内。',
    )
  }
  return base
}

/**
 * 宽松取 ctx：先应用级上下文，再回退旧渲染上下文（由 canvas-render 提供）。
 * 只给"给我 ctx 就行"的 helper 用；需要 host/api/manager 的组件仍用 useCanvasContext。
 */
export function useCanvasContextOrRender(): CanvasContext {
  const base = inject(CANVAS_CONTEXT_KEY, null)
  if (base) return base
  // 渲染上下文的 key 由 canvas-render 定义；这里用同一个 Symbol.for 名称取，避免反向依赖。
  const render = inject<{
    ctx?: ContextWithSlots
    host?: unknown
    api?: unknown
    manager?: unknown
  } | null>(
    Symbol.for('canvas-v2-render-context') as never,
    null,
  )
  // host / api / manager 一并透传：SettingsHost 这类"要 ctx 也要宿主句柄"的组件
  // 只 provide 了渲染上下文时也得拿到 themeRegistry，否则设置面板永远显示空槽。
  if (render?.ctx) {
    return {
      ctx: render.ctx,
      ...(render.host !== undefined ? { host: render.host } : {}),
      ...(render.api !== undefined ? { api: render.api } : {}),
      ...(render.manager !== undefined ? { manager: render.manager } : {}),
    }
  }
  return useCanvasContext()
}
