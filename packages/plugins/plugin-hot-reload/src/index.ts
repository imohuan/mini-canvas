/**
 * plugin-hot-reload · 热重载插件（KV 门铃通知 → HEAD 对比 → 自动重装）。
 *
 * ## 最终形态（用户口径）
 *
 *   watch 工具：盯 src → 自动 build → 成功后 PUT /api/kv/config/plugin-watch:<插件名>
 *   后台：      KV 写 → /api/kv/events 推 {type:'config', key:'plugin-watch:<名>'}（现成，零改动）
 *   本插件：    监听该前缀 → HEAD 对比产物 → 变了才拉新重装 → 弹通知
 *
 * 没有可登记的 SSE 链接、没有 UI 面板 —— 监听是自动的（复用宿主共享 KV 通道，零新连接），
 * 提示走右下角 vue-sonner 通知。装载即生效，宿主 APP_PLUGINS 放 hotReloadPlugin 一个即可。
 *
 * ## 导出面
 *
 * - hotReloadPlugin：宿主装配用（推荐）
 * - createHotReload / HotReload：数据层（测试、或宿主想自建 UI 时用）
 * - PLUGIN_WATCH_PREFIX：watch 工具 PUT 的 key 前缀约定
 */
import { createHotReload, type HotReload } from './data/hotReload'
import type { Context } from '@mini-canvas/canvas-data'

export const name = 'hot-reload'
export const inject = [] as string[]

export { createHotReload }
export type { HotReload, HotReloadSource, HotReloadState, HotReloadLogEntry, HotReloadDeps } from './data/hotReload'
export { looksLikeUrl, pathOf, PLUGIN_WATCH_PREFIX } from './data/hotReload'

/** 挂到 window 的默认 key（与 window.MiniCanvasUI / MiniCanvasPlugin 并列） */
export const HOT_RELOAD_WINDOW_KEY = 'MiniCanvasHotReload'

/**
 * **热重载插件本体** —— 宿主 APP_PLUGINS 里放这一个就完事：
 * 单例挂 window + 服务上架 + KV 变更监听启动（收到通知自动重装并弹通知）。
 */
export const hotReloadPlugin = {
  name,
  inject: [] as string[],
  apply(ctx: Context) {
    // 单例：挂 window（幂等 —— 已挂就用那一个），别的插件/控制台共享同一份
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
  },
} as const
