import { describe, it, expect } from 'vitest'
import { CommandRegistry } from '@mini-canvas/canvas-core-v2'
import { createShortcutRemapEngine, SHORTCUT_SAVE_KEY } from '../shortcutRemapEngine'

/** 内存 save mock（只实现 get/set；set 同步入内存供 get 读） */
function mockSave() {
  const store = new Map<string, unknown>()
  return {
    store,
    async get<T>(key: string) { return store.get(key) as T | undefined },
    set(key: string, value: unknown) { store.set(key, value) },
  }
}

function makeCmd(id: string, keys?: string[]) {
  const c = new CommandRegistry()
  c.register({ id, keys, run: () => 1 })
  return c
}

describe('shortcutRemapEngine（G 项 remap 持久化）', () => {
  it('remap 改键并写入 save；snapshot 反映', () => {
    const c = makeCmd('copy', ['mod+c'])
    const save = mockSave()
    const engine = createShortcutRemapEngine(c, save)
    engine.remap('copy', ['mod+shift+c'])
    expect(c.get('copy')?.keys).toEqual(['mod+shift+c'])
    expect(save.store.get(SHORTCUT_SAVE_KEY)).toEqual({ copy: ['mod+shift+c'] })
    expect(engine.snapshot()).toEqual({ copy: ['mod+shift+c'] })
  })
  it('restore 从 save 读回并对现网命令应用（刷新后 remap 保持）', async () => {
    const save = mockSave()
    save.store.set(SHORTCUT_SAVE_KEY, { copy: ['mod+shift+c'], delete1: ['Backspace'] })
    const c = makeCmd('copy', ['mod+c'])
    const engine = createShortcutRemapEngine(c, save)
    await engine.restore()
    expect(c.get('copy')?.keys).toEqual(['mod+shift+c'])
    // 持久化表里不存在的命令（delete1）restore 时跳过（has 检查）
    expect(engine.isRemapped('copy')).toBe(true)
  })
  it('reset 恢复原键并从表移除；无 save 时仅内存 remap 不持久化', async () => {
    const c = makeCmd('copy', ['mod+c'])
    const engine = createShortcutRemapEngine(c) // 无 save
    engine.remap('copy', ['mod+shift+c'])
    expect(c.get('copy')?.keys).toEqual(['mod+shift+c'])
    engine.reset('copy')
    expect(c.get('copy')?.keys).toEqual(['mod+c'])
    expect(engine.snapshot()).toEqual({})
  })
  it('remap 不存在的命令抛错；reset 不存在命令返回 undefined', () => {
    const c = makeCmd('copy', ['mod+c'])
    const engine = createShortcutRemapEngine(c)
    expect(() => engine.remap('nope', ['x'])).toThrow(/unknown/)
    expect(engine.reset('nope')).toBeUndefined()
  })
})

