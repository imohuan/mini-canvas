import { describe, expect, it } from 'vitest'
import { createMiniCanvasHost } from '../../host/createMiniCanvasHost'
import { MemoryStorageAdapter } from '@mini-canvas/canvas-data'

/**
 * Spec D4：模式注册与会话住在渲染层。
 *
 * 旧实现里 nodeToolbar 由主题插件 provide；主题一卸，模式和会话一起消失。
 * 现在服务由宿主注入，业务插件只往里注册模式。用「注册者卸载后服务仍在」证明归属，
 * 不依赖主题插件（canvas-render 不在 devDependencies 里装它）。
 */
describe('nodeToolbar 归属渲染层', () => {
  it('宿主装业务插件前就已注入', async () => {
    const { host } = await createMiniCanvasHost({ adapter: new MemoryStorageAdapter() })
    expect(host.ctx.hasService('nodeToolbar')).toBe(true)
    host.stop()
  })

  it('注册者插件卸载后，模式仍留在宿主服务里', async () => {
    const { host } = await createMiniCanvasHost({
      adapter: new MemoryStorageAdapter(),
      coldPlugins: [
        {
          name: 'mode-registrar',
          apply(c) {
            c.get<{ registerMode(m: { id: string; bottomBar?: unknown; order?: number }): void }>('nodeToolbar')
              .registerMode({ id: 'theme-check', bottomBar: {}, order: 10 })
          },
        },
      ],
    })
    const svc = host.ctx.get<{
      registerMode(m: { id: string; bottomBar?: unknown; order?: number }): void
      listModes(): Array<{ id: string }>
    }>('nodeToolbar')
    expect(svc.listModes().map((m) => m.id)).toContain('theme-check')

    expect(host.ctx.uninstallPlugin('mode-registrar')).toBe(true)
    // 服务归宿主；注册者走了，模式仍在（这正是旧实现「主题一卸就丢模式」的修复）
    expect(host.ctx.hasService('nodeToolbar')).toBe(true)
    expect(svc.listModes().map((m) => m.id)).toContain('theme-check')
    host.stop()
  })

  it('两个宿主不共享模式（DOM 锚点/会话不跨实例）', async () => {
    const a = await createMiniCanvasHost({ adapter: new MemoryStorageAdapter() })
    const b = await createMiniCanvasHost({ adapter: new MemoryStorageAdapter() })
    a.host.ctx
      .get<{ registerMode(m: { id: string; bottomBar?: unknown }): void }>('nodeToolbar')
      .registerMode({ id: 'only-a', bottomBar: {} })
    const modesB = b.host.ctx
      .get<{ listModes(): Array<{ id: string }> }>('nodeToolbar')
      .listModes()
    expect(modesB.map((m) => m.id)).not.toContain('only-a')
    a.host.stop()
    b.host.stop()
  })
})
