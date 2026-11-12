/**
 * RenderShell —— 通用渲染底座给整棵树的“外壳上下文”。
 *
 * 为什么放在 vue-render 而不是 ui-shell：Provider 属于渲染底座，将来换成
 * rect-render / 其它渲染器时也要复用同一份外壳上下文。这里只声明“应用级”字段，
 * 不认识 doc / node / viewport；画布专属句柄（host/api/manager）由调用方按需收窄。
 */
import type { InjectionKey, ShallowRef } from 'vue'
import type { ContextWithSlots } from './context'

/** 一次渲染会话的宿主句柄（项目页为 undefined）。各渲染器自己决定真实类型。 */
export interface RenderSession {
  host?: unknown
  api?: unknown
  manager?: unknown
}

export interface RenderShell {
  /** 根级唯一内核 Context（应用级服务常驻）。 */
  ctx: ContextWithSlots
  /** 应用级底座实例；真实类型由入口决定（画布是 save/resources/注册表/命令）。 */
  appBase: unknown
  /** 当前会话宿主；项目页为 undefined。 */
  sessionHost: ShallowRef<unknown>
  /** 登记 / 清空当前会话。 */
  setSession(session?: RenderSession): void
}

/** 与历史 APP_SHELL_KEY 同一个注入名：外部插件包自带一份实现也能对上。 */
export const RENDER_SHELL_KEY: InjectionKey<RenderShell> = Symbol.for('plume-canvas-app-shell')

/** bootstrap 的返回值：Provider 只负责在卸载时调用 dispose。 */
export interface RenderBootstrapResult {
  ctx: ContextWithSlots
  appBase: unknown
  dispose?: () => void | Promise<void>
}
