import { describe, expect, it } from 'vitest'
import { createMiniCanvasHost } from '../createMiniCanvasHost'
import { MemoryStorageAdapter } from '@mini-canvas/canvas-data'

/**
 * Spec 3.1 / 验收 8.1：基础服务只剩 7 个名字；旧名一律不可取。
 * 只装基础插件、不装任何业务插件。nodeToolbar 是 Spec D4 明确保留的渲染层辅助服务，
 * 单独断言；它不算「基础 7 个」的一部分。
 */
describe('基础服务名收敛', () => {
  it('基础七名 + 渲染层辅助 nodeToolbar', async () => {
    const { host } = await createMiniCanvasHost({ adapter: new MemoryStorageAdapter(), coldPlugins: [] })
    const names = host.ctx.injectedServices().sort()
    // injectedServices() 只列「服务表」里的名字；`tools` 是内核内置、不在表里，
    // 由 hasService/get 仍可取到，故这里不列它。
    expect(names).toEqual(['canvas', 'doc', 'nodeToolbar', 'resources', 'save', 'selection', 'view'])
    // tools 是内核内置：injectedServices 会单独列它；其余六名来自基础插件/宿主。
    expect(names.filter((n) => n !== 'tools' && n !== 'nodeToolbar')).toEqual([
      'canvas',
      'doc',
      'resources',
      'save',
      'selection',
      'view',
    ])
    host.stop()
  })

  it('渲染层辅助服务 nodeToolbar 仍存在（Spec D4），但不并入基础 7 个', async () => {
    const { host } = await createMiniCanvasHost({ adapter: new MemoryStorageAdapter(), coldPlugins: [] })
    expect(host.ctx.hasService('nodeToolbar')).toBe(true)
    expect(host.ctx.injectedServices()).toContain('nodeToolbar')
    host.stop()
  })

  it('旧名不可取：nodeLayout / viewport / tip / pluginManager / nodeFactory / command', async () => {
    const { host } = await createMiniCanvasHost({ adapter: new MemoryStorageAdapter(), coldPlugins: [] })
    for (const name of [
      'nodeLayout',
      'viewport',
      'tip',
      'notify',
      'pluginManager',
      'nodeFactory',
      'command',
      'settingsPersist',
      'auto-save',
      'nodeRegistry',
      'themeRegistry',
    ]) {
      expect({ name, present: host.ctx.hasService(name) }, `旧名 ${name} 仍可被取到`).toEqual({ name, present: false })
    }
    host.stop()
  })

  it('旧场不可取：五个零读取 kind 在 surface() 里不出现', async () => {
    const { host } = await createMiniCanvasHost({ adapter: new MemoryStorageAdapter(), coldPlugins: [] })
    const kinds = host.ctx.surface().registries.map((r) => r.kind)
    for (const kind of ['node/type', 'node/creator', 'setting', 'theme', 'slot', 'node/bar-applier']) {
      expect(kinds).not.toContain(kind)
    }
    host.stop()
  })

  it('surface() 仍列得出基础插件直注册的四条画布命令（command 服务已下线）', async () => {
    const { host } = await createMiniCanvasHost({ adapter: new MemoryStorageAdapter(), coldPlugins: [] })
    const ids = host.ctx.surface().commands.map((c) => c.id)
    for (const id of ['command:delete', 'command:create-node', 'command:undo', 'command:redo']) {
      expect(ids).toContain(id)
    }
    expect(host.ctx.hasService('command')).toBe(false)
    host.stop()
  })

})
