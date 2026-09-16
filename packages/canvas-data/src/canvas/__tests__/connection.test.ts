import { describe, it, expect } from 'vitest'
import {
  normalizeConnection,
  toCanonicalConnection,
  getCanonicalEndpoints,
  wouldCreateCycle,
  findDuplicate,
  validateConnection,
  typeConnectionDef,
  resolveTargetInputPort,
  resolveSourceOutputPort,
} from '../connection'
import type { ConnectionInput, ExistingEdge, ValidateContext, NodeConnectionDef, PortDef } from '../connection'

/** 便捷构造校验上下文。nodes: id→type；typeConn: type→{inputs,outputs} */
function ctx(
  nodeTypes: Record<string, string>,
  edges: ExistingEdge[] = [],
  typeConn: Record<string, NodeConnectionDef> = {},
): ValidateContext {
  const nodes = new Map(Object.entries(nodeTypes).map(([id, type]) => [id, { id, type }]))
  return {
    nodes,
    edges,
    getTypeConn: (t) => typeConnectionDef(typeConn[t]),
  }
}
/** 便捷构造带 limit 的 inputs（PortDef 强类型）；evictOnFull 可指定，缺省 = 挤 */
function singleInput(accepts: string[], evictOnFull?: boolean): { inputs?: PortDef[] } {
  return { inputs: [{ accepts, limit: 'single' as const, evictOnFull }] }
}
function anyInput(accepts: string[]): { inputs?: PortDef[] } {
  return { inputs: [{ accepts }] }
}
function capacityInput(capacity: number): { inputs?: PortDef[] } {
  return { inputs: [{ accepts: [], capacity }] }
}
/** 声明容量 + 满额策略（evictOnFull）的输入口 */
function capacityInputWithPolicy(capacity: number, evictOnFull: boolean): { inputs?: PortDef[] } {
  return { inputs: [{ accepts: [], capacity, evictOnFull }] }
}
function conn(source: string, target: string): ConnectionInput {
  return { source, sourceHandle: 'source', target, targetHandle: 'target' }
}

describe('M5 连接内核 —— 纯函数（v1 原样吸收）', () => {
  it('normalizeConnection：缺 handle 归一成 source/target', () => {
    expect(normalizeConnection({ source: 'a', target: 'b' })).toEqual({
      source: 'a',
      sourceHandle: 'source',
      target: 'b',
      targetHandle: 'target',
    })
  })

  it('toCanonicalConnection：source→target 原样；target→source 反接翻正；其它朝向(null)非法', () => {
    expect(toCanonicalConnection(conn('a', 'b'))).toEqual({ source: 'a', target: 'b' })
    // 反接：src=t的target口、src的source口
    expect(
      toCanonicalConnection({ source: 'b', sourceHandle: 'target', target: 'a', targetHandle: 'source' }),
    ).toEqual({ source: 'a', target: 'b' })
    // 同侧(soure→source / target→target)非法
    expect(toCanonicalConnection({ source: 'a', sourceHandle: 'source', target: 'b', targetHandle: 'source' })).toBeNull()
  })

  it('getCanonicalEndpoints：已有边缺 handle 也按 source/target 归一', () => {
    expect(getCanonicalEndpoints({ source: 'a', target: 'b' })).toEqual({ source: 'a', target: 'b' })
    expect(getCanonicalEndpoints({ source: 'b', sourceHandle: 'target', target: 'a', targetHandle: 'source' })).toEqual({
      source: 'a',
      target: 'b',
    })
  })

  it('wouldCreateCycle：直线不成环；回边/成环路径才成环', () => {
    // a->b->c 后补 a->c 不成环
    const chain = [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' },
    ] as ExistingEdge[]
    expect(wouldCreateCycle('a', 'c', chain)).toBe(false)
    // 已有 b->a，再补 a->b 成环
    expect(wouldCreateCycle('a', 'b', [{ source: 'b', target: 'a' }])).toBe(true)
    // 自连成环
    expect(wouldCreateCycle('a', 'a', [])).toBe(true)
    // isTemp 边不算
    expect(wouldCreateCycle('a', 'b', [{ source: 'b', target: 'a', data: { isTemp: true } }])).toBe(false)
  })

  it('findDuplicate：同一条 canonical 连接只算一条，跨 handle 反接也算重复', () => {
    const edges = [{ source: 'a', target: 'b' }] as ExistingEdge[]
    expect(findDuplicate({ source: 'a', target: 'b' }, edges)).toBeTruthy()
    // 反接(b 的 target 口 → a 的 source 口)仍是 a→b，算重复
    expect(
      findDuplicate({ source: 'a', target: 'b' }, [
        { source: 'b', sourceHandle: 'target', target: 'a', targetHandle: 'source' },
      ]),
    ).toBeTruthy()
    // isTemp 不算重复
    expect(findDuplicate({ source: 'a', target: 'b' }, [{ source: 'a', target: 'b', data: { isTemp: true } }])).toBeUndefined()
  })
})

