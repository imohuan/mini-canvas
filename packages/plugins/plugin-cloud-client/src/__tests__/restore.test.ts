import { describe, it, expect } from 'vitest'
import { restoreOrSeed, type RestoreDeps } from '../restore'
import { restoreMediaUrls } from '../keys'

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

  it('服务器那份里节点只有 resourceId（引用）→ 覆盖本地前必须重建可显示地址', async () => {
    // 用户 2026-10-10 报的「刷新后图片/视频变空白」。
    //
    // 根因：服务器存的是节点 data.resourceId（引用），而渲染层只认 imageUrl/videoUrl（地址）。
    // 本地加载路径有「按引用重建地址」这一步，但云端恢复发生在那之后、且只做整包覆盖 ——
    // 覆盖完没有重建，节点就只剩引用，图片/视频节点渲染成空白。
    const serverNode = {
      id: 'img-1',
      type: 'image',
      position: { x: 0, y: 0 },
      data: { resourceId: '/api/canvases/default/resources/abc.jpeg', label: '图片 22' },
    }
    const restored: Array<{ id: string; data: Record<string, unknown> }> = []
    const { d, replaced } = deps({
      readServer: async () => ({ nodes: [serverNode], edges: [], view: null }),
      readLocal: () => ({ nodes: [], edges: [] }),
      restoreMediaUrls: async (nodes) => {
        // 走插件里那份真实实现（不是测试自己造一遍），确保守住的是产品代码
        await restoreMediaUrls(
          nodes as Array<{ type?: string; data?: Record<string, unknown> }>,
          async (resourceId) => resourceId,
        )
        for (const n of nodes as Array<{ id: string; data: Record<string, unknown> }>) restored.push(n)
      },
    })
    await restoreOrSeed(d)
    // 交给 replaceLocal 的那份必须已经带上可显示地址（否则渲染层拿不到图）
    expect(replaced[0].nodes[0]).toMatchObject({ data: { imageUrl: '/api/canvases/default/resources/abc.jpeg' } })
    expect(restored).toHaveLength(1)
  })

  it('没有 restoreMediaUrls 钩子时行为不变（老调用方不受影响）', async () => {
    const { d, replaced } = deps({
      readServer: async () => ({ nodes: [node('s1')], edges: [], view: null }),
      readLocal: () => ({ nodes: [], edges: [] }),
    })
    expect((await restoreOrSeed(d)).phase).toBe('restored')
    expect(replaced[0].nodes).toHaveLength(1)
  })

  it('恢复成功后交出同一份服务器快照（启动基准不再二次拉取）', async () => {
    const got: Array<{ nodes: unknown[]; edges: unknown[]; revision?: number }> = []
    const { d } = deps({
      readServer: async () => ({ nodes: [node('s1')], edges: [{ id: 'e1', source: 's1', target: 's1' }], view: null, revision: 9 }),
      readLocal: () => ({ nodes: [], edges: [] }),
      onServerSnapshot: (s) => got.push({ nodes: s.nodes, edges: s.edges, revision: s.revision }),
    })
    await restoreOrSeed(d)
    expect(got).toHaveLength(1)
    expect(got[0].nodes.map((n) => (n as { id: string }).id)).toEqual(['s1'])
    expect(got[0].revision).toBe(9)
  })

  it('首次上云成功后也交出本地那份快照（与已提交基准同源）', async () => {
    const got: Array<{ nodes: unknown[] }> = []
    const { d } = deps({
      readServer: async () => ({ nodes: [], edges: [], view: null }),
      readLocal: () => ({ nodes: [node('l1')], edges: [] }),
      onServerSnapshot: (s) => got.push({ nodes: s.nodes }),
    })
    await restoreOrSeed(d)
    expect(got).toHaveLength(1)
    expect(got[0].nodes.map((n) => (n as { id: string }).id)).toEqual(['l1'])
  })
})
