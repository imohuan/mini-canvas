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
/** 便捷构造带 limit 的 inputs（PortDef 强类型） */
function singleInput(accepts: string[]): { inputs?: PortDef[] } {
  return { inputs: [{ accepts, limit: 'single' as const }] }
}
function anyInput(accepts: string[]): { inputs?: PortDef[] } {
  return { inputs: [{ accepts }] }
}
function capacityInput(capacity: number): { inputs?: PortDef[] } {
  return { inputs: [{ accepts: [], capacity }] }
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

  it('limit:"single"：输入端口只允许一条入边(limit-reached)', () => {
    const c = ctx({ a: 't', b: 't', c: 't' }, [{ source: 'a', target: 'b' }], { t: singleInput(['t']) })
    // b 已有一条入边(a->b)，再连 c->b 被拒
    expect(validateConnection(conn('c', 'b'), c).reason).toBe('limit-reached')
  })

  it('capacity=1(缺省语义)与 limit:"single" 等效：满额拒绝', () => {
    const c = ctx({ a: 't', b: 't', c: 't' }, [{ source: 'a', target: 'b' }], { t: capacityInput(1) })
    expect(validateConnection(conn('c', 'b'), c).reason).toBe('limit-reached')
  })

  it('capacity=2：一条已占时不拒，满两条时第三条拒绝', () => {
    const empty = ctx({ a: 't', b: 't', c: 't', d: 't' }, [], { t: capacityInput(2) })
    expect(validateConnection(conn('a', 'b'), empty).ok).toBe(true)
    const one = ctx({ a: 't', b: 't', c: 't' }, [{ source: 'a', target: 'b' }], { t: capacityInput(2) })
    expect(validateConnection(conn('c', 'b'), one).ok).toBe(true)
    const full = ctx({ a: 't', b: 't', c: 't', d: 't' }, [{ source: 'a', target: 'b' }, { source: 'c', target: 'b' }], {
      t: capacityInput(2),
    })
    expect(validateConnection(conn('d', 'b'), full).reason).toBe('limit-reached')
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
    // 显式连 in-2 → 已被占 → limit-reached
    const dup = validateConnection({ source: 'a', sourceHandle: 'x', target: 'b', targetHandle: 'in-2' }, c)
    expect(dup.reason).toBe('limit-reached')
  })
  it('同一具名口满额时默认 handle 连该口应被拒（若默认口即该口）', () => {
    const single = (): NodeConnectionDef => ({
      inputs: [{ port: 'only-in', capacity: 1 }],
    })
    const c = ctx({ a: 'x', b: 'mp' }, [{ source: 'a', target: 'b', targetHandle: 'only-in' }], { mp: single() })
    // 默认 handle 落 only-in（唯一口），已有边占满 → limit-reached
    expect(validateConnection({ source: 'a', target: 'b' }, c).reason).toBe('limit-reached')
  })
})