describe('M5 连接校验 validateConnection —— 锁 v1 严格规则 + 声明式约束', () => {
  it('合法连接：source→target 两端存在、类型都接 → ok', () => {
    const r = validateConnection(conn('a', 'b'), ctx({ a: 'text', b: 'image' }))
    expect(r.ok).toBe(true)
    expect(r.canonical).toEqual({ source: 'a', target: 'b' })
  })

  it('自连(self-loop)被拒', () => {
    expect(validateConnection(conn('a', 'a'), ctx({ a: 'text' })).reason).toBe('self-loop')
  })

  it('同侧朝向非法(bad-orientation)', () => {
    const r = validateConnection({ source: 'a', sourceHandle: 'source', target: 'b', targetHandle: 'source' }, ctx({ a: 'text', b: 'text' }))
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('bad-orientation')
  })

  it('环检测：补边会成环被拒(cycle)，不成环放行', () => {
    // 已有 a->b，试补 b->a（会成环）
    const r1 = validateConnection(conn('b', 'a'), ctx({ a: 't', b: 't' }, [{ source: 'a', target: 'b' }]))
    expect(r1.reason).toBe('cycle')
    // 已有 a->b，试补 a->c（b、c 未连，无环）
    const r2 = validateConnection(conn('a', 'c'), ctx({ a: 't', b: 't', c: 't' }, [{ source: 'a', target: 'b' }]))
    expect(r2.ok).toBe(true)
  })

  it('去重：同一条连接已存在被拒(duplicate)', () => {
    const r = validateConnection(conn('a', 'b'), ctx({ a: 't', b: 't' }, [{ source: 'a', target: 'b' }]))
    expect(r.reason).toBe('duplicate')
  })

  it('test-only 声明式：target 类型 inputs.accepts 限定可接受源类型', () => {
    // type:'t' 声明只接受 'text' 输入
    const c = ctx({ a: 'image', b: 't' }, [], { t: anyInput(['text']) })
    expect(validateConnection(conn('a', 'b'), c).reason).toBe('type-not-accepted')
    // image 换成 text 就通过
    const okCtx = ctx({ a: 'text', b: 't' }, [], { t: anyInput(['text']) })
    expect(validateConnection(conn('a', 'b'), okCtx).ok).toBe(true)
    // 未声明 accepts = 来者不拒
    expect(validateConnection(conn('a', 'b'), ctx({ a: 'image', b: 't' })).ok).toBe(true)
  })

  it('limit:"single" 满额时：默认挤老边（放行），显式 evictOnFull:false 才拒', () => {
    const edges = [{ source: 'a', target: 'b' }]
    const nodes = { a: 't', b: 't', c: 't' }
    // 默认（挤）：b 已有一条入边，再连 c->b 仍放行 —— 由渲染层在 commit 时挤掉最老那条
    const soft = ctx(nodes, edges, { t: singleInput(['t']) })
    expect(validateConnection(conn('c', 'b'), soft).ok).toBe(true)
    // 明确不挤：满额直接拒
    const hard = ctx(nodes, edges, { t: singleInput(['t'], false) })
    expect(validateConnection(conn('c', 'b'), hard).reason).toBe('limit-reached')
  })

  it('capacity=1 与 limit:"single" 等效：满额默认挤（放行），false 才拒', () => {
    const edges = [{ source: 'a', target: 'b' }]
    const nodes = { a: 't', b: 't', c: 't' }
    expect(validateConnection(conn('c', 'b'), ctx(nodes, edges, { t: capacityInput(1) })).ok).toBe(true)
    expect(
      validateConnection(conn('c', 'b'), ctx(nodes, edges, { t: capacityInputWithPolicy(1, false) })).reason,
    ).toBe('limit-reached')
  })

  it('capacity=2：未满放行；满额默认放行（挤）；evictOnFull:false 时拒', () => {
    const nodes = { a: 't', b: 't', c: 't', d: 't' }
    const empty = ctx(nodes, [], { t: capacityInput(2) })
    expect(validateConnection(conn('a', 'b'), empty).ok).toBe(true)
    const one = ctx(nodes, [{ source: 'a', target: 'b' }], { t: capacityInput(2) })
    expect(validateConnection(conn('c', 'b'), one).ok).toBe(true)
    const full = [{ source: 'a', target: 'b' }, { source: 'c', target: 'b' }]
    // 默认挤 → 放行
    expect(validateConnection(conn('d', 'b'), ctx(nodes, full, { t: capacityInput(2) })).ok).toBe(true)
    // 不挤 → 拒
    expect(
      validateConnection(conn('d', 'b'), ctx(nodes, full, { t: capacityInputWithPolicy(2, false) })).reason,
    ).toBe('limit-reached')
  })

  it('未声明 inputs 的类型不因 capacity 默认值被误判为只接一条', () => {
    // 目标类型无任何声明：任何数量的不同源都应可连（未限制）
    const c = ctx(
      { a: 't', b: 'u', c: 'v' },
      [{ source: 'a', target: 'b' }],
      {},
    )
    expect(validateConnection(conn('c', 'b'), c).ok).toBe(true)
  })

  /**
   * 容量语义（用户拍板）：
   * - **不声明 capacity = 不限条数**（不是"当 1 用"）；
   * - 声明了 capacity 且满额 → **默认挤老边**（放行，由渲染层在 commit 时挤掉最老一条）；
   * - 只有显式 evictOnFull:false 才"满额直接拒"（limit-reached）。
   *
   * 之所以要这组断言：以前"不声明"被当成"只能接 1 条"，于是 image/text 这些本该接多个上游的
   * 节点接不了第二条（用户实测报的"图片输入端口分明可以添加多条连接线"）。
   * 而"满额默认拒"又让 image-compare 不得不声明 capacity=3（上限+1 缓冲位）自己手写挤出，
   * 因为内核不会挤。两条一起改，插件才能老实写真实容量。
   */
  it('未声明 capacity = 不限条数（接多少条都放行）', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ source: `s${i}`, target: 'b' }))
    const nodes: Record<string, string> = { b: 't', extra: 't' }
    for (const e of many) nodes[e.source] = 't'
    const c = ctx(nodes, many, { t: { inputs: [{ port: 'target' }] } })
    // 已有 6 条入边，第 7 条仍然放行
    expect(validateConnection(conn('extra', 'b'), c).ok).toBe(true)
  })

  it('声明 capacity=2 且已满 → 默认"可挤"，放行（不再 limit-reached）', () => {
    const d = ctx(
      { a: 't', b: 't', c: 't', d: 't' },
      [{ source: 'a', target: 'b' }, { source: 'c', target: 'b' }],
      { t: capacityInput(2) },
    )
    expect(validateConnection(conn('d', 'b'), d).ok).toBe(true)
  })

  it('声明 capacity=2 且 evictOnFull:false → 满额直接拒（limit-reached）', () => {
    const c = ctx(
      { a: 't', b: 't', c: 't', d: 't' },
      [{ source: 'a', target: 'b' }, { source: 'c', target: 'b' }],
      { t: capacityInputWithPolicy(2, false) },
    )
    expect(validateConnection(conn('d', 'b'), c).reason).toBe('limit-reached')
  })

  it('capacity=1 + evictOnFull:false → 满额拒（"只接一条且不替换"的语义）', () => {
    const c = ctx(
      { a: 't', b: 't', c: 't' },
      [{ source: 'a', target: 'b' }],
      { t: capacityInputWithPolicy(1, false) },
    )
    expect(validateConnection(conn('c', 'b'), c).reason).toBe('limit-reached')
  })

  /**
   * 回归（真 bug，用户实测报的"3d预览节点限制一条连接线没有效果"）：
   * 声明里的 port 是具名 "target"，而**真实拖拽建出来的边 targetHandle 是 null**
   * （edgeStore 不存默认 handle）。匹配写成 `e.targetHandle === effectivePort` 时，
   * null === "target" 永远为假 → 容量统计数出 0 条 → 容量限制彻底失效。
   *
   * 正确语义：具名口 "target" 与"默认 target 口"是同一个口，无 handle 的边也要算进去。
   */
  it('无 handle 的已有边要计入 capacity：具名 target 口与默认口是同一个口', () => {
    const nodes = { a: 't', b: 't', c: 't' }
    // 声明 port:'target' + evictOnFull:false（严格只接一条）
    const strict: NodeConnectionDef = { inputs: [{ port: 'target', capacity: 1, evictOnFull: false }] }
    // 已有边的 targetHandle 是 undefined（真实拖拽就是这样）
    const c = ctx(nodes, [{ source: 'a', target: 'b' }], { t: strict })
    expect(validateConnection(conn('c', 'b'), c).reason).toBe('limit-reached')
    // 显式写 'target' 的也算同一条（两种写法等价，不能一边算一边不算）
    const c2 = ctx(nodes, [{ source: 'a', target: 'b', targetHandle: 'target' }], { t: strict })
    expect(validateConnection(conn('c', 'b'), c2).reason).toBe('limit-reached')
  })

  it('多个具名口时，无 handle 的边只算进它真正落到的那个口', () => {
    const two: NodeConnectionDef = { inputs: [{ port: 'in-1', capacity: 1, evictOnFull: false }, { port: 'in-2', capacity: 1, evictOnFull: false }] }
    const nodes = { a: 'x', b: 'mp', c: 'x' }
    // 已有边连 in-2（具名）→ 走默认 handle 应落第一个口 in-1，不该被 in-2 的占用影响。
    // 注意 conn() 给的 sourceHandle 是 'source'（规范朝向），别用裸 { source, target }（会被判 bad-orientation）。
    const c = ctx(nodes, [{ source: 'a', target: 'b', targetHandle: 'in-2' }], { mp: two })
    expect(validateConnection({ source: 'c', target: 'b' }, c).ok).toBe(true)
    // 走默认 handle（缺省口 = in-1，空闲）→ 可连（sourceHandle 只能是 source/缺省，写 x 会判朝向非法）
    expect(validateConnection({ source: 'c', sourceHandle: 'source', target: 'b' }, c).ok).toBe(true)
    const dupIn2 = validateConnection({ source: 'c', sourceHandle: 'x', target: 'b', targetHandle: 'in-2' }, c)
    expect(dupIn2.reason).toBe('limit-reached')
  })

  it('缺节点被拒(missing-node)', () => {
    expect(validateConnection(conn('a', 'ghost'), ctx({ a: 'text' })).reason).toBe('missing-node')
  })

  it('allowMissingNodes=true 放行（模拟刷新载入历史边，两端暂不在索引）', () => {
    const r = validateConnection(conn('x', 'y'), ctx({}), { allowMissingNodes: true })
    expect(r.ok).toBe(true)
  })

  it('typeConnectionDef：无 inputs/outputs 返回 undefined（类型默认人人可连）', () => {
    expect(typeConnectionDef({})).toBeUndefined()
    expect(typeConnectionDef(undefined)).toBeUndefined()
    expect(typeConnectionDef({ inputs: [{ accepts: ['text'] }] })).toBeDefined()
  })

  it('内容类型 acceptsTypes：源输出 contentType 不在目标输入接受列表 → type-not-accepted', () => {
    // 源 type 'text' 产 contentType:'text'；目标 type 'img' 输入只收 image → text 喂不进
    const c = ctx({ a: 'text', b: 'img' }, [], {
      text: { outputs: [{ port: 'source', contentType: 'text' }] },
      img: { inputs: [{ port: 'target', acceptsTypes: ['image'] }] },
    })
    expect(validateConnection(conn('a', 'b'), c).reason).toBe('type-not-accepted')
    // image 产 image 喂 img(收 image) → 通过
    const ok = ctx({ a: 'img2', b: 'img' }, [], {
      img2: { outputs: [{ port: 'source', contentType: 'image' }] },
      img: { inputs: [{ port: 'target', acceptsTypes: ['image'] }] },
    })
    expect(validateConnection(conn('a', 'b'), ok).ok).toBe(true)
    // 源没声明 contentType → 不受内容类型约束，回落 accepts 语义
    const untyped = ctx({ a: 't', b: 'img' }, [], {
      img: { inputs: [{ port: 'target', acceptsTypes: ['image'] }] },
    })
    expect(validateConnection(conn('a', 'b'), untyped).ok).toBe(true)
  })
})

