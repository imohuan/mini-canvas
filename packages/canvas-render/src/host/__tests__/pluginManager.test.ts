import { describe, it, expect, afterEach } from 'vitest'
import { createMiniCanvasHost } from '../createMiniCanvasHost'
import { loadPluginFromText, createPluginManager } from '../pluginManager'
import type { PluginModule } from '@mini-canvas/canvas-core-v2'

/** 一个可热装插件：注入服务 + nodeStore type，供装/卸/重载验证 */
function demoPlugin(flag: string): PluginModule {
  return {
    name: 'demo',
    setup(ctx) {
      ctx.inject('demoSvc', { flag })
      ctx.get<{ registerType(d: unknown): void }>('nodeStore').registerType({
        type: 'demo',
        label: 'Demo',
        defaultSize: { w: 120, h: 80 },
      })
      ctx.effect(() => () => ctx.get<{ unregisterType(t: string): void }>('nodeStore').unregisterType('demo'))
    },
  }
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>)['MiniCanvas']
})

describe('目标 D：统一安装句柄 manager（装/卸/换版本/外部来源/manifest）', () => {
  it('manager.install 源码模块 → 服务/type 生效；manager.uninstall 回收', async () => {
    const { host, manager } = await createMiniCanvasHost()
    expect(await manager.install(demoPlugin('v1'))).toBe('demo')
    expect(host.ctx.get<{ flag: string }>('demoSvc').flag).toBe('v1')
    expect(host.nodeStore.types.has('demo')).toBe(true)

    expect(manager.uninstall('demo')).toBe(true)
    expect(() => host.ctx.get('demoSvc')).toThrow(/not injected/)
    expect(host.nodeStore.types.has('demo')).toBe(false)
    expect(manager.list().find((p) => p.name === 'demo')).toBeUndefined()
  })

  it('manager.reload(name, 新实现) 换版本生效', async () => {
    const { host, manager } = await createMiniCanvasHost()
    await manager.install(demoPlugin('old'))
    expect(host.ctx.get<{ flag: string }>('demoSvc').flag).toBe('old')

    await manager.reload('demo', demoPlugin('new'))
    expect(host.ctx.get<{ flag: string }>('demoSvc').flag).toBe('new')
    expect(manager.list()).toContainEqual({ name: 'demo' })
  })

  it('外部来源：单文件插件 js 文本(ESM) loadPluginFromText 后能装生效', async () => {
    const { host, manager } = await createMiniCanvasHost()
    const text = `
      export const name = 'ext-svc'
      export function apply(ctx) {
        ctx.inject('extSvc', { who: 'external' })
      }
    `
    const mod = await loadPluginFromText(text)
    expect(mod.name).toBe('ext-svc')
    expect(await manager.install(mod)).toBe('ext-svc')
    expect(host.ctx.get<{ who: string }>('extSvc').who).toBe('external')
  })

  it('manager.install 接受 { text } 来源(懒解析)直接装外部插件', async () => {
    const { host, manager } = await createMiniCanvasHost()
    await manager.install({
      text: `export const name = 'ext2'; export function apply(ctx){ ctx.inject('ext2', { ok: 1 }) }`,
    })
    expect(host.ctx.get<{ ok: number }>('ext2').ok).toBe(1)
  })

  it('applyManifest 按序装 + 同 id(=name)覆盖旧实现(轻量分层)', async () => {
    const { host, manager } = await createMiniCanvasHost()
    const mk = (n: string, svc: string, flag: string): PluginModule => ({
      name: n,
      apply(ctx) {
        ctx.inject(svc, { flag })
      },
    })
    const names = await manager.applyManifest({
      plugins: [
        { id: 'plug-a', source: mk('plug-a', 'svcA', 'A1') },
        // 同名 'plug-b' 装两次 → 后者覆盖前者(换版本/升级)
        { id: 'plug-b', source: mk('plug-b', 'svcB1', 'B1') },
        { id: 'plug-b', source: mk('plug-b', 'svcB2', 'B2') },
      ],
    })
    // 按序装；同名 plug-b 的旧(svcB1)已被覆盖卸掉
    expect(host.ctx.get<{ flag: string }>('svcA').flag).toBe('A1')
    expect(host.ctx.get<{ flag: string }>('svcB2').flag).toBe('B2')
    expect(() => host.ctx.get('svcB1')).toThrow()
    // 返回实际装上的名字按顺序(a, b 只留最新)
    expect(names).toEqual(['plug-a', 'plug-b'])
    expect(manager.list().map((p) => p.name)).toEqual(['plug-a', 'plug-b'])
  })

  it('manager 独立于宿主门面可基于任意已 start Context 创建', async () => {
    const { host } = await createMiniCanvasHost()
    const m = createPluginManager(host.ctx)
    expect(await m.install(demoPlugin('x'))).toBe('demo')
    expect(host.ctx.get<{ flag: string }>('demoSvc').flag).toBe('x')
  })
})
