import { describe, it, expect } from 'vitest'
import { LocalStorageAdapter } from '../localStorageAdapter'
import { SaveServiceImpl } from '../SaveService'

/** 构造一个最简 Storage mock（node 环境无真实 localStorage） */
function makeFakeStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
  } as Storage
}

describe('LocalStorageAdapter（浏览器 localStorage 落点）', () => {
  it('set/get 往返：JSON 序列化 + 原样读回', async () => {
    const storage = makeFakeStorage()
    const adapter = new LocalStorageAdapter(storage)
    expect(adapter.available).toBe(true)

    await adapter.set('canvas:graph', { nodes: [{ id: '1', type: 'text' }] })
    const got = await adapter.get<{ nodes: Array<{ id: string; type: string }> }>('canvas:graph')
    expect(got?.nodes[0]).toEqual({ id: '1', type: 'text' })
  })

  it('未写入过的 key 返回 undefined', async () => {
    const adapter = new LocalStorageAdapter(makeFakeStorage())
    expect(await adapter.get('nope')).toBeUndefined()
  })

  it('remove 后读回 undefined', async () => {
    const storage = makeFakeStorage()
    const adapter = new LocalStorageAdapter(storage)
    await adapter.set('k', 1)
    await adapter.remove('k')
    expect(await adapter.get('k')).toBeUndefined()
  })

  it('node 无 localStorage 环境时 available=false 且读写安全降级', async () => {
    const adapter = new LocalStorageAdapter(undefined as unknown as Storage)
    // 不传 storage、环境又无 globalThis.localStorage → getStorage() 返回 null
    expect(adapter.available).toBe(false)
    await expect(adapter.set('k', 1)).resolves.toBeUndefined() // 静默 no-op，不抛
    expect(await adapter.get('k')).toBeUndefined()
  })
})

describe('SaveServiceImpl + LocalStorageAdapter（模拟刷新后恢复）', () => {
  it('canvas 数据经 localStorage 落盘，第二次 boot 用同一 storage 能恢复', async () => {
    const storage = makeFakeStorage()
    const save1 = new SaveServiceImpl(new LocalStorageAdapter(storage))
    save1.set('graph', [{ id: '1', type: 'text', position: { x: 1, y: 2 }, data: { text: '你好' } }], 'canvas')
    await save1.flush()

    // "刷新"：全新 SaveService，同一个 localStorage
    const save2 = new SaveServiceImpl(new LocalStorageAdapter(storage))
    const got = await save2.get<Array<{ id: string; data: { text: string } }>>('graph', 'canvas')
    expect(got?.[0].data.text).toBe('你好')
  })
})
