import { describe, it, expect } from 'vitest'
import { restoreOrSeed, type RestoreDeps } from '../restore'

function deps(over: Partial<RestoreDeps> & Pick<RestoreDeps, 'readServer' | 'readLocal'>): {
  d: RestoreDeps
  replaced: Array<{ nodes: unknown[]; edges: unknown[] }>
  pushed: Array<{ nodes: unknown[]; edges: unknown[] }>
  views: unknown[]
} {
  const replaced: Array<{ nodes: unknown[]; edges: unknown[] }> = []
  const pushed: Array<{ nodes: unknown[]; edges: unknown[] }> = []
  const views: unknown[] = []
  const d: RestoreDeps = {
    replaceLocal: (nodes, edges) => replaced.push({ nodes, edges }),
    pushLocal: async (nodes, edges) => {
      pushed.push({ nodes, edges })
    },
    setViewport: (v) => views.push(v),
    ...over,
  }
  return { d, replaced, pushed, views }
}

const node = (id: string, type = 'text') => ({ id, type, position: { x: 0, y: 0 }, data: {} })

describe('云端优先', () => {
  it('服务器有画布 → 覆盖本地', async () => {
    const { d, replaced, pushed } = deps({
      readServer: async () => ({ nodes: [node('s1')], edges: [], view: null }),
      readLocal: () => ({ nodes: [node('l1')], edges: [] }),
    })
    const r = await restoreOrSeed(d)
    expect(r.phase).toBe('restored')
    expect(replaced[0].nodes.map((n) => (n as { id: string }).id)).toEqual(['s1'])
    expect(pushed).toEqual([])
  })

  it('服务器为空、本地有 → 首次上云（把本地推上去）', async () => {
    const { d, replaced, pushed } = deps({
      readServer: async () => ({ nodes: [], edges: [], view: null }),
      readLocal: () => ({ nodes: [node('l1')], edges: [] }),
    })
    const r = await restoreOrSeed(d)
    expect(r.phase).toBe('seeded')
    expect(pushed[0].nodes).toHaveLength(1)
    expect(replaced).toEqual([])
  })

  it('两边都空 → 什么都不做', async () => {
    const { d, replaced, pushed } = deps({
      readServer: async () => ({ nodes: [], edges: [], view: null }),
      readLocal: () => ({ nodes: [], edges: [] }),
    })
    expect((await restoreOrSeed(d)).phase).toBe('empty')
    expect(replaced).toEqual([])
    expect(pushed).toEqual([])
  })

  it('恢复视口（刷新后回到上次停的位置）', async () => {
    const { d, views } = deps({
      readServer: async () => ({ nodes: [node('s1')], edges: [], view: { x: 5, y: 6, zoom: 2 } }),
      readLocal: () => ({ nodes: [], edges: [] }),
    })
    await restoreOrSeed(d)
    expect(views).toEqual([{ x: 5, y: 6, zoom: 2 }])
  })

  it('视口形状不对就不设（不瞎编一个视野）', async () => {
    const { d, views } = deps({
      readServer: async () => ({ nodes: [node('s1')], edges: [], view: { x: 'bad' } }),
      readLocal: () => ({ nodes: [], edges: [] }),
    })
    await restoreOrSeed(d)
    expect(views).toEqual([])
  })

  it('类型暂时不认识也保留节点（热装类型注册晚于恢复，丢节点=用户数据消失）', async () => {
    // 真出过：group 是云清单运行期热装的，恢复那一刻还没注册，按类型过滤把分组节点丢了、
    // 子节点变孤儿 → 用户看到「分组没了」。所以现在一律保留，渲染层对 orphan 有兜底。
    const { d, replaced } = deps({
      readServer: async () => ({ nodes: [node('a', 'text'), node('b', 'pano-unknown')], edges: [], view: null }),
      readLocal: () => ({ nodes: [], edges: [] }),
      knownType: (t) => t === 'text',
    })
    const r = await restoreOrSeed(d)
    expect(replaced[0].nodes.map((n) => (n as { id: string }).id)).toEqual(['a', 'b'])
    expect(r.nodes).toBe(2)
  })

  it('边照常恢复（边不按类型过滤）', async () => {
    const { d, replaced } = deps({
      readServer: async () => ({ nodes: [node('a')], edges: [{ id: 'e-a-b', source: 'a', target: 'b' }], view: null }),
      readLocal: () => ({ nodes: [], edges: [] }),
    })
    await restoreOrSeed(d)
    expect(replaced[0].edges).toHaveLength(1)
  })
})
