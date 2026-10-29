import { describe, it, expect } from 'vitest'
import { Context } from '@mini-canvas/canvas-data'
import { nodeRotatePlugin } from '../index'

describe('plugin-node-rotate 装配 smoke', () => {
  it('插件可装配：只注册顶栏入口；主题缺席时静默降级不抛', async () => {
    const ctx = new Context()
    ctx.plugin(nodeRotatePlugin)
    await expect(ctx.start()).resolves.toBeUndefined()
    // 顶栏入口（方式 A 的硬注册，与主题无关）
    expect(ctx.slots.occupants('image.topToolbar').some((e) => e.id === 'node-rotate/entry')).toBe(true)
    // 状态条不再插演示按钮（入口只在图片顶栏）
    expect(ctx.slots.occupants('shell.status').some((e) => e.id === 'node-rotate/demo')).toBe(false)
    // 卸载后条目回收
    expect(ctx.uninstallPlugin('node-rotate')).toBe(true)
    expect(ctx.slots.occupants('image.topToolbar').some((e) => e.id === 'node-rotate/entry')).toBe(false)
    ctx.stop()
  })

  it('主题已装：功能模式注册成功，顶栏换面板、底栏显式隐藏', async () => {
    const ctx = new Context()
    const modes: unknown[] = []
    ctx.provide('nodeToolbar', { registerMode: (m: unknown) => void modes.push(m) })
    ctx.plugin(nodeRotatePlugin)
    await ctx.start()
    const mode = modes.find((m) => (m as { id?: string }).id === 'node-rotate/mode') as
      | { topBar?: unknown; bottomBar?: unknown }
      | undefined
    expect(mode).toBeDefined()
    expect(mode?.topBar).toBeDefined()
    // null = 这一格不显示（不写 bottomBar 会沿用默认生成栏，旋转时底栏仍出现）
    expect(mode?.bottomBar).toBeNull()
    ctx.stop()
  })
})