describe('P0-6 多端口输入/输出口解析', () => {
  const multiPortType = (): NodeConnectionDef => ({
    inputs: [
      { port: 'in-text', accepts: ['text'] },
      { port: 'in-image', accepts: ['image'] },
    ],
    outputs: [
      { port: 'out-text', contentType: 'text' },
      { port: 'out-image', contentType: 'image' },
    ],
  })

  it('resolveTargetInputPort：默认 handle 取默认口；自定义 handle 精确匹配；未命中 undefined', () => {
    const def = multiPortType()
    expect(resolveTargetInputPort(def, undefined)?.port).toBe('in-text')
    expect(resolveTargetInputPort(def, 'target')?.port).toBe('in-text')
    expect(resolveTargetInputPort(def, 'in-image')?.port).toBe('in-image')
    expect(resolveTargetInputPort(def, 'ghost')).toBeUndefined()
    expect(resolveTargetInputPort(undefined, 'in-image')).toBeUndefined()
  })

  it('resolveSourceOutputPort 对称：默认/自定义/未命中', () => {
    const def = multiPortType()
    expect(resolveSourceOutputPort(def, undefined)?.port).toBe('out-text')
    expect(resolveSourceOutputPort(def, 'out-image')?.port).toBe('out-image')
    expect(resolveSourceOutputPort(def, 'ghost')).toBeUndefined()
  })

  it('validateConnection：自定义输入口按对应 accepts 校验（in-image 只收 image）', () => {
    // a:image → b(in-image 收 image) 通过；a:text → b(in-image) 拒
    const c = ctx(
      { a: 'image', b: 'mp', t: 'text' },
      [],
      { mp: multiPortType() },
    )
    const okConn: ConnectionInput = { source: 'a', sourceHandle: 'out-image', target: 'b', targetHandle: 'in-image' }
    expect(validateConnection(okConn, c).ok).toBe(true)
    const badConn: ConnectionInput = { source: 't', sourceHandle: 'out-text', target: 'b', targetHandle: 'in-image' }
    expect(validateConnection(badConn, c).reason).toBe('type-not-accepted')
  })

  it('validateConnection：未声明端口名被拒（no-target-port / no-source-port）', () => {
    // looseType 的 in/out 口无 accepts/contentType 约束 → 只验证端口存在性与 handle 匹配
    const loose: NodeConnectionDef = {
      inputs: [{ port: 'in-1' }, { port: 'in-2' }],
      outputs: [{ port: 'out-1' }, { port: 'out-2' }],
    }
    const c = ctx({ a: 'loose', b: 'loose' }, [], { loose })
    // 显式声明端口对（out-1 → in-1）→ 通过
    expect(validateConnection({ source: 'a', sourceHandle: 'out-1', target: 'b', targetHandle: 'in-1' }, c).ok).toBe(true)
    // 自定义 handle 未在声明中 → no-target-port
    const ghostTarget: ConnectionInput = { source: 'a', sourceHandle: 'out-1', target: 'b', targetHandle: 'ghost' }
    expect(validateConnection(ghostTarget, c).reason).toBe('no-target-port')
    // 自定义 source handle 未在声明中 → no-source-port
    const ghostSource: ConnectionInput = { source: 'a', sourceHandle: 'ghost', target: 'b', targetHandle: 'in-text' }
    expect(validateConnection(ghostSource, c).reason).toBe('no-source-port')
  })
})

