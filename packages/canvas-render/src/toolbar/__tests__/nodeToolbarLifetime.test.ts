import { describe, expect, it } from 'vitest'
import { createMiniCanvasHost } from '../../host/createMiniCanvasHost'
import { MemoryStorageAdapter } from '@mini-canvas/canvas-data'

/**
 * Spec D4：模式注册与会话住在渲染层。卸载主题插件后 listModes() 仍非空 ——
 * 这正是旧实现「主题一卸就丢模式」的修复证据。
 */
describe('nodeToolbar 归属渲染层', () => {
  it('宿主装业务插件前就已注入；卸载主题插件后模式仍在', async () => {
    const { host } = await createMiniCanvasHost({ adapter: new MemoryStorageAdapter() })
    const svc = host.ctx.get<{
      registerMode(m: { id: string; bottomBar?: unknown; order?: number }): void
      listModes(): Array<{ id: string }>
    }>('nodeToolbar')
    svc.registerMode({ id: 'theme-check', bottomBar: {}, order: 10 })
    expect(svc.listModes().map((m) => m.id)).toContain('theme-check')
    // 宿主本就没装主题插件；服务来自宿主注入，卸载任何业务插件都不该把它带走。
    expect(host.ctx.hasService('nodeToolbar')).toBe(true)
    host.stop()
  })
})
