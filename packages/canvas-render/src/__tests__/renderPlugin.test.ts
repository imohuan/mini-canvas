/**
 * canvasRenderPlugin —— 渲染层插件的最小契约。
 *
 * 锁三件事：能力包确实注册进来了；它不假装提供画布会话服务；卸载/停止后能力条目真正被回收。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@mini-canvas/canvas-data'
import type { CapabilityFactory } from '../contracts/capabilities'
import {
  canvasRenderPlugin,
  canvasRenderPluginName,
  registerStandardCapabilities,
} from '../renderPlugin'

const STANDARD_NAMES = ['node', 'zoom', 'selected', 'selection', 'tools', 'upstream', 'media']

describe('canvasRenderPlugin', () => {
  it('暴露插件名，并在启动后注册标准能力（id/order 固定）', async () => {
    expect(canvasRenderPluginName).toBe('canvas-render')
    expect(canvasRenderPlugin.name).toBe('canvas-render')

    const ctx = new Context()
    ctx.plugin(canvasRenderPlugin)
    await ctx.start()

    const field = ctx.registryOf<CapabilityFactory>('capability')
    expect(field.keys().sort()).toEqual([...STANDARD_NAMES].sort())
    for (const capName of STANDARD_NAMES) {
      const entry = field.get(capName, 'host:standard')
      expect(entry, capName + ' 未注册').toBeTruthy()
      expect(entry!.order).toBe(100)
      expect(entry!.source).toBe('canvas-render')
    }
    ctx.stop()
  })

  it('不提供 doc（渲染层不是画布会话）', async () => {
    const ctx = new Context()
    ctx.plugin(canvasRenderPlugin)
    await ctx.start()
    expect(ctx.hasService('doc')).toBe(false)
    expect(ctx.hasService('selection')).toBe(false)
    expect(ctx.hasService('view')).toBe(false)
    ctx.stop()
  })

  it('卸载插件后能力条目随 fiber 回收', async () => {
    const ctx = new Context()
    ctx.plugin(canvasRenderPlugin)
    await ctx.start()
    const field = ctx.registryOf<CapabilityFactory>('capability')
    expect(field.list('node')).toHaveLength(1)

    expect(ctx.uninstallPlugin('canvas-render')).toBe(true)
    expect(field.keys()).toEqual([])
    expect(field.ids('node')).toEqual([])
    ctx.stop()
  })

  it('停止 Context 后注册场被清空（能力不再可达）', async () => {
    const ctx = new Context()
    ctx.plugin(canvasRenderPlugin)
    await ctx.start()
    expect(ctx.registryOf<CapabilityFactory>('capability').keys().length).toBeGreaterThan(0)

    ctx.stop()
    expect(ctx.registryOf<CapabilityFactory>('capability').keys()).toEqual([])
  })

  it('重复注册不会叠出第二份（宿主与插件共用同一条）', async () => {
    const ctx = new Context()
    ctx.plugin(canvasRenderPlugin)
    await ctx.start()
    const field = ctx.registryOf<CapabilityFactory>('capability')
    const before = field.list('node')

    // 模拟 createMiniCanvasHost 在插件已启动后再走一次注册：同 id 应被跳过。
    registerStandardCapabilities(ctx)

    expect(field.ids('node')).toEqual(['host:standard'])
    expect(field.list('node')).toHaveLength(1)
    expect(field.list('node')[0].source).toBe(before[0].source)
    expect(field.list('node')[0].order).toBe(before[0].order)
    ctx.stop()
  })
})