describe('P0-6 纯具名多口容量独立（C-1）', () => {
  it('默认 handle 连多口类型第一口时，其它具名口的入边不计入该口容量', () => {
    // in-1/in-2 各 capacity 1；已有边连 in-2。新连接走默认 handle(落 in-1) → 应可连
    const named = (): NodeConnectionDef => ({
      inputs: [
        { port: 'in-1', capacity: 1 },
        { port: 'in-2', capacity: 1 },
      ],
    })
    const c = ctx(
      { a: 'x', b: 'mp' },
      [{ source: 'a', target: 'b', targetHandle: 'in-2' }], // 已有边占 in-2
      { mp: named() },
    )
    // 默认 handle → resolveTargetInputPort 落 in-1（第一个口），容量独立 → 可连
    expect(validateConnection({ source: 'a', target: 'b' }, c).ok).toBe(true)
    // 显式连 in-2 → 已被占，但默认「挤」→ 仍放行（容量门槛由渲染层 commit 时执行）
    const dup = validateConnection({ source: 'a', sourceHandle: 'x', target: 'b', targetHandle: 'in-2' }, c)
    expect(dup.ok).toBe(true)
  })
  it('同一具名口满额时：默认挤（放行）；evictOnFull:false 才拒', () => {
    const evicting = (): NodeConnectionDef => ({ inputs: [{ port: 'only-in', capacity: 1 }] })
    const refusing = (): NodeConnectionDef => ({ inputs: [{ port: 'only-in', capacity: 1, evictOnFull: false }] })
    const edges = [{ source: 'a', target: 'b', targetHandle: 'only-in' }]
    const nodes = { a: 'x', b: 'mp' }
    // 默认 handle 落 only-in（唯一口），已满；默认挤 → 放行
    expect(validateConnection({ source: 'a', target: 'b' }, ctx(nodes, edges, { mp: evicting() })).ok).toBe(true)
    // 明确不挤 → 拒
    expect(validateConnection({ source: 'a', target: 'b' }, ctx(nodes, edges, { mp: refusing() })).reason).toBe(
      'limit-reached',
    )
  })
})
