import { describe, expect, it } from 'vitest'
import { runAutoLayout } from '../layoutEngine'
import type { AutoLayoutConfig, LayoutEdge, LayoutNode } from '../types'

/**
 * 「间距计入节点标题高度」开关（用户 2026-11-13 报的问题）。
 *
 * 现象：设置里给了间距，但布局出来的节点还是挨在一起。根因：节点标题条浮在卡片**外面**，
 * node.size 只含卡片，排布也只按卡片算 —— 上下相邻时下面那个的标题正好顶在上一个卡片底边上，
 * 肉眼看就是“没有间距”，标题还会互相压住。
 *
 * 这里把开关两端的行为锁死：
 *   打开 → 占位高度 = 卡片高 + 标题高，节点之间的**空隙**也随标题高度变大；
 *   关闭 → 行为与改动前逐字一致（只按卡片）。
 */

const node = (id: string): LayoutNode => ({
  id,
  type: 'x',
  position: { x: 0, y: 0 },
  size: { w: 100, h: 80 },
})
const edge = (id: string, source: string, target: string): LayoutEdge => ({ id, source, target })

function config(over: Partial<AutoLayoutConfig> = {}): AutoLayoutConfig {
  return {
    direction: 'TB',
    intraSpacing: { x: 60, y: 80 },
    interSpacing: { x: 120, y: 120 },
    includeTitleHeight: true,
    titleHeight: 24,
    focusHeightRatio: 0.5,
    minZoom: 0.1,
    maxZoom: 4,
    debug: false,
    ...over,
  }
}

function layout(cfg: AutoLayoutConfig) {
  const result = runAutoLayout({
    nodes: [node('a'), node('b')],
    edges: [edge('e1', 'a', 'b')],
    groups: [],
    config: cfg,
  })
  const map = new Map(result.nodes.map((n) => [n.id, { ...n.position }]))
  return map
}

/** a 的底边到 b 的顶边之间的空隙（TB 时是 Y 轴） */
function verticalGap(map: Map<string, { x: number; y: number }>, cardH = 80) {
  return map.get('b')!.y - (map.get('a')!.y + cardH)
}

describe('自动布局：标题高度开关', () => {
  it('关闭时：空隙 = 垂直间距本身（只按卡片排）', () => {
    const map = layout(config({ includeTitleHeight: false, intraSpacing: { x: 60, y: 80 } }))
    expect(verticalGap(map)).toBeCloseTo(80, 0)
  })

  it('打开时：节点之间多留出标题高度，标题不会压住下一个节点', () => {
    const off = layout(config({ includeTitleHeight: false, intraSpacing: { x: 60, y: 80 } }))
    const on = layout(config({ includeTitleHeight: true, titleHeight: 24, intraSpacing: { x: 60, y: 80 } }))
    expect(verticalGap(on) - verticalGap(off)).toBeCloseTo(24, 0)
  })

  it('titleHeight 可调：调大占位跟着变大（用户能在设置里对齐标题字号）', () => {
    const small = layout(config({ includeTitleHeight: true, titleHeight: 10 }))
    const large = layout(config({ includeTitleHeight: true, titleHeight: 40 }))
    expect(verticalGap(large) - verticalGap(small)).toBeCloseTo(30, 0)
  })

  it('横向流（LR）不受标题高度影响：标题只占竖直方向', () => {
    const narrow = layout(config({ direction: 'LR', includeTitleHeight: true, titleHeight: 10, intraSpacing: { x: 60, y: 80 } }))
    const tall = layout(config({ direction: 'LR', includeTitleHeight: true, titleHeight: 60, intraSpacing: { x: 60, y: 80 } }))
    const dx = (m: Map<string, { x: number; y: number }>) => m.get('b')!.x - m.get('a')!.x
    expect(dx(tall)).toBeCloseTo(dx(narrow), 0)
  })
})
