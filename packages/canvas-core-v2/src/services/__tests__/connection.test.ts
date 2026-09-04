import { describe, it, expect } from 'vitest'
import {
  normalizeConnection,
  toCanonicalConnection,
  getCanonicalEndpoints,
  wouldCreateCycle,
  findDuplicate,
  validateConnection,
  typeConnectionDef,
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
})
