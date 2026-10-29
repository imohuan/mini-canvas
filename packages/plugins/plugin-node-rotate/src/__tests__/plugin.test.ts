import { describe, it, expect } from 'vitest'
import { Context } from '@mini-canvas/canvas-data'
import { nodeRotatePlugin } from '../index'

describe('plugin-node-rotate 装配 smoke', () => {
  it('插件可装配：插槽条目注册（顶栏入口 + 外壳演示按钮）；主题缺席时静默降级不抛', async () => {
    const ctx = new Context()
    ctx.plugin(nodeRotatePlugin)
    await expect(ctx.start()).resolves.toBeUndefined()
    // 顶栏入口（方式 A 的硬注册，与主题无关）
    expect(ctx.slots.occupants('image.topToolbar').some((e) => e.id === 'node-rotate/entry')).toBe(true)
    // 外壳状态条的演示按钮
    expect(ctx.slots.occupants('shell.status').some((e) => e.id === 'node-rotate/demo')).toBe(true)
    // 卸载后条目回收
    expect(ctx.uninstallPlugin('node-rotate')).toBe(true)
    expect(ctx.slots.occupants('image.topToolbar').some((e) => e.id === 'node-rotate/entry')).toBe(false)
    expect(ctx.slots.occupants('shell.status').some((e) => e.id === 'node-rotate/demo')).toBe(false)
    ctx.stop()
  })

  it('主题已装（nodeToolbar 服务在）：功能模式注册成功，id = node-rotate/mode', async () => {
    const ctx = new Context()
    const modes: unknown[] = []
    ctx.provide('nodeToolbar', { registerMode: (m: unknown) => void modes.push(m) })
    ctx.plugin(nodeRotatePlugin)
    await ctx.start()
    const ids = modes.map((m) => (m as { id?: string }).id)
    expect(ids).toContain('node-rotate/mode')
    ctx.stop()
  })
})
