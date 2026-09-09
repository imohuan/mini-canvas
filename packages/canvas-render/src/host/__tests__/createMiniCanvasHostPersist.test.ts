import { describe, it, expect } from 'vitest'
import { createMiniCanvasHost } from '../createMiniCanvasHost'
import { MemoryStorageAdapter, SettingsStore, type PluginModule } from '@mini-canvas/canvas-core-v2'

const cfgPlugin: PluginModule = {
  name: 'cfg-host-demo',
  apply(ctx) {
    const settings = ctx.get<SettingsStore>('settings')
    if (!settings.has('x')) settings.define('g', { x: { type: 'number', default: 1, min: 0, max: 100 } }, 'cfg-host-demo')
  },
}

describe('createMiniCanvasHost 配置持久化桥', () => {
  it('默认开启：settingsPersist 注入 ctx；插件配置变更可跨 boot 恢复', async () => {
    const storage = new MemoryStorageAdapter()
    const mk = () => createMiniCanvasHost({ adapter: storage, coldPlugins: [cfgPlugin] })
    const { host } = await mk()
    expect(host.settingsPersist).toBeDefined()
    expect(host.ctx.hasService('settingsPersist')).toBe(true)
    const settings = host.ctx.get<SettingsStore>('settings')
    settings.set('x', 42)
    await host.save.flush()
    host.stop()
    const { host: h2 } = await mk()
    const settings2 = h2.ctx.get<SettingsStore>('settings')
    expect(settings2.get('x')).toBe(42)
    h2.stop()
  })
  it('persistSettings=false 时不注入桥、不持久化', async () => {
    const storage = new MemoryStorageAdapter()
    const mk = () => createMiniCanvasHost({ adapter: storage, coldPlugins: [cfgPlugin], persistSettings: false })
    const { host } = await mk()
    expect(host.settingsPersist).toBeUndefined()
    expect(host.ctx.hasService('settingsPersist')).toBe(false)
    const settings = host.ctx.get<SettingsStore>('settings')
    settings.set('x', 7)
    await host.save.flush()
    host.stop()
    const { host: h2 } = await mk()
    expect(h2.ctx.get<SettingsStore>('settings').get('x')).toBe(1)
    h2.stop()
  })
})

