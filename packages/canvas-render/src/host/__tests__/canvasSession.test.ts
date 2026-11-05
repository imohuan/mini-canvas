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
    for (const name of ['doc', 'selection', 'canvas', 'nodeToolbar']) {
      expect(ctx.hasService(name), name + ' 未撤销').toBe(false)
    }
    // 项目页的插件靠 tryGet('doc') 判断"现在有没有画布"，这一步必须彻底。
    expect(ctx.tryGet('doc')).toBeUndefined()
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

  /**
   * 应用级插件也有画布钩子。
   *
   * 用户实测 2026-11-05：选中图片底栏不出现 —— cloud-client 是应用级插件，
   * 它的 onCanvasReady 负责把云端动作清单注册进 node/bar，但之前只对画布级清单调用，
   * 于是底栏一条动作都没有。
   */
  it('应用级插件的 onCanvasReady 也会被调用，且每次进画布只调一次', async () => {
    const ctx = new Context()
    const app = createCanvasAppBasePlugin({ adapter: new MemoryStorageAdapter(), persistSettings: false })
    let readyCalls = 0
    let disposeCalls = 0
    const appPlugin: PluginModule & { onCanvasReady?: (c: unknown) => () => void } = {
      name: 'app-level-cloud',
      apply() {},
      onCanvasReady() {
        readyCalls += 1
        return () => {
          disposeCalls += 1
        }
      },
    }
    ctx.plugin(app.plugin)
    ctx.plugin(appPlugin)
    await ctx.start()

    await mountCanvas({ ctx, appBase: app.services, plugins: [] })
    expect(readyCalls, '应用级插件没收到画布钩子').toBe(1)

    await unmountCanvas()
    expect(disposeCalls, '离开画布时钩子的清理没跑').toBe(1)

    await mountCanvas({ ctx, appBase: app.services, plugins: [] })
    expect(readyCalls, '第二次进画布应当再挂一次').toBe(2)
    await unmountCanvas()
    ctx.stop()
  })

  it('同一插件同时出现在两份清单里时只调一次钩子', async () => {
    const ctx = new Context()
    const app = createCanvasAppBasePlugin({ adapter: new MemoryStorageAdapter(), persistSettings: false })
    let readyCalls = 0
    const shared: PluginModule & { onCanvasReady?: (c: unknown) => void } = {
      name: 'shared-hook',
      apply() {},
      onCanvasReady() {
        readyCalls += 1
      },
    }
    ctx.plugin(app.plugin)
    ctx.plugin(shared)
    await ctx.start()
    await mountCanvas({ ctx, appBase: app.services, plugins: [shared] })
    expect(readyCalls).toBe(1)
    await unmountCanvas()
    ctx.stop()
  })

  it('第二次进画布：插件已登记过，只恢复会话服务，不重装（用户实测回归）', async () => {
    const { ctx, app } = await bootApp()
    const plugin: PluginModule = {
      name: 'biz-node',
      inject: ['doc'],
      apply() {},
    }
    await mountCanvas({ ctx, appBase: app.services, plugins: [plugin] })
    await unmountCanvas()

    // 再进一次：插件仍在清单里，不能因重名抛错
    await expect(
      mountCanvas({ ctx, appBase: app.services, plugins: [plugin] }),
    ).resolves.toBeTruthy()
    expect(ctx.hasService('doc')).toBe(true)
    await unmountCanvas()
    ctx.stop()
  })

  it('画布 A → B：先卸旧再装新，旧会话的落盘在换画布前完成', async () => {
    const { ctx, app } = await bootApp()
    const first = await mountCanvas({ ctx, appBase: app.services, plugins: [] })
    const firstDoc = ctx.get('doc')

    let secondDoc: unknown
    const second = await mountCanvas({ ctx, appBase: app.services, plugins: [] })
    secondDoc = ctx.get('doc')

    // 换画布后服务指向新会话，不是旧会话留下的那一份。
    expect(secondDoc).not.toBe(firstDoc)
    expect(hasActiveCanvasSession()).toBe(true)
    // 旧句柄已经卸过：再 dispose 一次是安全 no-op，也不会把新会话带走。
    await first.dispose()
    expect(ctx.get('doc')).toBe(secondDoc)
    await second.dispose()
    expect(ctx.hasService('doc')).toBe(false)
    ctx.stop()
  })

  it('连续快速 mount 时，旧 mount 的异步恢复不会覆盖最后一份画布', async () => {
    const { ctx, app } = await bootApp()
    // 不 await 第一次：模拟用户在切换动画里连续点两张画布。
    // 两次挂载必须在同一条串行队列上排队，否则第二次会撞上重名 canvas-data。
    const racing = mountCanvas({ ctx, appBase: app.services, plugins: [] })
    const latest = await mountCanvas({ ctx, appBase: app.services, plugins: [] })
    const earlier = await racing

    // 先挂的那次会被后一次先卸掉；最终活动的是最后一次。
    expect(earlier).not.toBe(latest)
    expect(hasActiveCanvasSession()).toBe(true)
    expect(ctx.tryGet('doc')).toBeTruthy()
    // 旧句柄再 dispose 一次是 no-op，不能带走新会话。
    await earlier.dispose()
    expect(ctx.tryGet('doc')).toBeTruthy()
    await latest.dispose()
    expect(hasActiveCanvasSession()).toBe(false)
    ctx.stop()
  })

  it('换画布会回收旧会话的订阅、定时器与 onCanvasReady 清理', async () => {
    const { ctx, app } = await bootApp()
    const cleanups: string[] = []
    // 直接数"还活着的定时器"：比看它在多少毫秒里跑了几次稳定得多。
    let liveTimers = 0
    let started = 0
    const plugin: PluginModule = {
      name: 'biz-sync',
      inject: ['doc'],
      apply(scope) {
        started += 1
        // 模拟插件在画布内挂的定时器 / 订阅：挂在**本插件** scope 上，
        // 离开画布（插件回退 PENDING）时必须一起回收。
        scope.effect(() => {
          liveTimers += 1
          const handle = setInterval(() => {}, 1000)
          return () => {
            liveTimers -= 1
            clearInterval(handle)
          }
        })
      },
      // mountCanvas 会把这里的返回值记进本会话的清理表；换画布时必须先执行它。
      onCanvasReady: () => () => {
        cleanups.push('old-session')
      },
    } as PluginModule

    const first = await mountCanvas({ ctx, appBase: app.services, plugins: [plugin] })
    expect(started).toBe(1)
    expect(liveTimers).toBe(1)

    await mountCanvas({ ctx, appBase: app.services, plugins: [plugin] })
    expect(cleanups, '换画布时旧会话的 onCanvasReady 清理没有执行').toEqual(['old-session'])
    expect(started, '新画布里插件应重新启动').toBe(2)
    // 旧定时器必须回收：换画布后只剩新会话那一份，不是两份叠加。
    expect(liveTimers, '旧画布的定时器没有回收').toBe(1)

    await first.dispose()
    await unmountCanvas()
    expect(cleanups).toEqual(['old-session', 'old-session'])
    expect(liveTimers, '离开画布后定时器仍在').toBe(0)
    ctx.stop()
  })
})
