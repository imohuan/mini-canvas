import { describe, it, expect } from 'vitest'
import { apply, selfOrigin } from '../server'

/** 造一个最小的后台 ctx：收下注册的 MCP 工具/REST 路由，供断言 */
function fakeServerCtx(opts: {
  nodes?: Array<Record<string, unknown>>
  hasDoc?: boolean
  hasStore?: boolean
  batchResult?: { ok: boolean; errors: Array<{ message: string }> }
}) {
  const tools = new Map<string, { name: string; description: string; handler: (a: Record<string, unknown>) => unknown }>()
  const routes = new Map<string, (c: unknown) => unknown>()
  const writes: unknown[] = []
  const nodes = opts.nodes ?? []
  const doc =
    opts.hasDoc === false
      ? undefined
      : {
          getNodes: () => nodes,
          getEdges: () => [],
          batchNodes: async (input: unknown) => {
            writes.push(input)
            return opts.batchResult ?? { ok: true, errors: [] }
          },
        }
  const store =
    opts.hasStore === false
      ? undefined
      : {
          readCanvas: async () => ({ nodes, edges: [] }),
          writeCanvas: async (_id: string, d: unknown) => {
            writes.push(d)
          },
          list: async () => ['default'],
        }
  const ctx = {
    routes: { get: (p: string, h: (c: unknown) => unknown) => routes.set(p, h) },
    mcp: { tool: (def: { name: string }) => tools.set(def.name, def as never) },
    tryGet: (n: string) => (n === 'doc' ? doc : n === 'canvasStore' ? store : undefined),
  } as never
  return { ctx, tools, routes, writes }
}

