/**
 * 拖动跟手的纯逻辑（用户报的缺陷："拖拽的时候 选框位置错误"）。
 *
 * 浏览器实测到的错误形态（修前）：鼠标拖 20/40/60/80/100px，框跑了 20/60/120/200/300px ——
 * 每帧在当前值上再加一次"从按下算起的累计位移"，于是第 n 帧偏差 = n 倍位移。
 *
 * 这里的核心断言：**逐帧累加后，框的位移必须恰好等于累计位移**（与帧数、事件次数无关）。
 */
import { describe, it, expect } from 'vitest'
import { followFrame, type FollowRects } from '../dragFollow'

const START: FollowRects = {
  outer: { id: '', x: 100, y: 200, w: 400, h: 300 },
  inner: { id: '', x: 116, y: 234, w: 368, h: 250 },
}

describe('followFrame（拖动时框跟随）', () => {
  it('位移一个量 → 两框精确平移该量', () => {
    const g = followFrame(START, 30, -12)
    expect(g.outer).toEqual({ id: '', x: 130, y: 188, w: 400, h: 300 })
    expect(g.inner).toEqual({ id: '', x: 146, y: 222, w: 368, h: 250 })
  })

  it('尺寸不变（只平移，不缩放 —— 拖框不该改变框的大小）', () => {
    const g = followFrame(START, 999, -999)
    expect(g.outer.w).toBe(START.outer.w)
    expect(g.outer.h).toBe(START.outer.h)
    expect(g.inner.w).toBe(START.inner.w)
    expect(g.inner.h).toBe(START.inner.h)
  })

  it('不改入参（纯函数，快照可重复使用）', () => {
    const snapshot = { outer: { ...START.outer }, inner: { ...START.inner } }
    followFrame(snapshot, 50, 50)
    expect(snapshot.outer).toEqual(START.outer)
    expect(snapshot.inner).toEqual(START.inner)
  })

  it('框与"按下时快照"的相对关系恒定 = padding（拖动不会把两框拖散）', () => {
    const g = followFrame(START, 137, -84)
    expect(g.inner.x - g.outer.x).toBe(START.inner.x - START.outer.x)
    expect(g.inner.y - g.outer.y).toBe(START.inner.y - START.outer.y)
  })

  it('回归：逐帧用同一个快照推进，最终位移严格等于累计位移（修前会翻若干倍）', () => {
    // 模拟 mousemove 逐帧：每帧都用同一个快照 + 那一刻的累计位移
    let current = START
    const totalDx = 100
    for (let moved = 20; moved <= totalDx; moved += 20) {
      current = followFrame(START, moved, 0)
    }
    expect(current.outer.x - START.outer.x).toBe(totalDx)
    expect(current.inner.x - START.inner.x).toBe(totalDx)
  })

  it('回归：把"当前值"误当快照会翻倍 —— 锁住这个坑（这正是修前的写法）', () => {
    // 错误写法：每帧 current = follow(current, 单帧位移)
    let wrong = START
    for (let i = 0; i < 4; i++) wrong = followFrame(wrong, 20, 0)
    // 错误写法 4 帧走了 80，看起来"对"；但真实场景用的是累计位移 → 会变成 20+40+60+80=200
    expect(wrong.outer.x - START.outer.x).toBe(80)

    let wrongAccum = START
    for (const moved of [20, 40, 60, 80]) wrongAccum = followFrame(wrongAccum, moved, 0)
    expect(wrongAccum.outer.x - START.outer.x).toBe(200) // 修前实测：拖 80px 框跑 200px

    // 正确写法：始终以快照为基准 → 80
    let right = START
    for (const moved of [20, 40, 60, 80]) right = followFrame(START, moved, 0)
    expect(right.outer.x - START.outer.x).toBe(80)
  })

  // 用户报的缺陷：拖动"里面的节点"（VueFlow 原生拖动）时框会漂移，松手才跳回正确位置。
  // 根因是拖动中拿"被拖节点的新位置 + 其余节点的旧位置"重算并集（store 还没落盘）。
  // 正确做法与整组拖动一致：用"框快照 + 位移量"移动，偏移天然恒定。
  describe('拖动节点时框跟随（必须用位移量，不能每帧重算并集）', () => {
    it('逐帧用位移量推进 → 框相对节点的偏移恒定不变', () => {
      // 假设抓着的节点沿 (1,1) 每帧走 10：框也应每帧走 10
      const start = START
      const offsets: number[] = []
      for (const moved of [10, 20, 30, 40]) {
        const f = followFrame(start, moved, moved)
        // 框相对"起始框"的位移
        offsets.push(f.outer.x - START.outer.x)
      }
      expect(offsets).toEqual([10, 20, 30, 40])
    })

    it('回归对照：若拿"被拖节点新位置 + 其余节点旧位置"重算并集，偏移会逐帧漂移（修前的错误形态）', () => {
      // 模拟：并集 = min(被拖节点新位置, 其余节点旧位置)。被拖节点往右下走，
      // 一旦它不再是"左上角最小的那个"，并集左上角就卡在旧位置不动 → 框相对节点越差越多。
      const other = { x: 0, y: 0, w: 100, h: 80 } // 另一个选中节点（不动）
      const draggedStart = { x: 0, y: 0, w: 100, h: 80 }
      const expandAt = (dx: number, dy: number) => {
        const dragged = { ...draggedStart, x: draggedStart.x + dx, y: draggedStart.y + dy }
        const minX = Math.min(dragged.x, other.x)
        const minY = Math.min(dragged.y, other.y)
        return { minX, minY } // Δ 会随 dx 增大而失真
      }
      expect(expandAt(0, 0)).toEqual({ minX: 0, minY: 0 })
      // 拖动 40 后，并集左上角仍停在 0（因为另一个节点没动）→ 框本该跟着走 40，却只走了 0
      expect(expandAt(40, 40)).toEqual({ minX: 0, minY: 0 })
      // 而正确做法（位移量）此时框已经走了 40
      expect(followFrame(START, 40, 40).outer.x - START.outer.x).toBe(40)
    })
  })
})
