/**
 * app-shell —— 根级 Provider 与画布页之间的契约。
 *
 * 单独成文件的原因：<script setup> 里不能写 export 语句，
 * 而 App.vue 与 AppProvider.vue 都要用同一个注入键与类型。
 */
import type { ShallowRef } from 'vue'
import type { Context, CanvasAppBaseServices } from '@mini-canvas/canvas-data'
import type { CanvasHostHandle, MiniCanvasApi } from '@mini-canvas/canvas-render'
import type { PluginManager } from '@mini-canvas/canvas-render'
import { RENDER_SHELL_KEY } from '@mini-canvas/vue-render'

/** 一次画布会话的三件宿主句柄。 */
export interface AppCanvasSession {
  host: CanvasHostHandle
  api: MiniCanvasApi
  manager: PluginManager
}

/** 根级 Provider 给整棵树的东西：应用级底座 + 可选的当前画布会话。 */
export interface AppShell {
  /** 根级唯一 Context（应用级服务常驻）。 */
  ctx: Context
  /** 应用级底座实例（save/resources/注册表/命令）。 */
  appBase: CanvasAppBaseServices
  /** 当前画布会话的宿主；项目页为 undefined。 */
  sessionHost: ShallowRef<CanvasHostHandle | undefined>
  /** 登记/清空当前画布会话。 */
  setSession(session: AppCanvasSession | undefined): void
}

/**
 * 外壳注入键：Provider 本体在 `@mini-canvas/vue-render`，这里只取同一个键
 * （Symbol.for 同名），外壳组件按自己的 `AppShell` 类型收窄。
 */
export const APP_SHELL_KEY = RENDER_SHELL_KEY as unknown as import('vue').InjectionKey<AppShell>
