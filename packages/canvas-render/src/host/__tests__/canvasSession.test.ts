/**
 * 画布会话：根级 Context 常驻，进入画布才装 doc/selection，离开就回退。
 *
 * 这是「项目页不启动画布」的核心证据：同一条 Context 上，
 *   mountCanvas → doc 出现；unmountCanvas → doc 消失、依赖插件回退 PENDING。
 */
import { describe, it, expect } from 'vitest'
import { Context, createCanvasAppBasePlugin, MemoryStorageAdapter } from '@mini-canvas/canvas-data'
import { mountCanvas, unmountCanvas, hasActiveCanvasSession } from '../canvasSession'
import type { PluginModule } from '@mini-canvas/kernel'

async function bootApp() {
  const ctx = new Context()
  const app = createCanvasAppBasePlugin({ adapter: new MemoryStorageAdapter(), persistSettings: false })
  ctx.plugin(app.plugin)
  await ctx.start()
  return { ctx, app }
}

describe('mountCanvas / unmountCanvas', () => {
  it('进入画布后 doc/selection/view 都在，离开后全部消失', async () => {
    const { ctx, app } = await bootApp()
    expect(ctx.hasService('doc')).toBe(false)

    const session = await mountCanvas({ ctx, appBase: app.services, plugins: [] })
    for (const name of ['doc', 'selection', 'view', 'canvas', 'nodeToolbar']) {
      expect(ctx.hasService(name), name + ' 未注入').toBe(true)
    }
    expect(hasActiveCanvasSession()).toBe(true)

    await session.dispose()
    for (const name of ['doc', 'selection', 'canvas']) {
      expect(ctx.hasService(name), name + ' 未撤销').toBe(false)
    }
    expect(hasActiveCanvasSession()).toBe(false)
    // 应用级服务不受影响：项目页仍能读设置/资源
    expect(ctx.hasService('save')).toBe(true)
    expect(ctx.hasService('resources')).toBe(true)
    ctx.stop()
  })

  it('业务插件只在画布内启动；离开画布回退 PENDING，再进画布重新启动', async () => {
    const { ctx, app } = await bootApp()
    let applied = 0
    const biz: PluginModule = {
      name: 'biz-node',
      inject: ['doc'],
      apply() {
        applied += 1
      },
    }
    ctx.installPlugin(biz)
    expect(applied).toBe(0)
    expect(ctx.inspectPlugins().find((p) => p.name === 'biz-node')?.state).toBe('pending')

    await mountCanvas({ ctx, appBase: app.services, plugins: [] })
    expect(applied).toBe(1)

    await unmountCanvas()
    expect(ctx.inspectPlugins().find((p) => p.name === 'biz-node')?.state).toBe('pending')

    await mountCanvas({ ctx, appBase: app.services, plugins: [] })
    expect(applied).toBe(2)
    await unmountCanvas()
    ctx.stop()
  })

  it('重复 unmountCanvas 不报错；重复 mount 先卸旧会话', async () => {
    const { ctx, app } = await bootApp()
    await mountCanvas({ ctx, appBase: app.services, plugins: [] })
    await mountCanvas({ ctx, appBase: app.services, plugins: [] })
    await unmountCanvas()
    await unmountCanvas()
    expect(ctx.hasService('doc')).toBe(false)
    ctx.stop()
  })
})
