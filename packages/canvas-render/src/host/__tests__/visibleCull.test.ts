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

describe('nodesFromStore × cullIds（_cullState 派生，2026-10-26 hidden 退役）', () => {
  it('集合内 visible；集合外按 linkedIds 派生 culled / culled-linked；hidden 恒 false（连线不消失）', () => {
    const s = makeStore()
    s.addNodes([
      { type: 'text', position: { x: 0, y: 0 }, id: 'vis' },
      { type: 'text', position: { x: 9000, y: 9000 }, id: 'hid' },
    ])
    // 不传 → 全量、状态恒 visible；hidden 显式 false（VueFlow 合并语义清除旧存档残留）
    const plain = nodesFromStore(s)
    expect(plain.map((n) => (n.data as Record<string, unknown>)._cullState)).toEqual(['visible', 'visible'])
    expect(plain.map((n) => n.hidden)).toEqual([false, false])
    // 传集合：集合外 + 不在 linkedIds → culled；hidden 仍 false（节点常驻，壳降级绘制）
    const culled = nodesFromStore(s, undefined, new Set(['vis']))
    expect(culled.find((n) => n.id === 'vis')!.data._cullState).toBe('visible')
    expect(culled.find((n) => n.id === 'hid')!.data._cullState).toBe('culled')
    expect(culled.find((n) => n.id === 'hid')!.hidden).toBe(false)
    // 传 linkedIds：集合外但有连线 → culled-linked（至少一端画布内的连线保持完整）
    const linked = nodesFromStore(s, undefined, new Set(['vis']), new Set(['hid']))
    expect(linked.find((n) => n.id === 'hid')!.data._cullState).toBe('culled-linked')
  })

  it('临时节点（拖线菜单卡）永不剔除 —— 不写 _cullState（壳恒全量绘制）', () => {
    const s = makeStore()
    s.addNodes([
      { type: 'text', position: { x: 0, y: 0 }, id: 'normal' },
      { type: 'text', position: { x: 150, y: 150 }, id: 'temp', data: { transient: true } },
    ])
    // cullIds 只含 'normal'：temp 不在集合里，但它是 transient → 不派生状态（恒全量）
    const culled = nodesFromStore(s, undefined, new Set(['normal']))
    expect(culled.find((n) => n.id === 'temp')!.data._cullState).toBeUndefined()
    expect(culled.find((n) => n.id === 'normal')!.data._cullState).toBe('visible')
  })

  it('全选场景：选中标记与剔除独立共存（选中不豁免剔除）', () => {
    const s = makeStore()
    s.addNodes([
      { type: 'text', position: { x: 0, y: 0 }, id: 'a' },
      { type: 'text', position: { x: 9000, y: 9000 }, id: 'b' },
    ])
    const out = nodesFromStore(s, new Set(['a', 'b']), new Set(['a']))
    const a = out.find((n) => n.id === 'a')!
    const b = out.find((n) => n.id === 'b')!
    expect(a.selected).toBe(true)
    expect(a.data._cullState).toBe('visible')
    expect(b.selected).toBe(true) // 选中状态完整保留（全选 = 全部选中）
    expect(b.data._cullState).toBe('culled') // 但按状态降级绘制（零例外）
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

  it('linkedIds 只收"跨内外"的边：两端都视口外（cullIds 外）或都在内的边不进 linked', () => {
    const s = makeStore()
    s.addNodes([
      { type: 'text', position: { x: 0, y: 0 }, id: 'in1' },
      { type: 'text', position: { x: 9000, y: 9000 }, id: 'out1' },
      { type: 'text', position: { x: 9500, y: 9500 }, id: 'out2' },
    ])
    // cullIds = 视口内可见集合；out1/out2 都在视口外（不在集合里）
    const visible = new Set(['in1'])
    const culled = (id: string): boolean => !visible.has(id)
    // out1—out2 两端都在视口外：这条边两端点都在画布外，不进 linkedIds（两端按 culled 处理）
    let linked = new Set<string>()
    for (const e of [{ source: 'out1', target: 'out2' }]) {
      const sOut = culled(e.source)
      const tOut = culled(e.target)
      if (sOut !== tOut) { linked.add(e.source); linked.add(e.target) }
    }
    expect(linked.size).toBe(0)
    // in1 (0,0) 在视口内，不在 culled 集合 —— 状态按 cullIds 判 visible
    const states = nodesFromStore(s, undefined, visible, linked)
    expect(states.find((n) => n.id === 'out1')!.data._cullState).toBe('culled')
    // in1—out1 跨内外：两端都进 linkedIds（连线必须保持完整，两端骨架常驻）
    linked = new Set<string>()
    for (const e of [{ source: 'in1', target: 'out1' }]) {
      const sOut = culled(e.source)
      const tOut = culled(e.target)
      if (sOut !== tOut) { linked.add(e.source); linked.add(e.target) }
    }
    expect(linked.has('in1')).toBe(true)
    expect(linked.has('out1')).toBe(true)
    const states2 = nodesFromStore(s, undefined, visible, linked)
    expect(states2.find((n) => n.id === 'in1')!.data._cullState).toBe('visible')
    expect(states2.find((n) => n.id === 'out1')!.data._cullState).toBe('culled-linked')
  })

  it('压缩档（compactShells）：纯 culled hidden=true 无壳；culled-linked/visible 恒常驻；关掉恢复', () => {
    const s = makeStore()
    s.addNodes([
      { type: 'text', position: { x: 0, y: 0 }, id: 'vis' },
      { type: 'text', position: { x: 9000, y: 9000 }, id: 'out-link' },
      { type: 'text', position: { x: 9500, y: 9500 }, id: 'out-alone' },
      { type: 'text', position: { x: 120, y: 120 }, id: 'temp', data: { transient: true } },
    ])
    const visible = new Set(['vis', 'temp']) // temp 是 transient，宿主算集合时也不会给它（这里保守含入）
    const linked = new Set(['out-link'])
    const compact = nodesFromStore(s, undefined, visible, linked, true)
    expect(compact.find((n) => n.id === 'out-alone')!.hidden).toBe(true)  // 纯屏外：零 DOM
    expect(compact.find((n) => n.id === 'out-link')!.hidden).toBe(false)  // 跨线节点恒常驻（连线断线教训）
    expect(compact.find((n) => n.id === 'vis')!.hidden).toBe(false)
    expect(compact.find((n) => n.id === 'temp')!.hidden).toBe(false)      // transient 永不隐藏
    // 压缩档纯 culled 不注入 _cullState（无壳无消费方）
    expect(compact.find((n) => n.id === 'out-alone')!.data._cullState).toBeUndefined()
    // 关掉压缩 = 壳全挂（现状），hidden 全显式 false
    const full = nodesFromStore(s, undefined, visible, linked, false)
    expect(full.map((n) => n.hidden)).toEqual([false, false, false, false])
    expect(full.find((n) => n.id === 'out-alone')!.data._cullState).toBe('culled')
  })
})
