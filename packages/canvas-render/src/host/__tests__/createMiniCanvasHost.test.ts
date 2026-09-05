import { describe, it, expect, afterEach } from 'vitest'
import { createMiniCanvasHost } from '../createMiniCanvasHost'
import { MemoryStorageAdapter, type PluginModule } from '@mini-canvas/canvas-core-v2'

/** 一个最简可热装插件：注册一个 node type 'demo' + 一个服务，供装/卸/重载验证 */
function demoPlugin(flag: string): PluginModule {
  return {
    name: 'demo',
    setup(ctx) {
      ctx.inject('demoSvc', { flag })
      // 手动在 nodeStore 注册类型演示热卸回收
      ctx.get<{ registerType(d: unknown): void }>('nodeStore').registerType({
        type: 'demo',
        label: 'Demo',
        defaultSize: { w: 120, h: 80 },
      })
      ctx.effect(() => () => ctx.get<{ unregisterType(t: string): void }>('nodeStore').unregisterType('demo'))
    },
  }
}

describe('createMiniCanvasHost（可复用宿主门面）', () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>)['MiniCanvas']
  })

  it('冷启动后宿主可用、空 ctx 已 start、可 list 插件', async () => {
    const { host, api } = await createMiniCanvasHost()
    expect(host.ctx.getState()).toBe('started')
    expect(api.listPlugins()).toEqual([])
    expect(api.getNodeStore()).toBe(host.nodeStore)
    expect(api.getRegistry()).toBe(host.nodeRegistry)
  })

  it('api.installPlugin 热装插件立即可用（服务 + nodeStore type）', async () => {
    const { host, api } = await createMiniCanvasHost()
    api.installPlugin(demoPlugin('v1'))
    expect(host.ctx.get<{ flag: string }>('demoSvc').flag).toBe('v1')
    expect(host.nodeStore.types.has('demo')).toBe(true)
    expect(api.listPlugins()).toContain('demo')
  })

  it('api.uninstallPlugin 回收副作用 + 服务 + nodeStore type', async () => {
    const { host, api } = await createMiniCanvasHost()
    api.installPlugin(demoPlugin('v1'))
    expect(api.uninstallPlugin('demo')).toBe(true)
    expect(host.ctx.get('demoSvc')).toBeUndefined()
    expect(host.nodeStore.types.has('demo')).toBe(false)
    expect(api.listPlugins()).not.toContain('demo')
    expect(api.uninstallPlugin('demo')).toBe(false)
  })

  it('api.reloadPlugin 先卸旧再装新（同 name 更新实现）', async () => {
    const { host, api } = await createMiniCanvasHost()
    api.installPlugin(demoPlugin('old'))
    expect(host.ctx.get<{ flag: string }>('demoSvc').flag).toBe('old')

    // 模拟"插件代码改了"：reloadPlugin 用新实现替换
    api.reloadPlugin('demo', demoPlugin('new'))
    expect(host.ctx.get<{ flag: string }>('demoSvc').flag).toBe('new')
    expect(api.listPlugins().filter((n) => n === 'demo')).toHaveLength(1)
  })

  it('reloadPlugin 不带 nextMod = 仅卸载', async () => {
    const { api } = await createMiniCanvasHost()
    api.installPlugin(demoPlugin('v1'))
    api.reloadPlugin('demo') // 不传新模块 → 等同卸载
    expect(api.listPlugins()).not.toContain('demo')
  })

  it('exposeToWindow 把 api 挂到 globalThis[windowKey]', async () => {
    const { api, exposeToWindow } = await createMiniCanvasHost()
    exposeToWindow() // 默认 key = 'MiniCanvas'
    expect((globalThis as Record<string, unknown>)['MiniCanvas']).toBe(api)
    // 自定义 key
    exposeToWindow('Foo')
    expect((globalThis as Record<string, unknown>)['Foo']).toBe(api)
  })

  it('seedDefault 首次启动生成默认画布，持久化恢复走同一 runtime', async () => {
    const storage = new MemoryStorageAdapter()
    const mk = () =>
      createMiniCanvasHost({
        adapter: storage,
        seedDefault: () => [{ id: '1', type: 'x', position: { x: 0, y: 0 }, data: {} }],
      })
    const { host } = await mk()
    expect(host.nodeStore.getNodes()).toHaveLength(1)
    await host.save.flush()
    host.stop()
    // 二次 boot 同一存储 → 恢复(seedDefault 不再执行，因为非空)
    const { host: h2 } = await mk()
    expect(h2.nodeStore.getNodes()).toHaveLength(1)
    h2.stop()
  })
})
