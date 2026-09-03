import { describe, it, expect, beforeEach } from 'vitest'
import { GraphModel } from '../GraphModel'

describe('GraphModel', () => {
  let model: GraphModel

  beforeEach(() => {
    model = new GraphModel()
  })

  describe('画布生命周期（taskId 即画布 id）', () => {
    it('创建画布，重复创建返回同一实例', () => {
      model.createCanvas('t1', '任务一')
      model.createCanvas('t1')
      expect(model.listCanvases()).toHaveLength(1)
      expect(model.listCanvases()[0].name).toBe('任务一')
    })

    it('删除画布', () => {
      model.createCanvas('t1')
      expect(model.deleteCanvas('t1')).toBe(true)
      expect(model.hasCanvas('t1')).toBe(false)
    })

    it('taskId 隔离：不同画布互不干扰', () => {
      model.createCanvas('a')
      model.createCanvas('b')
      const na = model.createNode('a', { type: 'text' })
      expect(model.listNodes('a')).toHaveLength(1)
      expect(model.listNodes('b')).toHaveLength(0)
      expect(model.getNode('a', na.id)).not.toBeNull()
    })
  })

  describe('节点 CRUD', () => {
    it('创建节点生成唯一 id', () => {
      model.createCanvas('t')
      const n1 = model.createNode('t', { type: 'text' })
      const n2 = model.createNode('t', { type: 'image' })
      expect(n1.id).toBeTruthy()
      expect(n1.id).not.toBe(n2.id)
    })

    it('语义类型节点自动转成 VueFlow 格式（type=custom + data.nodeType）', () => {
      model.createCanvas('t')
      const n = model.createNode('t', { type: 'image', data: { label: '图' } })
      expect(n.type).toBe('custom')
      expect(n.data.nodeType).toBe('image')
      expect(n.data.label).toBe('图')
    })

    it('直接传 VueFlow 格式的节点原样保留', () => {
      model.createCanvas('t')
      const n = model.createNode('t', { type: 'custom', data: { nodeType: 'image', label: '图' } })
      expect(n.type).toBe('custom')
      expect(n.data.nodeType).toBe('image')
    })

    it('更新节点合并字段', () => {
      model.createCanvas('t')
      const n = model.createNode('t', { type: 'text', data: { label: 'a' } })
      const updated = model.updateNode('t', n.id, { data: { status: 'done', progress: 100 } })
      expect(updated!.data.label).toBe('a')
      expect(updated!.data.status).toBe('done')
      expect(updated!.data.progress).toBe(100)
    })

    it('删除节点并清理关联连线', () => {
      model.createCanvas('t')
      const a = model.createNode('t', { type: 'image' })
      const b = model.createNode('t', { type: 'text' })
      model.createEdge('t', { source: a.id, target: b.id })
      expect(model.listEdges('t')).toHaveLength(1)
      model.deleteNode('t', a.id)
      expect(model.listNodes('t')).toHaveLength(1)
      expect(model.listEdges('t')).toHaveLength(0)
    })
  })

  describe('连线', () => {
    it('连线成功', () => {
      model.createCanvas('t')
      const a = model.createNode('t', { type: 'image' })
      const b = model.createNode('t', { type: 'text' })
      const edge = model.createEdge('t', { source: a.id, target: b.id })
      expect(edge.source).toBe(a.id)
      expect(edge.target).toBe(b.id)
    })

    it('同一节点不能自连', () => {
      model.createCanvas('t')
      const a = model.createNode('t', { type: 'image' })
      expect(() => model.createEdge('t', { source: a.id, target: a.id })).toThrow()
    })

    it('节点不存在时连线报错', () => {
      model.createCanvas('t')
      const a = model.createNode('t', { type: 'image' })
      expect(() => model.createEdge('t', { source: a.id, target: 'ghost' })).toThrow()
    })
  })

  describe('定位', () => {
    it('设置节点位置', () => {
      model.createCanvas('t')
      const n = model.createNode('t', { type: 'text', position: { x: 1, y: 2 } })
      model.setNodePosition('t', n.id, 100, 200)
      expect(model.getNode('t', n.id)!.position).toEqual({ x: 100, y: 200 })
    })

    it('设置/获取视口', () => {
      model.createCanvas('t')
      model.setViewport('t', { x: 10, y: 20, zoom: 2 })
      expect(model.getViewport('t')).toEqual({ x: 10, y: 20, zoom: 2 })
    })
  })

  describe('事件与版本号', () => {
    it('mutation 派发事件且版本号递增', () => {
      model.createCanvas('t')
      const events: string[] = []
      model.on((e) => events.push(e.type))

      const n = model.createNode('t', { type: 'text' })
      model.updateNode('t', n.id, { data: { status: 'done' } })

      expect(events).toContain('node:added')
      expect(events).toContain('node:updated')
      expect(model.getVersion('t')).toBe(2)
    })

    it('取消订阅后不再收到事件', () => {
      model.createCanvas('t')
      const events: string[] = []
      const off = model.on((e) => events.push(e.type))
      off()
      model.createNode('t', { type: 'text' })
      expect(events).toHaveLength(0)
    })
  })

  describe('序列化', () => {
    it('toJSON/fromJSON 往返一致', () => {
      model.createCanvas('t')
      const a = model.createNode('t', { type: 'image', position: { x: 5, y: 6 } })
      const b = model.createNode('t', { type: 'text' })
      model.createEdge('t', { source: a.id, target: b.id })
      model.setViewport('t', { x: 1, y: 2, zoom: 3 })

      const json = model.toJSON('t')
      const model2 = new GraphModel()
      model2.createCanvas('t')
      model2.fromJSON('t', json)

      expect(model2.listNodes('t')).toHaveLength(2)
      expect(model2.listEdges('t')).toHaveLength(1)
      expect(model2.getViewport('t')).toEqual({ x: 1, y: 2, zoom: 3 })
    })
  })

  describe('批量 CRUD（applyBatch）', () => {
    it('node.batch 合并 add/update/delete 一次执行，顺序 delete→add→update', () => {
      model.createCanvas('t')
      const keep = model.createNode('t', { type: 'text', data: { label: 'keep' } })
      const gone = model.createNode('t', { type: 'text' })
      const r = model.applyBatchNodes('t', {
        add: [{ type: 'image', data: { label: 'new' }, id: 'explicit-add' }],
        update: [{ id: keep.id, patch: { data: { label: 'updated' } } }],
        delete: [gone.id],
      })
      expect(r.ok).toBe(true)
      expect(r.added).toEqual(['explicit-add'])
      expect(r.deleted).toEqual([gone.id])
      expect(r.updated).toEqual([keep.id])
      // gone 已删、新增存在、keep 已更新
      expect(model.getNode('t', gone.id)).toBeNull()
      expect(model.getNode('t', 'explicit-add')!.data.nodeType).toBe('image')
      expect(model.getNode('t', keep.id)!.data.label).toBe('updated')
    })

    it('node.batch add 显式 id 与存量冲突 → 整批拒绝、不做任何变更', () => {
      model.createCanvas('t')
      const a = model.createNode('t', { type: 'text', data: { label: 'a' } })
      const before = model.listNodes('t').length
      const r = model.applyBatchNodes('t', {
        add: [{ type: 'image', id: a.id }], // 与 a 撞 id
        delete: [a.id],                      // 另一条合法
      })
      expect(r.ok).toBe(false)
      expect(r.errors.length).toBeGreaterThan(0)
      // 整批未执行：a 仍在、数量未变
      expect(model.getNode('t', a.id)).not.toBeNull()
      expect(model.listNodes('t').length).toBe(before)
    })

    it('node.batch update 引用同批新增 id（合法组合）', () => {
      model.createCanvas('t')
      const r = model.applyBatchNodes('t', {
        add: [{ type: 'text', id: 'x' }],
        update: [{ id: 'x', patch: { data: { label: 'after' } } }],
      })
      expect(r.ok).toBe(true)
      expect(model.getNode('t', 'x')!.data.label).toBe('after')
    })

    it('edge.batch 合并 add/delete；add 端点不存在则整批拒绝', () => {
      model.createCanvas('t')
      const a = model.createNode('t', { type: 'image', id: 'a' })
      const b = model.createNode('t', { type: 'text', id: 'b' })
      const e = model.createEdge('t', { source: a.id, target: b.id })
      const r = model.applyBatchEdges('t', {
        add: [{ source: b.id, target: a.id }],
        delete: [e.id],
      })
      expect(r.ok).toBe(true)
      expect(r.added).toHaveLength(1)
      expect(model.listEdges('t').length).toBe(1) // 删 1 增 1
      // add 引用幽灵节点 → 拒绝
      const bad = model.applyBatchEdges('t', { add: [{ source: a.id, target: 'ghost' }] })
      expect(bad.ok).toBe(false)
    })

    it('node:updated 事件携带合并后的完整 node', () => {
      model.createCanvas('t')
      const n = model.createNode('t', { type: 'image', data: { label: 'L', options: { model: 'm' } } })
      let evt: any = null
      model.on((e) => { if (e.type === 'node:updated') evt = e })
      model.updateNode('t', n.id, { data: { progress: 50 } })
      expect(evt).not.toBeNull()
      expect(evt.node.data.label).toBe('L')
      expect(evt.node.data.options.model).toBe('m')
      expect(evt.node.data.progress).toBe(50)
    })

    it('applyBatch 末尾派发 batch:done 事件', () => {
      model.createCanvas('t')
      let done: any = null
      model.on((e) => { if (e.type === 'batch:done') done = e })
      model.applyBatchNodes('t', { add: [{ type: 'text' }] })
      expect(done).not.toBeNull()
      expect(done.resource).toBe('node')
      expect(done.addedCount).toBe(1)
    })
  })
})
