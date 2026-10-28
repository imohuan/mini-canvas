import { describe, expect, it } from 'vitest'
// 用**画布版** Context（canvas-data）：设置页依赖 ctx.slots，裸内核没有这一层。
import { Context } from '@mini-canvas/canvas-data'
import { hotReloadPlugin, HOT_RELOAD_NAV_ID } from '../index'

/**
 * 调试插件自己的设置页必须真的挂上，而且**不与「插件管理」的页共用同一个 id**。
 *
 * 为什么要有这条：两个插件是独立入口，页 id 撞了就会互相顶掉（后注册的覆盖先注册的）——
 * 表现是「有时看不到插件页、有时看不到调试页」，很难查。
 */
describe('热重载插件的设置页接线', () => {
  it('注册「调试插件」导航项与对应正文页', async () => {
    const ctx = new Context()
    await ctx.start()
    try {
      ctx.installPlugin(hotReloadPlugin as never)
      const nav = ctx.slots.occupants('settings.nav').map((o) => o.id)
      const body = ctx.slots.occupants('settingsGroup/' + HOT_RELOAD_NAV_ID).map((o) => o.id)
      expect(nav).toContain('hot-reload/nav')
      expect(body).toContain('hot-reload/page')
    } finally {
      ctx.stop()
    }
  })

  it('导航 id 与插件管理页不同（两个独立入口，不互相覆盖）', () => {
    expect(HOT_RELOAD_NAV_ID).not.toBe('插件')
  })

  it('卸载后页与 window 单例一起回收（不留空壳）', async () => {
    const ctx = new Context()
    await ctx.start()
    const w = globalThis as Record<string, unknown>
    try {
      ctx.installPlugin(hotReloadPlugin as never)
      expect(w.MiniCanvasHotReload).toBeDefined()
      expect(ctx.slots.occupants('settings.nav').some((o) => o.id === 'hot-reload/nav')).toBe(true)

      ctx.uninstallPlugin('hot-reload')
      expect(w.MiniCanvasHotReload, 'window 上的单例要跟着摘掉').toBeUndefined()
      expect(ctx.slots.occupants('settings.nav').some((o) => o.id === 'hot-reload/nav')).toBe(false)
    } finally {
      delete w.MiniCanvasHotReload
      ctx.stop()
    }
  })
})
