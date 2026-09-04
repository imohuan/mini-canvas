import { describe, it, expect } from 'vitest'
import { SaveServiceImpl } from '../SaveService'
import { LocalStorageAdapter } from '../localStorageAdapter'
import { MemoryStorageAdapter } from '../memoryAdapter'
import { scopedKey, normalizeKey, SAVE_TYPES } from '../keys'

/** 最简 Storage mock（node 无真实 localStorage） */
function makeStorage(): { storage: Storage; dump: () => Map<string, string> } {
  const map = new Map<string, string>()
  const storage = {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
  } as Storage
  return { storage, dump: () => new Map(map) }
}

describe('Save 层契约（api.md §3.1）—— 四类互不干扰 + 可切 adapter + 落盘时机', () => {
  it('key 规范：scopedKey 加 type 前缀并小写化，四类同裸 key 物理互不干扰', () => {
    expect(scopedKey('canvas', 'Graph')).toBe('canvas:graph') // 大写→小写
    expect(scopedKey('config', 'graph')).toBe('config:graph')
    // 同一物理 adapter 里，canvas:graph 与 config:graph 是两个 key
    expect(scopedKey('canvas', 'graph')).not.toBe(scopedKey('config', 'graph'))
    expect(normalizeKey('  theme  ')).toBe('theme')
    expect(SAVE_TYPES).toContain('config')
    expect(SAVE_TYPES).toContain('shortcut')
  })

  it('四类数据各自落不同物理 key，同裸 key 不同 type 互不覆盖', async () => {
    const { storage } = makeStorage()
    const save = new SaveServiceImpl(new LocalStorageAdapter(storage))
    save.set('theme', { dark: true }, 'config')
    save.set('graph', [{ id: '1' }], 'canvas')
    save.set('img', 'data:x', 'resource')
    save.set('del', 'Backspace', 'shortcut')
    await save.flush()

    expect(storage.getItem('config:theme')).toContain('"dark":true')
    expect(storage.getItem('canvas:graph')).toBeDefined()
    expect(storage.getItem('resource:img')).toBeDefined()
    expect(storage.getItem('shortcut:del')).toBeDefined()

    // 同裸 key 不同 type 不覆盖
    save.set('graph', '我是config下的graph', 'config')
    await save.flush()
    expect(storage.getItem('canvas:graph')).toContain('"id":"1"') // canvas:graph 没被 config:graph 覆盖
    expect(storage.getItem('config:graph')).toContain('我是config下的graph')
  })

  it('useAdapter 可单独切某 type 的落点，不影响其它 type', async () => {
    const { storage: ls } = makeStorage()
    const { storage: cloud } = makeStorage()
    const save = new SaveServiceImpl(new LocalStorageAdapter(ls))
    // 把 config 切到"云端"内存 adapter，canvas 仍留本地
    const cloudAdapter = new LocalStorageAdapter(cloud)
    save.useAdapter('config', cloudAdapter)

    save.set('theme', { dark: true }, 'config')
    save.set('graph', ['a'], 'canvas')
    await save.flush()

    expect(cloud.getItem('config:theme')).toBeDefined() // 云端有 config
    expect(ls.getItem('config:theme')).toBeNull() // 本地没有 config
    expect(ls.getItem('canvas:graph')).toBeDefined() // canvas 还在本地
  })

  it('set 先入脏队列(不立即写)，flush 才落盘；isDirty 反映未落盘', async () => {
    const { storage } = makeStorage()
    const save = new SaveServiceImpl(new LocalStorageAdapter(storage))
    save.set('theme', { dark: true }, 'config')
    // 同步 set 未 flush → 底层还没有
    expect(storage.getItem('config:theme')).toBeNull()
    expect(save.isDirty()).toBe(true)
    await save.flush()
    expect(save.isDirty()).toBe(false)
    expect(storage.getItem('config:theme')).toBeDefined()
  })

  it('同一轮多次 set 合并成一次落盘（防抖语义，手动 flush 后一致）', async () => {
    const { storage } = makeStorage()
    const save = new SaveServiceImpl(new LocalStorageAdapter(storage))
    save.set('a', 1, 'config')
    save.set('b', 2, 'config')
    save.set('c', 3, 'config')
    await save.flush()
    expect(storage.getItem('config:a')).toBeDefined()
    expect(storage.getItem('config:b')).toBeDefined()
    expect(storage.getItem('config:c')).toBeDefined()
  })

  it('flush 后对同 key 重新 set 覆盖旧值（不残留脏旧）', async () => {
    const { storage } = makeStorage()
    const save = new SaveServiceImpl(new LocalStorageAdapter(storage))
    save.set('theme', 'light', 'config')
    await save.flush()
    save.set('theme', 'dark', 'config')
    await save.flush()
    expect(JSON.parse(storage.getItem('config:theme')!)).toBe('dark')
  })

  it('remove 删物理 key + 清脏队列；get 读回 undefined', async () => {
    const { storage } = makeStorage()
    const save = new SaveServiceImpl(new LocalStorageAdapter(storage))
    save.set('theme', 'dark', 'config')
    await save.flush()
    await save.remove('theme', 'config')
    expect(storage.getItem('config:theme')).toBeNull()
    expect(await save.get('theme', 'config')).toBeUndefined()
  })

  it('dispose 清掉防抖计时器（不再自动 flush）', () => {
    const save = new SaveServiceImpl(new MemoryStorageAdapter())
    save.set('a', 1, 'config')
    save.dispose()
    // dispose 后不报错；脏数据不自动落（无 timer）
    expect(save.isDirty()).toBe(true)
  })

  it('跨实例用同一 localStorage 模拟刷新：get 能恢复', async () => {
    const { storage } = makeStorage()
    const save1 = new SaveServiceImpl(new LocalStorageAdapter(storage))
    save1.set('language', 'zh', 'config')
    await save1.flush()
    const save2 = new SaveServiceImpl(new LocalStorageAdapter(storage))
    expect(await save2.get('language', 'config')).toBe('zh')
  })
})