describe('后台半：给 AI 的工具（这是「它怎么画」的答案）', () => {
  const uiNode = { id: '2', type: 'ui', data: { label: '可视化 1' } }
  const imgNode = { id: '1', type: 'image', data: { label: '封面', imageUrl: '/api/a.png' } }

  it('只注册三个工具 —— 改/删复用内置的 canvas_batch_nodes，不重复造', () => {
    const s = fakeServerCtx({ nodes: [imgNode, uiNode] })
    apply(s.ctx)
    expect([...s.tools.keys()].sort()).toEqual([
      'canvas_ui_guide',
      'canvas_ui_read',
      'canvas_ui_update',
      'canvas_ui_write',
    ])
    // 明确挡住"又造一个重复工具"：内置已经有 update / delete 能力
    expect(s.tools.has('canvas_ui_patch')).toBe(false)
    expect(s.tools.has('canvas_ui_delete')).toBe(false)
    expect(s.routes.has('/api/node-ui/info')).toBe(true)
  })

  it('手册讲清了：写哪个字段、HTML 跑在哪、必须遵守什么、能调哪些接口', async () => {
    const s = fakeServerCtx({ nodes: [imgNode, uiNode] })
    apply(s.ctx)
    const r = (await s.tools.get('canvas_ui_guide')!.handler({ canvasId: 'default' })) as { guide: string }
    expect(r.guide).toContain('canvas_ui_write')
    expect(r.guide).toContain('__CANVAS_UPSTREAM__')
    expect(r.guide).toContain('沙箱')
    expect(r.guide).toContain('绝对地址')
    expect(r.guide).toContain('/api/canvases/')
  })

  it('手册说明：改字段是「替换」语义，而且改/删用内置的 canvas_batch_nodes', async () => {
    const s = fakeServerCtx({ nodes: [uiNode] })
    apply(s.ctx)
    const r = (await s.tools.get('canvas_ui_guide')!.handler({ canvasId: 'default' })) as { guide: string }
    expect(r.guide).toContain('替换')
    expect(r.guide).toContain('canvas_batch_nodes')
    // 与内置工具的分工要写清：MCP 那侧 vs 页面里 HTTP 那侧
    expect(r.guide).toContain('canvas_get')
    expect(r.guide).toContain('/api/canvas/nodes')
  })

  it('手册里列出这张画布现有的节点（AI 才知道画布上有什么）', async () => {
    const s = fakeServerCtx({ nodes: [imgNode, uiNode] })
    apply(s.ctx)
    const r = (await s.tools.get('canvas_ui_guide')!.handler({ canvasId: 'default' })) as { guide: string }
    expect(r.guide).toContain('节点 1')
    expect(r.guide).toContain('封面')
    expect(r.guide).toContain('节点 2')
    expect(r.guide).toContain('还是空的')
  })

  it('写：把 HTML 落进节点（走有写锁的 doc，只动这一个）', async () => {
    const s = fakeServerCtx({ nodes: [uiNode] })
    apply(s.ctx)
    const r = (await s.tools.get('canvas_ui_write')!.handler({ nodeId: '2', html: '<div>x</div>' })) as { ok: boolean }
    expect(r.ok).toBe(true)
    const sent = JSON.stringify(s.writes[0])
    expect(sent).toContain('"update"')
    expect(sent).toContain('uiHtml')
    expect(sent).toContain('<div>x</div>')
    // 不是整份 nodes 写回（那会搬整张画布）
    expect(sent).not.toContain('"nodes"')
  })

  it('写：节点不存在 → 明确报错（不静默什么都不做）', async () => {
    const s = fakeServerCtx({ nodes: [uiNode] })
    apply(s.ctx)
    const r = (await s.tools.get('canvas_ui_write')!.handler({ nodeId: 'nope', html: 'x' })) as { ok: boolean; error: string }
    expect(r.ok).toBe(false)
    expect(r.error).toContain('nope')
  })

  it('写：给了非 ui 节点 → 报错并告诉它用内置工具建一个（而不是写进图片节点）', async () => {
    const s = fakeServerCtx({ nodes: [imgNode] })
    apply(s.ctx)
    const r = (await s.tools.get('canvas_ui_write')!.handler({ nodeId: '1', html: 'x' })) as { ok: boolean; error: string }
    expect(r.ok).toBe(false)
    expect(r.error).toContain('不是可视化节点')
    expect(r.error).toContain('canvas_batch_nodes')
    expect(s.writes).toHaveLength(0)
  })

  it('写：doc 写入失败 → 把原因带回（不假装成功）', async () => {
    const s = fakeServerCtx({ nodes: [uiNode], batchResult: { ok: false, errors: [{ message: '节点已删' }] } })
    apply(s.ctx)
    const r = (await s.tools.get('canvas_ui_write')!.handler({ nodeId: '2', html: 'x' })) as { ok: boolean; error: string }
    expect(r.ok).toBe(false)
    expect(r.error).toContain('节点已删')
  })

  it('写：没有 doc 时走存储那条路，也只改这一个节点（别的原样保留）', async () => {
    const other = { id: '9', type: 'text', data: { text: '别的节点' } }
    const s = fakeServerCtx({ nodes: [uiNode, other], hasDoc: false, hasStore: true })
    apply(s.ctx)
    const r = (await s.tools.get('canvas_ui_write')!.handler({ nodeId: '2', html: '<b>y</b>' })) as { ok: boolean }
    expect(r.ok).toBe(true)
    const written = s.writes[0] as { nodes: Array<{ id: string; data?: Record<string, unknown> }> }
    expect(written.nodes.find((n) => n.id === '2')?.data?.uiHtml).toBe('<b>y</b>')
    expect(written.nodes.find((n) => n.id === '9')?.data?.text).toBe('别的节点')
  })

  describe('局部替换更新（old → new，不必整段重写）', () => {
    const painted = { id: '2', type: 'ui', data: { uiHtml: '<div class="card">hi</div>' } }

    it('替换命中的那一段，并回报替换了几处；别处一个字不动', async () => {
      const s = fakeServerCtx({ nodes: [painted] })
      apply(s.ctx)
      const r = (await s.tools.get('canvas_ui_update')!.handler({
        nodeId: '2',
        old: 'class="card"',
        new: 'class="card card--big"',
      })) as { ok: boolean; replaced: number }
      expect(r.ok).toBe(true)
      expect(r.replaced).toBe(1)
      const sent = JSON.stringify(s.writes[0])
      expect(sent).toContain('card card--big')
      expect(sent).toContain('>hi<')
    })

    it('old 找不到 → 报错，并把当前内容回一段（好让它照着改 old）', async () => {
      const s = fakeServerCtx({ nodes: [painted] })
      apply(s.ctx)
      const r = (await s.tools.get('canvas_ui_update')!.handler({
        nodeId: '2',
        old: 'class="nope"',
        new: 'x',
      })) as { ok: boolean; error: string }
      expect(r.ok).toBe(false)
      expect(r.error).toContain('找不到')
      // 回的内容里能看到真实片段，AI 才知道该拿什么当 old
      expect(r.error).toContain('class="card"')
      expect(s.writes).toHaveLength(0)
    })

    it('old 出现多次 → 全换掉，并回报次数（想只换一处就该把 old 写长一点）', async () => {
      const twice = { id: '2', type: 'ui', data: { uiHtml: '<i>a</i><i>a</i>' } }
      const s = fakeServerCtx({ nodes: [twice] })
      apply(s.ctx)
      const r = (await s.tools.get('canvas_ui_update')!.handler({ nodeId: '2', old: '<i>a</i>', new: '<b>a</b>' })) as {
        ok: boolean
        replaced: number
      }
      expect(r.ok).toBe(true)
      expect(r.replaced).toBe(2)
    })

    it('删除一段：new 给空串就是删掉它', async () => {
      const s = fakeServerCtx({ nodes: [painted] })
      apply(s.ctx)
      const r = (await s.tools.get('canvas_ui_update')!.handler({ nodeId: '2', old: ' class="card"', new: '' })) as {
        ok: boolean
      }
      expect(r.ok).toBe(true)
      const sent = JSON.stringify(s.writes[0])
      expect(sent).toContain('<div>hi</div>')
    })

    it('还没画过的节点 → 明确提示改用 canvas_ui_write', async () => {
      const s = fakeServerCtx({ nodes: [uiNode] })
      apply(s.ctx)
      const r = (await s.tools.get('canvas_ui_update')!.handler({ nodeId: '2', old: 'a', new: 'b' })) as {
        ok: boolean
        error: string
      }
      expect(r.ok).toBe(false)
      expect(r.error).toContain('canvas_ui_write')
    })

    it('非 ui 节点 → 拒绝（不往图片节点的 data 里塞 uiHtml）', async () => {
      const s = fakeServerCtx({ nodes: [imgNode] })
      apply(s.ctx)
      const r = (await s.tools.get('canvas_ui_update')!.handler({ nodeId: '1', old: 'a', new: 'b' })) as { ok: boolean }
      expect(r.ok).toBe(false)
      expect(s.writes).toHaveLength(0)
    })

    it('缺 old → 明确报错', async () => {
      const s = fakeServerCtx({ nodes: [painted] })
      apply(s.ctx)
      const r = (await s.tools.get('canvas_ui_update')!.handler({ nodeId: '2', new: 'b' })) as { ok: boolean; error: string }
      expect(r.ok).toBe(false)
      expect(r.error).toContain('old')
    })
  })

  it('读：给出当前内容；没画过就 empty=true', async () => {
    const withHtml = { id: '2', type: 'ui', data: { uiHtml: '<b>hi</b>' } }
    const s1 = fakeServerCtx({ nodes: [withHtml] })
    apply(s1.ctx)
    const r1 = (await s1.tools.get('canvas_ui_read')!.handler({ nodeId: '2' })) as { html: string; empty: boolean }
    expect(r1.html).toBe('<b>hi</b>')
    expect(r1.empty).toBe(false)

    const s2 = fakeServerCtx({ nodes: [uiNode] })
    apply(s2.ctx)
    const r2 = (await s2.tools.get('canvas_ui_read')!.handler({ nodeId: '2' })) as { html: string; empty: boolean }
    expect(r2.html).toBe('')
    expect(r2.empty).toBe(true)
  })
})

describe('自报地址', () => {
  const mk = (h: Record<string, string | undefined>) => ({
    req: { header: (n: string) => h[n], url: 'http://x/', json: async () => ({}) },
    json: () => new Response(),
  })
  it('从 Host 头推 origin', () => {
    expect(selfOrigin(mk({ host: 'localhost:8865' }))).toBe('http://localhost:8865')
  })
  it('经代理时优先 x-forwarded-proto', () => {
    expect(selfOrigin(mk({ host: 'example.com', 'x-forwarded-proto': 'https' }))).toBe('https://example.com')
  })
  it('没有 Host 头 = 空串（不编地址）', () => {
    expect(selfOrigin(mk({}))).toBe('')
  })
})

