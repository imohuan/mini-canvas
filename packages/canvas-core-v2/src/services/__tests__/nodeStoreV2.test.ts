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

describe('NodeStore listener 异常隔离（P2-6）', () => {
  it('坏订阅者抛错不阻断其它订阅者，也不让写操作抛错', () => {
    const s = makeStore()
    const seen: string[] = []
    s.subscribe(() => { throw new Error('bad listener') })
    s.subscribe(() => { seen.push('ok') })
    expect(() => s.addNode('text', { x: 0, y: 0 })).not.toThrow()
    expect(seen).toEqual(['ok'])
    expect(s.getNodes()).toHaveLength(1) // 数据确实写入
  })
})

describe('NodeStore orphanTypes（P1-9 orphan policy 感知）', () => {
  it('类型注销后存量节点 type 出现在 orphanTypes；重注册后消失', () => {
    const s = makeStore()
    s.addNodes([
      { type: 'text', position: { x: 0, y: 0 }, id: 'a' },
      { type: 'group', position: { x: 10, y: 10 }, id: 'b' },
    ])
    expect(s.orphanTypes()).toEqual([])
    s.unregisterType('group')
    expect(s.orphanTypes()).toEqual(['group']) // group 有存量节点但类型已注销
    expect(s.getNodes().length).toBe(2) // 存量节点保留（数据不丢，可恢复）
    s.registerType({ type: 'group', label: '分组', defaultSize: { w: 200, h: 100 } })
    expect(s.orphanTypes()).toEqual([]) // 类型恢复 → 不再 orphan
  })
})

describe('NodeStore id 冲突校验（P1-11）', () => {
  it('addNodes 显式 id 与存量节点冲突 → 抛错且无部分插入', () => {
    const s = makeStore()
    s.addNodes([{ type: 'text', position: { x: 0, y: 0 }, id: 'a' }])
    expect(() =>
      s.addNodes([
        { type: 'text', position: { x: 1, y: 1 }, id: 'b' },
        { type: 'text', position: { x: 2, y: 2 }, id: 'a' }, // 与存量 a 冲突
      ]),
    ).toThrow(/already exists/)
    expect(s.getNodes().map((n) => n.id)).toEqual(['a']) // b 未插入
  })
  it('addNodes 批内 id 重复 → 抛错', () => {
    const s = makeStore()
    expect(() =>
      s.addNodes([
        { type: 'text', position: { x: 1, y: 1 }, id: 'x' },
        { type: 'text', position: { x: 2, y: 2 }, id: 'x' },
      ]),
    ).toThrow(/already exists/)
    expect(s.getNodes()).toEqual([])
  })
  it('无显式 id 的批量插入仍自动分配短 id（不冲突）', () => {
    const s = makeStore()
    s.addNodes([{ type: 'text', position: { x: 0, y: 0 } }, { type: 'text', position: { x: 1, y: 1 } }])
    expect(s.getNodes()).toHaveLength(2)
  })
})

describe('NodeStore getSnapshot 安全只读（P1-10）', () => {
  it('快照是深拷贝：外部改动不污染 store；store 后续改动不影响已取快照', () => {
    const s = makeStore()
    const id = s.addNode('text', { x: 1, y: 2 })
    s.updateNodeData(id, { text: 'hi' })
    const snap = s.getSnapshot()
    expect(snap).toHaveLength(1)
    // 改快照对象（含嵌套 data）不污染 store
    snap[0].data.text = 'MUTATED'
    expect(s.getNode(id)!.data.text).toBe('hi')
    // 取快照后 store 新增节点不影响已取快照
    s.addNode('text', { x: 9, y: 9 })
    expect(snap).toHaveLength(1)
  })
})

