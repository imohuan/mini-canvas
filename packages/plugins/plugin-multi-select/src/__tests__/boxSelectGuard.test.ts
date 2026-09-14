/**
 * 框选后误点击守卫（用户报的缺陷："shift+左键框选完成之后并没有真实框选…没有任何选中状况"）。
 *
 * 现象：框选期间选中确实写进去了，但松手后紧跟的那次 pane click 被宿主当成"点空白"，
 * 一下把刚框出的选中全清掉 —— 用户看到的等价于"框选不生效"。
 */
import { describe, it, expect } from 'vitest'
import { BoxSelectClickGuard } from '../boxSelectGuard'

describe('BoxSelectClickGuard', () => {
  it('真框选后、落点在空白 → 吞掉那一次 click（选中因此保住）', () => {
    const g = new BoxSelectClickGuard()
    g.markGestureDone(true)
    expect(g.shouldSwallow(true)).toBe(true)
  })

  it('原地按下再抬起（没拖动）不算框选 → 不吞 click（Shift 点空白仍能清空选中）', () => {
    const g = new BoxSelectClickGuard()
    g.markGestureDone(false)
    expect(g.shouldSwallow(true)).toBe(false)
  })

  it('落点在节点/边上 → 不吞（那不是"点空白"，本来也不会清选中）', () => {
    const g = new BoxSelectClickGuard()
    g.markGestureDone(true)
    expect(g.shouldSwallow(false)).toBe(false)
  })

  it('机会只有一次：吞过之后不再吞后续点击', () => {
    const g = new BoxSelectClickGuard()
    g.markGestureDone(true)
    expect(g.shouldSwallow(true)).toBe(true)
    expect(g.shouldSwallow(true)).toBe(false)
  })

  it('落点不在空白也会消费掉机会（那是同一下 click，不该留着影响后面）', () => {
    const g = new BoxSelectClickGuard()
    g.markGestureDone(true)
    expect(g.shouldSwallow(false)).toBe(false)
    expect(g.shouldSwallow(true)).toBe(false)
  })

  it('新的 pointerdown 作废未消费的标记（松手落在节点上时不会误吞下一次真实点击）', () => {
    const g = new BoxSelectClickGuard()
    g.markGestureDone(true)
    g.reset()
    expect(g.shouldSwallow(true)).toBe(false)
  })

  it('初始态不吞任何点击', () => {
    const g = new BoxSelectClickGuard()
    expect(g.shouldSwallow(true)).toBe(false)
  })
})

