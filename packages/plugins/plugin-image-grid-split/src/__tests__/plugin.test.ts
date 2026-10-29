import { describe, it, expect } from 'vitest'
import { Context } from '@mini-canvas/canvas-data'
import { gridSplitPlugin } from '../index'

describe('plugin-image-grid-split 装配 smoke', () => {
  it('插件可装配：插槽条目注册；主题缺席时静默降级不抛', async () => {
    const ctx = new Context()
    ctx.plugin(gridSplitPlugin)
    await expect(ctx.start()).resolves.toBeUndefined()
    // 插槽条目在（方式 A 的硬注册，与主题无关）
    const slot = ctx.slots.occupants('image.topToolbar')
    expect(slot.some((e) => e.id === 'image-grid-split/entry')).toBe(true)
    // 卸载后条目回收
    expect(ctx.uninstallPlugin('image-grid-split')).toBe(true)
    expect(ctx.slots.occupants('image.topToolbar').some((e) => e.id === 'image-grid-split/entry')).toBe(false)
    ctx.stop()
  })

  it('主题已装（nodeToolbar 服务在）：功能模式注册成功', async () => {
    const ctx = new Context()
    // 最小 nodeToolbar 桩：只实现 registerMode（插件只调这一个方法）
    const modes: unknown[] = []
    ctx.provide('nodeToolbar', { registerMode: (m: unknown) => void modes.push(m) })
    ctx.plugin(gridSplitPlugin)
    await ctx.start()
    const ids = modes.map((m) => (m as { id?: string }).id)
    expect(ids).toContain('image-grid-split/workbench')
    ctx.stop()
  })
})
