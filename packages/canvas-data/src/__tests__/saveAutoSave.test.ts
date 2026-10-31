import { describe, expect, it, vi } from 'vitest'
import { Context } from '../canvas/context'
import { SettingsStore } from '@mini-canvas/kernel'
import { createCanvasBasePlugin } from '../canvas/canvasBasePlugin'
import { MemoryStorageAdapter } from '../storage/memoryAdapter'
import { createAutoSaveEngine } from '../autoSave'
import { createSettingsPersist, SETTINGS_SAVE_KEY } from '../settingsPersist'

async function boot(persistSettings?: boolean) {
  const ctx = new Context()
  const base = createCanvasBasePlugin({ adapter: new MemoryStorageAdapter(), persistSettings })
  ctx.plugin(base.plugin)
  await ctx.start()
  return { ctx, base }
}

describe('save 吸收配置持久化', () => {
  it('persistSettings=false 时 save.settings 为 undefined', async () => {
    const { base } = await boot(false)
    expect(base.services.save.settings).toBeUndefined()
  })

  it('开启时 restore 后设置值回到快照，且恢复期间不触发回写', async () => {
    const adapter = new MemoryStorageAdapter()
    await adapter.set('config:settings', { theme: 'dark' })
    const ctx = new Context()
    const base = createCanvasBasePlugin({ adapter })
    ctx.plugin(base.plugin)
    await ctx.start()
    const settings = ctx.get<SettingsStore>('settings')
    settings.define('g', { theme: { type: 'text', default: 'light' } }, 'test')
    const setSpy = vi.spyOn(adapter, 'set')
    await base.services.save.settings!.restore()
    expect(settings.get('theme')).toBe('dark')
    // 恢复本身不该被当成用户改动写回
    expect(setSpy).not.toHaveBeenCalled()
  })

  it('restore 之后改值才写回 config 快照', async () => {
    const ctx = new Context()
    const base = createCanvasBasePlugin({ adapter: new MemoryStorageAdapter() })
    ctx.plugin(base.plugin)
    await ctx.start()
    const settings = ctx.get<SettingsStore>('settings')
    settings.define('g', { accent: { type: 'text', default: 'blue' } }, 'test')
    await base.services.save.settings!.restore()
    settings.set('accent', 'red')
    await base.services.save.flush()
    const saved = await base.services.save.get<Record<string, unknown>>(SETTINGS_SAVE_KEY, 'config')
    expect(saved?.accent).toBe('red')
  })
})

describe('save 吸收 auto-save', () => {
  it('1000ms 周期落盘；失败恢复脏位', async () => {
    vi.useFakeTimers()
    const flush = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined)
    const engine = createAutoSaveEngine({ interval: 1000, flush })
    engine.markDirty()
    await vi.advanceTimersByTimeAsync(1000)
    expect(flush).toHaveBeenCalledTimes(1)
    // 失败后脏位放回，下个周期重试
    expect(engine.isDirty()).toBe(true)
    await vi.advanceTimersByTimeAsync(1000)
    expect(flush).toHaveBeenCalledTimes(2)
    expect(engine.isDirty()).toBe(false)
    engine.dispose()
    vi.useRealTimers()
  })

  it('setEnabled(false) 停表但不清脏位；重新启用后下个周期落盘', async () => {
    vi.useFakeTimers()
    const flush = vi.fn().mockResolvedValue(undefined)
    const engine = createAutoSaveEngine({ interval: 1000, flush })
    engine.markDirty()
    engine.setEnabled(false)
    expect(engine.isDirty()).toBe(true)
    await vi.advanceTimersByTimeAsync(1500)
    expect(flush).not.toHaveBeenCalled()
    engine.setEnabled(true)
    await vi.advanceTimersByTimeAsync(1000)
    expect(flush).toHaveBeenCalledTimes(1)
    engine.dispose()
    vi.useRealTimers()
  })

  it('dispose 停表、删订阅后不再落盘', async () => {
    vi.useFakeTimers()
    const flush = vi.fn().mockResolvedValue(undefined)
    const engine = createAutoSaveEngine({ interval: 1000, flush })
    engine.dispose()
    engine.markDirty()
    await vi.advanceTimersByTimeAsync(2000)
    expect(flush).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})
