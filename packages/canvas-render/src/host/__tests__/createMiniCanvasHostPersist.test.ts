import { describe, it, expect } from 'vitest'
import { createMiniCanvasHost } from '../createMiniCanvasHost'
import { SettingsStore, type PluginModule } from '@mini-canvas/kernel'
import { MemoryStorageAdapter } from '@mini-canvas/canvas-data'
import {
  CANVAS_INTERACTION_GROUP,
  CANVAS_INTERACTION_SCHEMA,
} from '../../contracts/canvasInteractionSettings'

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

describe('createMiniCanvasHost 画布交互配置（「常规/画布」）声明', () => {
  it('boot 后 settings 里有这组配置（宿主级声明，不装插件也有）', async () => {
    const { host } = await createMiniCanvasHost({ adapter: new MemoryStorageAdapter() })
    const settings = host.ctx.get<SettingsStore>('settings')
    expect(settings.groups()).toContain(CANVAS_INTERACTION_GROUP)
    for (const [key, schema] of Object.entries(CANVAS_INTERACTION_SCHEMA)) {
      expect(settings.get(key)).toBe(schema.default)
    }
    host.stop()
  })

  it('改值经持久化桥跨 boot 恢复；组内键不被插件撞名挤掉（先声明者保留）', async () => {
    const storage = new MemoryStorageAdapter()
    const { host } = await createMiniCanvasHost({ adapter: storage, coldPlugins: [cfgPlugin] })
    const settings = host.ctx.get<SettingsStore>('settings')
    settings.set('minZoom', 0.1)
    settings.set('panOnDrag', false)
    await host.save.flush()
    host.stop()

    const { host: h2 } = await createMiniCanvasHost({ adapter: storage, coldPlugins: [cfgPlugin] })
    const settings2 = h2.ctx.get<SettingsStore>('settings')
    expect(settings2.get('minZoom')).toBe(0.1)
    expect(settings2.get('panOnDrag')).toBe(false)
    // 未改过的项仍为默认
    expect(settings2.get('nodesDraggable')).toBe(true)
    h2.stop()
  })
})
