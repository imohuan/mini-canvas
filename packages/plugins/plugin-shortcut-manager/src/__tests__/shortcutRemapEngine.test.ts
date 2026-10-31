import { describe, it, expect } from 'vitest'
import { CommandRegistry } from '@mini-canvas/kernel'
import { createShortcutRemapEngine, SHORTCUT_SAVE_KEY } from '../shortcutRemapEngine'

/** 内存 save mock（只实现 get/set；set 同步入内存供 get 读） */
function mockSave() {
  const store = new Map<string, unknown>()
  const calls: Array<{ op: 'get' | 'set'; key: string; type?: string }> = []
  return {
    store,
    calls,
    async get<T>(key: string, type?: string) {
      calls.push({ op: 'get', key, type })
      return store.get(key) as T | undefined
    },
    set(key: string, value: unknown, type?: string) {
      calls.push({ op: 'set', key, type })
      store.set(key, value)
    },
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
    // 重映射只写 shortcut 域，不能污染 canvas/config 那些域
    expect(save.calls.filter((c) => c.op === 'set')).toEqual([
      { op: 'set', key: SHORTCUT_SAVE_KEY, type: 'shortcut' },
    ])
  })
  it('restore 从 save 读回并对现网命令应用（刷新后 remap 保持）', async () => {
    const save = mockSave()
    save.store.set(SHORTCUT_SAVE_KEY, { copy: ['mod+shift+c'], delete1: ['Backspace'] })
    const c = makeCmd('copy', ['mod+c'])
    const engine = createShortcutRemapEngine(c, save)
    await engine.restore()
    expect(c.get('copy')?.keys).toEqual(['mod+shift+c'])
    expect(save.calls.filter((c) => c.op === 'get')).toEqual([
      { op: 'get', key: SHORTCUT_SAVE_KEY, type: 'shortcut' },
    ])
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

  it('subscribe：shortcut 后端切到云端后自动重读，云端 remap 表被应用', async () => {
    // 本地无记录、云端有记录（模拟：引擎先按本地 restore，云插件随后把 shortcut 切到云端）
    const local = new Map<string, unknown>()
    const cloud = new Map<string, unknown>([['keys', { copy: ['mod+k'] }]])
    let active: Map<string, unknown> = local
    const listeners = new Set<(t: string) => void>()
    const save = {
      async get<T>(key: string) { return active.get(key) as T | undefined },
      set(key: string, value: unknown) { active.set(key, value) },
      onAdapterChange(cb: (t: string) => void) {
        listeners.add(cb)
        return { dispose: () => listeners.delete(cb) }
      },
    }
    const c = makeCmd('copy', ['mod+c'])
    const engine = createShortcutRemapEngine(c, save)
    const off = engine.subscribe()
    await engine.restore()
    expect(c.get('copy')?.keys).toEqual(['mod+c']) // 本地没记录 → 还是原键

    // 云插件切到云端 → 广播 → 引擎自动重读，应用云端 remap
    active = cloud
    for (const cb of listeners) cb('shortcut')
    await new Promise((r) => setTimeout(r, 0))
    expect(c.get('copy')?.keys).toEqual(['mod+k'])
    // 其它域切换不误触
    active = local
    for (const cb of listeners) cb('canvas')
    await new Promise((r) => setTimeout(r, 0))
    expect(c.get('copy')?.keys).toEqual(['mod+k'])
    off()
  })
})
