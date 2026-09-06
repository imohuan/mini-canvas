import { describe, it, expect } from 'vitest'
import { NodeStore } from '@mini-canvas/canvas-core-v2'
import { NodeLayoutService } from '../nodeLayout'

function makeStore(): NodeStore {
  const s = new NodeStore()
  s.registerType({ type: 'text', label: '文本', defaultSize: { w: 300, h: 200 } })
  s.registerType({ type: 'group', label: '分组', defaultSize: { w: 100, h: 100 } })
  return s
}

describe('NodeLayoutService 布局只读服务', () => {
  it('未量测时尺寸回落到 node.size，再回落 type.defaultSize', () => {
    const s = makeStore()
    s.addNodes([
      { type: 'text', position: { x: 10, y: 20 }, id: 'a' },
      { type: 'text', position: { x: 30, y: 40 }, id: 'b', size: { w: 500, h: 100 } },
    ])
    const svc = new NodeLayoutService(s)
    expect(svc.getNodeRect('a')).toEqual({ id: 'a', x: 10, y: 20, w: 300, h: 200 })
    expect(svc.getNodeRect('b')).toEqual({ id: 'b', x: 30, y: 40, w: 500, h: 100 })
  })

  it('setMeasuredSize 覆盖静态尺寸；clearMeasuredSize 回落；非法值忽略', () => {
    const s = makeStore()
    s.addNodes([{ type: 'text', position: { x: 0, y: 0 }, id: 'a' }])
    const svc = new NodeLayoutService(s)
    svc.setMeasuredSize('a', 640, 480)
    expect(svc.getNodeRect('a')!.w).toBe(640)
    expect(svc.getNodeRect('a')!.h).toBe(480)
    svc.setMeasuredSize('a', 0, 10) // 非法宽忽略
    expect(svc.getNodeRect('a')!.w).toBe(640)
    svc.clearMeasuredSize('a')
    expect(svc.getNodeRect('a')!.w).toBe(300)
  })

  it('absolutePosition 累加父链：子相对父 + 父绝对 = 子绝对', () => {
    const s = makeStore()
    s.addNodes([
      { type: 'group', position: { x: 100, y: 50 }, id: 'g' },
      { type: 'text', position: { x: 10, y: 20 }, id: 'c', parentId: 'g' },
    ])
    const svc = new NodeLayoutService(s)
    expect(svc.absolutePosition('c')).toEqual({ x: 110, y: 70 })
    expect(svc.absolutePosition('g')).toEqual({ x: 100, y: 50 })
  })

  it('childrenOf 返回直属子矩形', () => {
    const s = makeStore()
    s.addNodes([
      { type: 'group', position: { x: 0, y: 0 }, id: 'g' },
      { type: 'text', position: { x: 1, y: 1 }, id: 'c1', parentId: 'g' },
      { type: 'text', position: { x: 2, y: 2 }, id: 'c2', parentId: 'g' },
      { type: 'text', position: { x: 3, y: 3 }, id: 'free' },
    ])
    const svc = new NodeLayoutService(s)
    expect(svc.childrenOf('g').map((r) => r.id).sort()).toEqual(['c1', 'c2'])
  })

  it('getAllRects 返回全部节点；不存在节点返回 null', () => {
    const s = makeStore()
    s.addNodes([{ type: 'text', position: { x: 0, y: 0 }, id: 'a' }])
    const svc = new NodeLayoutService(s)
    expect(svc.getAllRects().length).toBe(1)
    expect(svc.getNodeRect('nope')).toBeNull()
  })

  it('父链环保护：不无限递归', () => {
    const s = makeStore()
    // 手工构造环 a.parent=b, b.parent=a（绕过 store 校验直接 replaceAll）
    s.replaceAll([
      { id: 'a', type: 'text', position: { x: 1, y: 1 }, data: {}, parentId: 'b' },
      { id: 'b', type: 'text', position: { x: 2, y: 2 }, data: {}, parentId: 'a' },
    ] as never)
    const svc = new NodeLayoutService(s)
    // 不应死循环：a 绝对坐标 = a.pos + b.pos（环中断，不会无限累加）
    const pos = svc.absolutePosition('a')
    expect(pos).toEqual({ x: 3, y: 3 })
  })
})

