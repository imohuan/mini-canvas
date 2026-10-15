import { describe, expect, it } from 'vitest'
import { NodeStore } from '@mini-canvas/canvas-data'
import { NodeLayoutService } from '../../layout/nodeLayout'
import { computeVisibleIds, makeVisiblePredicate, VISIBLE_CULL_DEFAULTS } from '../visibleCull'
import { nodesFromStore } from '../canvasHostCore'
import type { FlowRect } from '../../geometry/visibleArea'

function makeStore() {
  const s = new NodeStore()
  s.registerType({ type: 'text', label: '文本', defaultSize: { w: 100, h: 40 } })
  s.registerType({ type: 'group', label: '分组', defaultSize: { w: 500, h: 400 }, transparent: true })
  return s
}

/** 视口矩形：x 0..1000, y 0..800 */
const VIEW: FlowRect = { x: 0, y: 0, w: 1000, h: 800 }

describe('visibleCull（可见剔除纯逻辑）', () => {
  it('视口内的节点可见，视口外的不可见', () => {
    const layout = {
      getAllRects: () => [
        { id: 'in', x: 100, y: 100, w: 100, h: 50 },
        { id: 'far', x: 5000, y: 5000, w: 100, h: 50 },
      ],
    } as never
    const ids = computeVisibleIds(layout, VIEW, VISIBLE_CULL_DEFAULTS)
    expect(ids).not.toBeNull()
    expect(ids!.has('in')).toBe(true)
    expect(ids!.has('far')).toBe(false)
  })

  it('压线（部分相交）算可见', () => {
    const p = makeVisiblePredicate(VIEW, { enabled: true, buffer: 0 })
    expect(p!({ id: 'edge', x: 990, y: 0, w: 100, h: 50 })).toBe(true) // 压右缘
    expect(p!({ id: 'out', x: 1001, y: 0, w: 100, h: 50 })).toBe(false)
  })

  it('缓冲带把视口外一圈的节点也纳入', () => {
    const tight = makeVisiblePredicate(VIEW, { enabled: true, buffer: 0 })
    const loose = makeVisiblePredicate(VIEW, { enabled: true, buffer: 300 })
    const rect = { id: 'near', x: 1100, y: 0, w: 100, h: 50 } // 视口外 100
    expect(tight!(rect)).toBe(false)
    expect(loose!(rect)).toBe(true)
  })

  it('禁用或视口不可用 → null（全量渲染兜底）', () => {
    expect(makeVisiblePredicate(VIEW, { enabled: false, buffer: 300 })).toBeNull()
    expect(makeVisiblePredicate(null, VISIBLE_CULL_DEFAULTS)).toBeNull()
    const layout = { getAllRects: () => [{ id: 'a', x: 9999, y: 9999, w: 10, h: 10 }] } as never
    expect(computeVisibleIds(layout, null, VISIBLE_CULL_DEFAULTS)).toBeNull()
  })

  it('零例外：被选中/正在拖的节点视口外同样被剔（选中是数据态，不靠渲染维持）', () => {
    const layout = {
      getAllRects: () => [{ id: 'sel', x: 5000, y: 5000, w: 100, h: 50 }],
    } as never
    const ids = computeVisibleIds(layout, VIEW, VISIBLE_CULL_DEFAULTS)
    expect(ids!.has('sel')).toBe(false) // 即便它是选中的，判定也一视同仁
  })
})

describe('nodesFromStore × cullIds（hidden 标记注入）', () => {
  it('不在剔除集合内的节点带 hidden:true；集合内/不传集合则不带', () => {
    const s = makeStore()
    s.addNodes([
      { type: 'text', position: { x: 0, y: 0 }, id: 'vis' },
      { type: 'text', position: { x: 9000, y: 9000 }, id: 'hid' },
    ])
    // 不传 → 全量、hidden 显式 false（禁用剔除也要写：清残留的 true，见 canvasHostCore 合并语义注释）
    const plain = nodesFromStore(s)
    expect(plain.map((n) => n.hidden)).toEqual([false, false])
    // 传集合 → 集合内显式 false（清残留），集合外 true
    const culled = nodesFromStore(s, undefined, new Set(['vis']))
    expect(culled.find((n) => n.id === 'vis')!.hidden).toBe(false)
    expect(culled.find((n) => n.id === 'hid')!.hidden).toBe(true)
  })

  it('全选场景：选中标记与 hidden 标记独立共存（选中不豁免剔除）', () => {
    const s = makeStore()
    s.addNodes([
      { type: 'text', position: { x: 0, y: 0 }, id: 'a' },
      { type: 'text', position: { x: 9000, y: 9000 }, id: 'b' },
    ])
    const out = nodesFromStore(s, new Set(['a', 'b']), new Set(['a']))
    const a = out.find((n) => n.id === 'a')!
    const b = out.find((n) => n.id === 'b')!
    expect(a.selected).toBe(true)
    expect(a.hidden).toBe(false) // 可见节点显式 false（合并语义清除残留 true）
    expect(b.selected).toBe(true) // 选中状态完整保留（全选 = 全部选中）
    expect(b.hidden).toBe(true) // 但不渲染（零例外）
  })

  it('分组父节点走同一判定：子命中时父按自身矩形命中（几何包含关系，无特判）', () => {
    const s = makeStore()
    s.addNodes([{ type: 'group', position: { x: 0, y: 0 }, id: 'g1', size: { w: 500, h: 400 } }])
    const layout = new NodeLayoutService(s)
    expect(layout.getNodeRect('g1')).toEqual({ id: 'g1', x: 0, y: 0, w: 500, h: 400 })
    // 分组矩形 (0,0,500,400) 与视口 (0,0,1000,800) 相交 → 命中
    const ids = computeVisibleIds(layout, VIEW, { enabled: true, buffer: 0 })
    expect(ids!.has('g1')).toBe(true)
  })
})
