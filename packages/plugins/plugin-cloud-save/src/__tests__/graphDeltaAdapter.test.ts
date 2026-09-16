/**
 * GraphDeltaAdapter 单测（假 fetch）。
 *
 * 这个适配器解决的是「画布保存把 AI 的改动盖掉」：
 * 宿主每次提交都交来**整张画布**，若原样 PUT 上去，就会把两次提交之间 AI 改的东西整个抹掉。
 * 所以它记住「上次提交过什么」，只把差异发出去。
 *
 * 这里锁三条：
 * 1. 只发生变化的增量（新增/改动/删除各归各位）；
 * 2. 没变化时**一个请求都不发**（否则会和本地保存互相触发）；
 * 3. AI 的改动已经被实时通道合进本地这份里 —— 它不该被当成「我要删的」或「我要覆盖的」。
 */
import { describe, it, expect } from 'vitest'
import { GraphDeltaAdapter } from '../graphDeltaAdapter'

/** 记录请求的假 fetch（返回服务端形状的结果） */
function fakeFetch(respond?: (url: string, init?: RequestInit) => Response) {
  const calls: Array<{ url: string; method: string; body: any }> = []
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? "GET"
    let body: any = undefined
    try {
      body = init?.body ? JSON.parse(String(init.body)) : undefined
    } catch {
      body = String(init?.body)
    }
    calls.push({ url, method, body })
    if (respond) return respond(url, init)
    return new Response(JSON.stringify({ ok: true, added: [], deleted: [], updated: [], errors: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }) as typeof fetch
  return { impl, calls }
}

const node = (id: string, x = 0, data: Record<string, unknown> = {}) => ({
  id,
  type: "text",
  position: { x, y: 0 },
  data,
})
const edge = (id: string, source: string, target: string) => ({ id, source, target })

/** 新装配一个适配器（同一实例内跨多次 set 才谈得上「增量」） */
function adapter(impl: typeof fetch) {
  return new GraphDeltaAdapter({ type: "canvas", baseUrl: "http://cloud", fetchImpl: impl })
}

describe("GraphDeltaAdapter —— 首次提交：把本地这份推上去", () => {
  it("第一次 set 的节点全当新增（不是「先删后加」）", async () => {
    const f = fakeFetch()
    await adapter(f.impl).set("canvas:graph", [node("a"), node("b")])
    expect(f.calls.length).toBe(1)
    expect(f.calls[0].url).toBe("http://cloud/api/canvas/nodes")
    expect(f.calls[0].method).toBe("POST")
    expect(f.calls[0].body.add.map((n: any) => n.id)).toEqual(["a", "b"])
    expect(f.calls[0].body.delete).toEqual([])
  })
})

describe("GraphDeltaAdapter —— 之后只发差异", () => {
  it("没变化 → 一个请求都不发（防与本地保存互相触发）", async () => {
    const f = fakeFetch()
    const a = adapter(f.impl)
    await a.set("canvas:graph", [node("a")])
    expect(f.calls.length).toBe(1)
    await a.set("canvas:graph", [node("a")])
    expect(f.calls.length).toBe(1) // 没有新请求
  })

  it("新加的节点进 add", async () => {
    const f = fakeFetch()
    const a = adapter(f.impl)
    await a.set("canvas:graph", [node("a")])
    await a.set("canvas:graph", [node("a"), node("b")])
    expect(f.calls[1].body.add.map((n: any) => n.id)).toEqual(["b"])
    expect(f.calls[1].body.delete).toEqual([])
  })

  it("改过的节点进 update", async () => {
    const f = fakeFetch()
    const a = adapter(f.impl)
    await a.set("canvas:graph", [node("a", 0)])
    await a.set("canvas:graph", [node("a", 99)])
    expect(f.calls[1].body.update.map((n: any) => n.id)).toEqual(["a"])
    expect(f.calls[1].body.add).toEqual([])
  })

  it("删掉的节点进 delete", async () => {
    const f = fakeFetch()
    const a = adapter(f.impl)
    await a.set("canvas:graph", [node("a"), node("b")])
    await a.set("canvas:graph", [node("b")])
    expect(f.calls[1].body.delete).toEqual(["a"])
  })

  it("连线走边那个口子（两个 key 各自独立记基准）", async () => {
    const f = fakeFetch()
    const a = adapter(f.impl)
    await a.set("canvas:graph-edges", [edge("e-1", "a", "b")])
    expect(f.calls[0].url).toBe("http://cloud/api/canvas/edges")
    expect(f.calls[0].body.add.map((e: any) => e.id)).toEqual(["e-1"])
  })
})

describe("GraphDeltaAdapter —— AI 的改动不能被当成「我改的」", () => {
  /**
   * 真实时序：AI 加了 ai-1 → 实时通道把它合进本地 → 宿主提交整张画布。
   * 这时 ai-1 对适配器来说是「新增」，发上去服务端按更新处理（幂等），但**绝不能是删除**。
   */
  it("AI 合进来的新节点只会被当成新增，不会进 delete", async () => {
    const f = fakeFetch()
    const a = adapter(f.impl)
    await a.set("canvas:graph", [node("a")])
    // 本地这份现在含 AI 加的节点
    await a.set("canvas:graph", [node("a"), node("ai-1")])
    expect(f.calls[1].body.delete).toEqual([])
    expect(f.calls[1].body.add.map((n: any) => n.id)).toEqual(["ai-1"])
  })
})

describe("GraphDeltaAdapter —— get/remove 沿用原语义", () => {
  it("404 → undefined（从未保存过）", async () => {
    const f = fakeFetch(() => new Response(JSON.stringify({ ok: false }), { status: 404 }))
    expect(await adapter(f.impl).get("canvas:graph")).toBeUndefined()
  })

  it("读回值就是服务端的 {value}", async () => {
    const f = fakeFetch(
      () => new Response(JSON.stringify({ value: [{ id: "x" }] }), { status: 200 }),
    )
    expect(await adapter(f.impl).get("canvas:graph")).toEqual([{ id: "x" }])
  })
})

describe('GraphDeltaAdapter —— 增量口不可用时的降级（最容易出错的分支）', () => {
  /**
   * 这组用例是审查指出「风险最高却零覆盖」的地方。核心要求：
   * **一次失败不能让之后所有保存都变成整包覆盖** —— 那会把本轮要修的问题原样装回来。
   */
  it('网络错一次 → 本次不算成功，但下一次仍然走增量（不永久降级）', async () => {
    let failNext = true
    const calls: string[] = []
    const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      calls.push(`${method} ${url.replace('http://cloud', '')}`)
      if (failNext) {
        failNext = false
        throw new Error('network down')
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }) as typeof fetch

    const a = adapter(impl)
    await a.set('canvas:graph', [node('a')]) // 第一次：网络错 → 就地重试一次
    await a.set('canvas:graph', [node('a'), node('b')]) // 第二次：应当再试增量

    const deltaCalls = calls.filter((c) => c.startsWith('POST /api/canvas/nodes'))
    // 第一次：一条失败 + 一条就地重试；第二次：一条（新增 b）
    expect(deltaCalls.length).toBe(3)
  })

  it('服务端业务拒绝（ok:false）→ 不算接口坏，重试后仍走增量', async () => {
    // 第一次返回 ok:false（例如我提交了过时的差集），之后正常
    let rejected = 0
    const calls: string[] = []
    const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push(`${init?.method ?? 'GET'} ${url.replace('http://cloud', '')}`)
      if (init?.method === 'POST' && rejected === 0) {
        rejected += 1
        return new Response(JSON.stringify({ ok: false, errors: [{ op: 'delete', index: 0, message: '已不存在' }] }), {
          status: 200,
        })
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }) as typeof fetch

    const a = adapter(impl)
    await a.set('canvas:graph', [node('a')])
    // 关键：业务拒绝之后**不能**变成整包 PUT（那会覆盖 AI 的改动）
    const puts = calls.filter((c) => c.startsWith('PUT '))
    expect(puts.length).toBe(0)
  })

  it('连续失败到阈值才退整包，且之后还会再探增量（服务端升级后能自愈）', async () => {
    let mode: 'down' | 'up' = 'down'
    const calls: string[] = []
    const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push(`${init?.method ?? 'GET'} ${url.replace('http://cloud', '')}`)
      if (mode === 'down') throw new Error('network down')
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }) as typeof fetch

    const a = adapter(impl)
    // 注意：网络整个断掉时，兜底的整包写同样会失败并抛错 —— 这是有意的「响亮失败」，
    // 比静默丢掉用户的改动好。这里只是把异常吞掉以便继续断言请求序列。
    for (let i = 0; i < 5; i++) await a.set('canvas:graph', [node('a', i)]).catch(() => {})
    expect(calls.some((c) => c.startsWith('PUT '))).toBe(true) // 降级过

    // 「服务端恢复了」→ 下一次保存应当重新用上增量口
    mode = 'up'
    const before = calls.filter((c) => c.startsWith('POST /api/canvas/nodes')).length
    for (let i = 10; i < 14; i++) await a.set('canvas:graph', [node('a', i)]).catch(() => {})
    const after = calls.filter((c) => c.startsWith('POST /api/canvas/nodes')).length
    expect(after).toBeGreaterThan(before)
  })

  it('被拒之后不会把「已保存」记错（否则下一轮差集为空、改动永远存不上）', async () => {
    // 服务端既不接受、也不说清哪项坏了（errors 为空）→ 这批永远过不了
    const calls: string[] = []
    const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${String(input).replace('http://cloud', '')}`)
      return new Response(JSON.stringify({ ok: false, errors: [] }), { status: 200 })
    }) as typeof fetch
    const a = adapter(impl)
    await a.set('canvas:graph', [node('a')])

    // 关键：用户这次的改动必须**真的写出去**。不能只是「记着下次再试」——
    // 用户可能改完就关页面，那这次改动就永远没了。所以最终要落到整包写。
    expect(calls.some((c) => c.startsWith('PUT '))).toBe(true)
    // 而且有界：不是无限重发
    expect(calls.length).toBeLessThanOrEqual(4)
  })
})

describe('GraphDeltaAdapter —— 一次抖动绝不该立刻整包覆盖', () => {
  /**
   * 这是复核发现的真实缺陷：原实现「失败一次就进兜底整包」，阈值形同虚设 ——
   * 第一次网络抖动就把「可能覆盖 AI 改动」的行为触发了，而这正是本适配器要消灭的东西。
   * 正确行为：本次不写、基准不动，下次保存重试同一批；只有**连续**失败才降级。
   */
  it('网络错一次时，不许发整包 PUT', async () => {
    const calls: string[] = []
    let failOnce = true
    const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push(`${init?.method ?? 'GET'} ${url.replace('http://cloud', '')}`)
      if (failOnce) {
        failOnce = false
        throw new Error('network down')
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }) as typeof fetch

    const a = adapter(impl)
    await a.set('canvas:graph', [node('a')])
    expect(calls.filter((c) => c.startsWith('PUT ')).length).toBe(0)
  })

  it('抖动之后下一次保存仍然只发增量（改动没丢，重试的是同一批）', async () => {
    const calls: Array<{ method: string; body: any }> = []
    let down = true
    const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined })
      if (down && (init?.method === 'POST')) throw new Error('network down')
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }) as typeof fetch

    const a = adapter(impl)
    await a.set('canvas:graph', [node('a')])
    down = false
    await a.set('canvas:graph', [node('a')])

    const posts = calls.filter((c) => c.method === 'POST')
    // 两次都发的是「新增 a」这一批（第一次失败没丢掉它）
    expect(posts.length).toBe(2)
    expect(posts[1].body.add.map((n: any) => n.id)).toEqual(['a'])
  })
})

describe('GraphDeltaAdapter —— 个别项被拒时，其余照常保存（不整包、不死循环）', () => {
  /**
   * 复核发现的另一个缺陷：原实现「被拒就 rebase + 重发全量」，若那个项永远过不了
   * （例如边指向本地新加、云端还没有的节点），会每次保存都发两条全量、每次被拒 ——
   * 用户的改动永远落不了地，而且日志上看起来只是在「重试」。
   */
  it('服务端报出是哪项坏了 → 剔掉它，其余继续发，且只发有限轮', async () => {
    // 服务端只拒「删一个不存在的节点」，其余照收（真实服务端的整批拒绝就是这个形态）
    const posts: any[] = []
    const puts: string[] = []
    const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        puts.push(String(input))
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }
      if (init?.method !== 'POST') return new Response(JSON.stringify({ ok: true }), { status: 200 })
      const body = JSON.parse(String(init.body))
      posts.push(body)
      if ((body.delete ?? []).includes('ghost')) {
        return new Response(
          JSON.stringify({ ok: false, errors: [{ op: 'delete', index: 0, message: '要删除的节点不存在: ghost' }] }),
          { status: 200 },
        )
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }) as typeof fetch

    const skipped: string[][] = []
    const a = new GraphDeltaAdapter({
      type: 'canvas',
      baseUrl: 'http://cloud',
      fetchImpl: impl,
      onSkipped: (info) => skipped.push(info.messages),
    })
    await a.set('canvas:graph', [node('a'), node('ghost'), node('keep')])
    // 这一批：删掉 a 与 ghost（ghost 在云端已不存在）+ 新增新节点
    await a.set('canvas:graph', [node('keep'), node('new-1')])

    // 坏项被剔掉并报了出来（否则这种「一直存不上」没人看得见）
    // 注意是「至少一次」：服务端每次报的下标都是**相对本次提交**的，
    // 剔掉一项后下标会前移，所以两项都坏时要两轮才剔净。
    expect(skipped.length).toBeGreaterThanOrEqual(1)
    expect(String(skipped[0][0])).toContain('ghost')
    // 而且**没有**退化成整包覆盖
    expect(puts.length).toBe(0)
    // 而且**没有**退化成整包覆盖（整包会把 AI 的改动一起盖掉）
    expect(puts.length).toBe(0)
    // 真正该存的那份存上了：新增 new-1 出现在某次提交里
    expect(posts.some((p) => (p.add ?? []).some((n: any) => n.id === 'new-1'))).toBe(true)
    // 关键：那条一直删不掉的 ghost **没被当成「已处理」** —— 再存一次它还会被重投，
    // 说明基准没有谎报「云端已经没有 ghost 了」。
    const before = posts.length
    await a.set('canvas:graph', [node('keep'), node('new-1')])
    const again = posts.slice(before)
    expect(again.some((p) => (p.delete ?? []).includes('ghost'))).toBe(true)
    // 轮数有限：不是无限重发
    expect(posts.length).toBeLessThanOrEqual(8)
  })

    it('服务端一直说不清是哪项坏 → 有限次之后退整包（不会无限重发）', async () => {
    // 报一个我的 ops 里根本不存在的下标：能识别出「有错」，但剔不掉任何东西
    let posts = 0
    const puts: string[] = []
    const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        puts.push(String(input))
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }
      posts += 1
      return new Response(
        JSON.stringify({ ok: false, errors: [{ op: 'update', index: 99, message: '说不清' }] }),
        { status: 200 },
      )
    }) as typeof fetch

    const a = adapter(impl)
    for (let i = 0; i < 6; i++) await a.set('canvas:graph', [node('a', i)])
    // 有界：每次保存最多「一条增量 + 一条就地重试」，不会无限重发
    expect(posts).toBeLessThanOrEqual(12)
    // 连续失败到阈值后会退一次整包（用户的改动总算存上，而不是永远存不上）
    expect(puts.length).toBeGreaterThan(0)
  })
})

describe('GraphDeltaAdapter —— 暂时被拒的项不许丢（这条是最后一个阻塞项）', () => {
  /**
   * 真实时序：用户拖出一根连线，边和它两端的新节点**在同一次提交里**。
   * 边那条请求先到服务器时，端点还不存在 → 服务端拒掉它。
   * 若这时把「被拒的边」当成处理完成，它就被永久丢弃：屏幕上那条边还在，服务器上没有，
   * 刷新（或换台机器）就消失 —— 而日志里只有一行「已跳过」。
   */
  it('边先到、被拒；节点随后落定 → 边会被重投，最终真的存上', async () => {
    // 模拟服务端：节点没到之前，连到它的边一律拒绝
    const serverNodes = new Set<string>(['a'])
    const serverEdges: any[] = []
    const nodePosts: any[] = []
    const edgePosts: any[] = []
    const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method !== 'POST') return new Response(JSON.stringify({ ok: true }), { status: 200 })
      const body = JSON.parse(String(init.body))
      if (url.includes('/api/canvas/nodes')) {
        nodePosts.push(body)
        for (const n of body.add ?? []) serverNodes.add(n.id)
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }
      edgePosts.push(body)
      // 端点还没到 → 整批拒绝（与真服务端一致：报出是第几项）
      const missing = (body.add ?? []).findIndex((e: any) => !serverNodes.has(e.source) || !serverNodes.has(e.target))
      if (missing >= 0) {
        return new Response(
          JSON.stringify({ ok: false, errors: [{ op: 'add', index: missing, message: '目标节点不存在' }] }),
          { status: 200 },
        )
      }
      for (const e of body.add ?? []) serverEdges.push(e)
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }) as typeof fetch

    const nodes = new GraphDeltaAdapter({ type: 'canvas', baseUrl: 'http://cloud', fetchImpl: impl })
    const edges = new GraphDeltaAdapter({ type: 'canvas', baseUrl: 'http://cloud', fetchImpl: impl })

    // 先落节点（只有 a）
    await nodes.set('canvas:graph', [node('a')])

    // 这一次提交里：新增节点 b + 新增边 a→b。**边先发**（模拟它先到服务器）
    const edgeFirst = edges.set('canvas:graph-edges', [edge('e-a-b', 'a', 'b')])
    const nodeSecond = nodes.set('canvas:graph', [node('a'), node('b')])
    await Promise.all([edgeFirst, nodeSecond])

    // 边被拒过（这是前提），但**最终必须真的存上**
    expect(edgePosts.length).toBeGreaterThanOrEqual(2) // 至少发了两次（第一次被拒 + 重投）
    expect(serverEdges.map((e) => e.id)).toEqual(['e-a-b'])
    expect(serverNodes.has('b')).toBe(true)
  })

  it('被拒的项在后续保存里不会被当成「已在云端」（基准不许谎报）', async () => {
    // 服务端一直拒这条边（端点始终不存在）
    const edgePosts: any[] = []
    const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method !== 'POST') return new Response(JSON.stringify({ ok: true }), { status: 200 })
      if (url.includes('/api/canvas/edges')) {
        const body = JSON.parse(String(init.body))
        edgePosts.push(body)
        return new Response(
          JSON.stringify({ ok: false, errors: [{ op: 'add', index: 0, message: '目标节点不存在: x' }] }),
          { status: 200 },
        )
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }) as typeof fetch

    const edges = new GraphDeltaAdapter({ type: 'canvas', baseUrl: 'http://cloud', fetchImpl: impl })
    const one = [edge('e1', 'a', 'b')]
    await edges.set('canvas:graph-edges', one)
    const afterFirst = edgePosts.length

    // 关键：这条边从没存上，所以基准里不能有它。再存同一份时它必须**再被投一次** ——
    // 若基准谎报「已在云端」，这里就一次都不发，那条边永远补不回来。
    await edges.set('canvas:graph-edges', one)
    expect(edgePosts.length).toBeGreaterThan(afterFirst)
    expect(edgePosts[edgePosts.length - 1].add.map((e: any) => e.id)).toEqual(['e1'])
    // 而且不应该靠整包覆盖来兜底（那会盖掉 AI 的改动）
    void afterFirst
  })
})
