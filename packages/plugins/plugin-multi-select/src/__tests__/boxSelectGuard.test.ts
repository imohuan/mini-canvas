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

  // 用户报的缺陷：第一次拖框正常，**第二次**拖完选中被清空。
  // 守卫本身没坏，坏在"新按下时作废标记"的时机 —— 这里把"连续多次手势"的契约钉死。
  describe('连续多次手势（每次都必须吞掉自己的那一次 click）', () => {
    it('连做三次：每次都吞掉自己那次空白 click，且不误吞别的', () => {
      const g = new BoxSelectClickGuard()
      for (let i = 0; i < 3; i++) {
        // 一次完整手势：按下（作废遗留）→ 拖动 → 松手（进入待命）→ 补发的 click
        g.reset()
        g.markGestureDone(true)
        expect(g.shouldSwallow(true)).toBe(true)
        // 该次 click 已消费，后续真实点击不会被吞
        expect(g.shouldSwallow(true)).toBe(false)
      }
    })

    it('漏掉"新按下时作废"会让上一次次标记失效（这正是第二次拖框被清空的原因）', () => {
      const g = new BoxSelectClickGuard()
      g.markGestureDone(true)
      // 第一次手势的 click 没能消费（例如松手点在节点上、浏览器不补发 click），标记残留：
      // 若第二次按下前不 reset，这次"新拖动"的 click 会被旧标记提前消费掉 →
      // armed 变 false → 真正的补发 click 穿过去 → 选中被清空。
      expect(g.shouldSwallow(false)).toBe(false) // 旧标记被消费（返回 false 说明没吞）
      g.markGestureDone(true) // 第二次拖动结束
      expect(g.shouldSwallow(true)).toBe(true)

      // 规范路径：每次 pointerdown 都 reset → 第二次的 click 也能正常吞掉
      const g2 = new BoxSelectClickGuard()
      g2.markGestureDone(true)
      g2.reset() // ← 新的 pointerdown
      g2.markGestureDone(true)
      expect(g2.shouldSwallow(true)).toBe(true)
    })
  })
})
