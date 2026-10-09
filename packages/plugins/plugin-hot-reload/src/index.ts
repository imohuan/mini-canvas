/**
 * plugin-hot-reload · 共享入口（宿主装配用）。
 *
 * 值只有一个：**一次装配、多处复用**的「热重载管理器」规格。宿主（packages/ui）在启动时
 * 把 `createHotReload(...)` 挂到 window 上（如 `window.MiniCanvasHotReload`），
 * 于是插件管理页、独立设置页、控制台都能拿到**同一份**状态与停止句柄。
 *
 * 为什么要这份共享：热重载的"正在监听哪些链接"必须**全局唯一** —— 两处各存一份，
 * 开了开关又开另一条通道，会出现"同一个插件被重装两遍"。收成一个单例就没有这个问题。
 */
import { createHotReload, type HotReload } from './data/hotReload'

export const name = 'hot-reload'
export const inject = [] as string[]

export { createHotReload }
export type { HotReload, HotReloadSource, HotReloadState, HotReloadLogEntry, HotReloadDeps } from './data/hotReload'
export { looksLikeUrl, pathOf } from './data/hotReload'
export { default as HotReloadNav } from './components/HotReloadNav.vue'
export { default as HotReloadPage } from './components/HotReloadPage.vue'
export { default as HotReloadManager } from './components/HotReloadManager.vue'

/** 挂到 window 的默认 key（与 window.MiniCanvasUI / MiniCanvasPlugin 并列） */
export const HOT_RELOAD_WINDOW_KEY = 'MiniCanvasHotReload'

/**
 * 建宿主装配用的插件对象（可选）。
 *
 * 目前本插件**不冷启动装配**（链接列表是开发期的东西，不该进生产装配）。
 * 想让它冷启动进画布，把这个对象加进 APP_PLUGINS 即可 —— 它不含自己的设置分类（那由
 * packages/ui 的 settingsPanel 提供，见 ui/hotReloadPlugin.ts）。
 */
export function createHotReloadPlugin(reloader: HotReload) {
  return {
    name,
    apply(ctx: { inject(name: string, impl: unknown): void }) {
      ctx.inject('hot-reload', reloader)
    },
  }
}
