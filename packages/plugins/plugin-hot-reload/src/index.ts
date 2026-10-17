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
import HotReloadNav from './components/HotReloadNav.vue'
import HotReloadManager from './components/HotReloadManager.vue'

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
 * **推荐用下面的 hotReloadPlugin**（完整插件：单例 + 面板 + KV 监听一步到位）。
 * 这个工厂留给"宿主想自己管理单例生命周期"的特殊场景。
 */
export function createHotReloadPlugin(reloader: HotReload) {
  return {
    name,
    apply(ctx: { inject(name: string, impl: unknown): void }) {
      ctx.inject('hot-reload', reloader)
    },
  }
}

// ==================== 完整插件（宿主一行装配） ====================

import { markRaw } from 'vue'
import type { ConfigSchema, PluginModule } from '@mini-canvas/kernel'
import type { Context } from '@mini-canvas/canvas-data'

/** 设置面板一级分类名（= settingsNav 的 id，也是 settingsGroup/<此名> 的槽键） */
export const HOT_RELOAD_NAV_ID = '热重载'

/**
 * 占位分组（必须有）：设置面板正文只从 settings.groups() 推导 —— 只注册 settingsNav
 * 没有同名分组时，面板什么都不渲染（实测踩到）。声明只有自己一格的扁平分组，
 * 面板就把它当这一页渲染（与 plugin-showcase 同款做法）。
 */
const Config: ConfigSchema = {
  hotReloadHint: {
    type: 'string',
    default: '',
    label: '热重载',
    group: HOT_RELOAD_NAV_ID,
    description: '链接列表见本页正文（这一项只是分类占位，不用改）。',
  },
}

/**
 * **热重载插件本体** —— 宿主 APP_PLUGINS 里放这一个就完事：
 * 单例挂 window + 服务上架 + 设置面板「热重载」分类 + KV 变更监听启动。
 *
 * 装载即生效：KV 通知（watch 工具 build 后 PUT 的 plugin-watch:<名>）一到就
 * HEAD 对比产物、变了自动重装并弹通知 —— 宿主不需要写任何热重载代码。
 */
export const hotReloadPlugin: PluginModule = {
  name,
  inject: [] as string[],
  Config,
  apply(ctx: Context) {
    // 单例：挂 window（幂等 —— 已挂就用那一个），别的面板/控制台共享同一份
    const w = globalThis as unknown as Record<string, unknown>
    const manager =
      (w[HOT_RELOAD_WINDOW_KEY] as ReturnType<typeof createHotReload> | undefined) ??
      createHotReload({
        // 视觉反馈：自动重装成功 → 右下角 vue-sonner 通知（缺省实现，见 data/hotReload.ts）。
      })
    if (w[HOT_RELOAD_WINDOW_KEY] === undefined) w[HOT_RELOAD_WINDOW_KEY] = manager

    // 服务上架：别的插件可 ctx.get('hot-reload') 拿同一份
    ctx.inject('hot-reload', manager)

    // KV 变更监听：复用宿主共享通道（零新连接），页面卸载自动断开
    ctx.effect(() => manager.watchPluginChanges())

    // ① 设置面板左导航项
    ctx.slots.register('settingsNav', {
      id: HOT_RELOAD_NAV_ID,
      order: 90,
      component: markRaw(HotReloadNav),
      meta: { title: HOT_RELOAD_NAV_ID },
    })
    // ② 分类正文（整页由本插件接管）
    ctx.slots.register('settingsGroup/' + HOT_RELOAD_NAV_ID, {
      id: 'plugin-hot-reload-page',
      order: 90,
      component: markRaw(HotReloadManager),
      meta: { mode: 'replace' },
    })
  },
}
