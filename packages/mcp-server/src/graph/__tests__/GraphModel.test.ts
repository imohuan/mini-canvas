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
      expect(n1.data).toEqual({})
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
})
