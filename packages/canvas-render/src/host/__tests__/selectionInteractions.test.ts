import { describe, it, expect } from 'vitest'
import { Selection } from '@mini-canvas/canvas-data'
import { clickNode, clickEdge, clickPane } from '../selectionInteractions'
import { dragSelectNode } from '../selectionInteractions'

function makeSel() {
  const s = new Selection()
  s.set(['n1', 'n2'])
  s.addEdge('e1')
  return s
}

describe('selectionInteractions 点选语义', () => {
  it('普通点选节点 → 边清空 + 节点单选', () => {
    const s = makeSel()
    clickNode(s, 'n1')
    expect([...s.ids]).toEqual(['n1'])
    expect(s.edgeIds.size).toBe(0)
  })

  it('Shift+点选未选中节点 → 追加；Shift+点选已选中节点 → 移除，边不动', () => {
    const s = makeSel()
    clickNode(s, 'n3', { shiftKey: true })
    expect([...s.ids].sort()).toEqual(['n1', 'n2', 'n3'])
    expect([...s.edgeIds]).toEqual(['e1'])
    clickNode(s, 'n1', { shiftKey: true })
    expect([...s.ids].sort()).toEqual(['n2', 'n3'])
    expect([...s.edgeIds]).toEqual(['e1'])
  })

  it('普通点选边 → 节点清空 + 边单选', () => {
    const s = makeSel()
    clickEdge(s, 'e9')
    expect(s.ids.size).toBe(0)
    expect([...s.edgeIds]).toEqual(['e9'])
  })

  it('Shift+点选边 → 追加/移除，节点不动', () => {
    const s = makeSel()
    clickEdge(s, 'e2', { shiftKey: true })
    expect([...s.edgeIds].sort()).toEqual(['e1', 'e2'])
    expect([...s.ids].sort()).toEqual(['n1', 'n2'])
    clickEdge(s, 'e1', { shiftKey: true })
    expect([...s.edgeIds]).toEqual(['e2'])
  })

  it('点画布空白 → 节点与边全清空；无选中时返回 false', () => {
    const s = makeSel()
    expect(clickPane(s)).toBe(true)
    expect(s.ids.size).toBe(0)
    expect(s.edgeIds.size).toBe(0)
    expect(clickPane(s)).toBe(false)
  })
})

describe('dragSelectNode 拖拽选中（onNodeDragStart 用）', () => {
  it('开关关 → 不动、返回 false', () => {
    const s = makeSel()
    expect(dragSelectNode(s, 'n9', { enabled: false, selectable: true })).toBe(false)
    expect(s.has('n9')).toBe(false)
  })

  it('元素不可选中 → 不动', () => {
    const s = makeSel()
    expect(dragSelectNode(s, 'n9', { enabled: true, selectable: false })).toBe(false)
    expect(s.has('n9')).toBe(false)
  })

  it('开关开 + 未选中 → 单选该节点（替换原选中）', () => {
    const s = makeSel()
    expect(dragSelectNode(s, 'n9', { enabled: true, selectable: true })).toBe(true)
    expect([...s.ids]).toEqual(['n9'])
  })

  it('节点已在选中集（多选拖整组）→ 保持现状不动（不缩成单选）', () => {
    const s = makeSel()
    expect(dragSelectNode(s, 'n1', { enabled: true, selectable: true })).toBe(false)
    expect([...s.ids].sort()).toEqual(['n1', 'n2'])
  })
})
