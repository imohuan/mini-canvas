/**
 * 默认主题拆分：通用组件常驻，画布外观只在画布内。
 *
 * 验收要求（docs/问题整理/18-…）：项目页要能用 Button / Toaster 这类通用件，
 * 但不该为此注册节点壳 / 连线 / 背景。这里按真实装配跑一遍注册表，不测像素。
 */
import { describe, expect, it } from 'vitest'
import { Context, canvasRuntime, createCanvasAppBasePlugin } from '@mini-canvas/canvas-data'
import {
  themeComponentsPlugin,
  themeCanvasPlugin,
} from '@mini-canvas/plugin-theme-default'
import { shortcutSettingsPlugin } from '@mini-canvas/plugin-shortcut-manager'

async function boot(plugins: unknown[]) {
  const ctx = new Context()
  // 真实根级装配：应用底座先建容器（save/resources/注册表/命令）。
  ctx.plugin(createCanvasAppBasePlugin().plugin)
  for (const p of plugins) ctx.plugin(p as never)
  await ctx.start()
  return ctx
}

describe('主题拆分后的注册边界', () => {
  it('只装 theme-components：ui 目录可用，画布外观为空', async () => {
    const ctx = await boot([themeComponentsPlugin])
    const ui = ctx.registryOf<unknown>('ui')
    expect(ui.keys()).toContain('Button')
    expect(ui.keys()).toContain('Toaster')
    expect(ctx.hasService('notify')).toBe(true)
    // 节点壳 / 边 / 背景都不该被注册
    const theme = canvasRuntime()?.themeRegistry
    expect(theme?.winner('nodeShell')).toBeUndefined()
    expect(theme?.winner('edge')).toBeUndefined()
    expect(theme?.winner('background')).toBeUndefined()
    ctx.stop()
  })

  it('画布内有 doc 时 theme-canvas 才注册外观，通用组件仍在', async () => {
    const ctx = new Context()
    ctx.plugin(createCanvasAppBasePlugin().plugin)
    // 模拟画布会话：doc 到位后，inject 依赖才满足。
    ctx.inject('doc', {
      getNodes: () => [],
      getEdges: () => [],
      getNode: () => undefined,
      replaceAll: () => {},
      types: { has: () => true },
    } as never)
    ctx.plugin(themeComponentsPlugin)
    ctx.plugin(themeCanvasPlugin)
    await ctx.start()
    await new Promise((r) => setTimeout(r, 0))
    const theme = canvasRuntime()?.themeRegistry
    expect(theme).toBeDefined()
    expect(theme?.winner('nodeShell')).toBeTruthy()
    expect(theme?.winner('edge')).toBeTruthy()
    expect(theme?.winner('background')).toBeTruthy()
    expect(ctx.registryOf<unknown>('ui').keys()).toContain('Button')
    ctx.stop()
  })

  it('设置页快捷键：只装应用级插件就有真实配置页，不依赖画布', async () => {
    const ctx = await boot([themeComponentsPlugin, shortcutSettingsPlugin])
    const entry = ctx.slots
      .occupants('settings.nav')
      .find((item) => item.id === 'nav/personal/shortcuts')
    expect(entry, '快捷键配置页没有注册').toBeTruthy()
    expect(ctx.registryOf<unknown>('ui').keys()).toContain('settingsShortcutPanel')
    expect(ctx.tryGet('shortcut-manager')).toBeTruthy()
    ctx.stop()
  })
})
