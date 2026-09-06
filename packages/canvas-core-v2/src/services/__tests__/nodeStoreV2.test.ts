import { describe, it, expect } from 'vitest'
import { NodeStore, type CanvasNode } from '../nodeStore'

/**
 * NodeStore v2 写 API 契约（用户拍板 1A + 3A）：
 *  - CanvasNode 增加可选 parentId（组嵌套，向后兼容：老数据无此字段不落盘）
 *  - size 仅作"声明尺寸"可选字段；运行时实测宽高走渲染层 nodeLayout 服务（不在本包）
 *  - addNodes 支持批量带 id/data/size/parentId；updateNode 支持任意 patch（position/size/parentId）；updateNodes 批量
 */
function makeStore(): NodeStore {
  const s = new NodeStore()
  s.registerType({ type: 'text', label: '文本', defaultSize: { w: 100, h: 40 } })
  s.registerType({ type: 'group', label: '分组', defaultSize: { w: 200, h: 100 } })
  return s
}

describe('NodeStore v2 写 API', () => {
  it('addNodes 批量插入：可指定 id/data/size/parentId；返回插入数量', () => {
    const s = makeStore()
    const n = s.addNodes([
      { type: 'text', position: { x: 0, y: 0 }, id: 'g1', data: { label: '组' }, size: { w: 200, h: 100 } },
      { type: 'text', position: { x: 10, y: 10 }, id: 'c1', data: {}, parentId: 'g1' },
    ])
    expect(n).toBe(2)
    const g = s.getNode('g1')!
    expect(g.size).toEqual({ w: 200, h: 100 })
    expect(s.getNode('c1')!.parentId).toBe('g1')
  })

  it('addNodes 缺 id 自动分配短 id', () => {
    const s = makeStore()
    s.addNodes([{ type: 'text', position: { x: 0, y: 0 }, id: 'a' }, { type: 'text', position: { x: 1, y: 1 } }])
    const ids = s.getNodes().map((x) => x.id).sort()
    expect(ids).toEqual(['1', 'a'])
  })

  it('addNodes 整批插入后至少触发一次通知且节点可见', () => {
    const s = makeStore()
    let calls = 0
    s.subscribe(() => (calls += 1))
    s.addNodes([{ type: 'text', position: { x: 0, y: 0 }, id: 'x' }])
    expect(calls).toBeGreaterThanOrEqual(1)
    expect(s.getNodes().map((x) => x.id)).toEqual(['x'])
  })

  it('updateNode 任意 patch：position/size/parentId/data 可一次改；不存在则抛错', () => {
    const s = makeStore()
    const id = s.addNode('text', { x: 0, y: 0 })
    s.updateNode(id, { position: { x: 5, y: 6 }, size: { w: 300, h: 200 }, parentId: 'g9' })
    const n = s.getNode(id)!
    expect(n.position).toEqual({ x: 5, y: 6 })
    expect(n.size).toEqual({ w: 300, h: 200 })
    expect(n.parentId).toBe('g9')
    expect(() => s.updateNode('nope', { position: { x: 0, y: 0 } })).toThrow(/no node/i)
  })

  it('updateNode patch 里给 undefined 的字段被清除（如 parentId: undefined 解除父子）', () => {
    const s = makeStore()
    const id = s.addNodes([{ type: 'text', position: { x: 0, y: 0 }, id: 'c', parentId: 'g' }])
    expect(id).toBe(1)
    s.updateNode('c', { parentId: undefined })
    expect(s.getNode('c')!.parentId).toBeUndefined()
  })

  it('updateNodes 批量改：不同节点不同 patch；只广播一次', () => {
    const s = makeStore()
    s.addNodes([
      { type: 'text', position: { x: 0, y: 0 }, id: 'a' },
      { type: 'text', position: { x: 10, y: 10 }, id: 'b' },
    ])
    let calls = 0
    s.subscribe(() => (calls += 1))
    s.updateNodes([
      { id: 'a', patch: { position: { x: 1, y: 1 } } },
      { id: 'b', patch: { parentId: 'a' } },
    ])
    expect(calls).toBe(1)
    expect(s.getNode('a')!.position).toEqual({ x: 1, y: 1 })
    expect(s.getNode('b')!.parentId).toBe('a')
  })

  it('removeNodes 批量删；父组被删时子节点一并解除父引用（防悬挂）', () => {
    const s = makeStore()
    s.addNodes([
      { type: 'group', position: { x: 0, y: 0 }, id: 'g' },
      { type: 'text', position: { x: 1, y: 1 }, id: 'c', parentId: 'g' },
    ])
    const removed = s.removeNodes(['g', 'c'])
    expect(removed).toBe(2)
    expect(s.getNodes()).toEqual([])
  })

  it('removeNodes 删除父组时自动清除仍存活的子节点的 parentId（只删组、保留子节点游离）', () => {
    const s = makeStore()
    s.addNodes([
      { type: 'group', position: { x: 0, y: 0 }, id: 'g' },
      { type: 'text', position: { x: 1, y: 1 }, id: 'c', parentId: 'g' },
    ])
    const removed = s.removeNodes(['g'])
    expect(removed).toBe(1)
    expect(s.getNode('g')).toBeUndefined()
    expect(s.getNode('c')!.parentId).toBeUndefined() // 子节点游离，不悬挂
  })

  it('childNodesOf 返回某父节点下直属子节点', () => {
    const s = makeStore()
    s.addNodes([
      { type: 'group', position: { x: 0, y: 0 }, id: 'g' },
      { type: 'text', position: { x: 1, y: 1 }, id: 'c1', parentId: 'g' },
      { type: 'text', position: { x: 2, y: 2 }, id: 'c2', parentId: 'g' },
      { type: 'text', position: { x: 3, y: 3 }, id: 'free' },
    ])
    expect(s.childNodesOf('g').map((x) => x.id).sort()).toEqual(['c1', 'c2'])
  })

  it('addNodes 原子：任一条 type 非法 → 抛错且不插入任何节点', () => {
    const s = makeStore()
    expect(() =>
      s.addNodes([
        { type: 'text', position: { x: 0, y: 0 }, id: 'ok' },
        { type: 'nope', position: { x: 1, y: 1 }, id: 'bad' },
      ]),
    ).toThrow(/unknown node type/)
    expect(s.getNodes()).toEqual([]) // 无部分插入
  })

  it('updateNodes 原子：任一条 id 缺失 → 抛错且任何节点都不改', () => {
    const s = makeStore()
    s.addNodes([
      { type: 'text', position: { x: 0, y: 0 }, id: 'a' },
      { type: 'text', position: { x: 1, y: 1 }, id: 'b' },
    ])
    expect(() =>
      s.updateNodes([
        { id: 'a', patch: { position: { x: 99, y: 99 } } },
        { id: 'missing', patch: { position: { x: 1, y: 1 } } },
      ]),
    ).toThrow(/no node/)
    expect(s.getNode('a')!.position).toEqual({ x: 0, y: 0 }) // a 未被改
  })
})

