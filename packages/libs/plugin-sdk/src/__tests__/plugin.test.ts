/**
 * canvas-base 的插件身份：应用级底座只提供 save / resources 这类「与当前画布无关」的服务。
 *
 * 画布数据（doc / selection）属于 canvas-data 会话插件；这里如果冒出 doc，
 * 说明底座又把会话服务绑进了应用生命周期，项目页就会被强行要求启动一张画布。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@plume-canvas/canvas-data'
import { MemoryStorageAdapter } from '@plume-canvas/canvas-data'
import { canvasBasePlugin, createCanvasBaseAppPlugin, CANVAS_BASE_PLUGIN_NAME } from '../plugin'

describe('canvas-base 插件身份', () => {
  it('插件名就是分层名 canvas-base', () => {
    const assembly = createCanvasBaseAppPlugin()
    expect(CANVAS_BASE_PLUGIN_NAME).toBe('canvas-base')
    expect(assembly.name).toBe('canvas-base')
    expect(assembly.plugin.name).toBe('canvas-base')
    expect(assembly.plugin.inject).toEqual([])
  })

  it('装上后 save / resources 可用，doc / selection 仍不存在', async () => {
    const ctx = new Context()
    const assembly = createCanvasBaseAppPlugin({ adapter: new MemoryStorageAdapter() })
    ctx.plugin(assembly.plugin)
    await ctx.start()

    expect(ctx.hasService('save')).toBe(true)
    expect(ctx.hasService('resources')).toBe(true)
    expect(ctx.get('save')).toBe(assembly.services.save)
    // 会话服务不该在应用级就出现
    expect(ctx.hasService('doc')).toBe(false)
    expect(ctx.hasService('selection')).toBe(false)
    expect(ctx.hasService('view')).toBe(false)
    ctx.stop()
  })

  it('canvasBasePlugin() 每次给一份新的插件模块（实例不跨 Context 共用）', () => {
    expect(canvasBasePlugin()).not.toBe(canvasBasePlugin())
  })
})
