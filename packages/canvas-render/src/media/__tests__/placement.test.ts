/**
 * media.placement —— “新节点放哪”的规则（用户口径 2026-10-30）。
 *
 * 锁死的四条：
 * 1. 优先放源节点右边，右边被占用时换到下方；
 * 2. 绝不与已有节点矩形重叠；
 * 3. 有视口时结果完整落在可视区内（含安全边距）；
 * 4. 没有源节点时落在视口中心，没有视口时落在现有内容的右侧。
 */
import { describe, it, expect } from 'vitest'
import { placeAdjacent } from '../placement'

const source = { id: 's', x: 100, y: 100, w: 400, h: 300 }
const size = { w: 320, h: 240 }
const visible = { x: 0, y: 0, w: 1600, h: 1000 }

describe('placeAdjacent：源节点旁的空位', () => {
  it('优先放右边：同顶边、右缘 + 间距', () => {
    expect(placeAdjacent({ size, source, visible })).toEqual({ x: 540, y: 100 })
  })

  it('右边空间不足 / 被占 → 换到下方（不重叠）', () => {
    const blocker = { id: 'b', x: 540, y: 100, w: 320, h: 240 }
    const p = placeAdjacent({ size, source, visible: { x: 0, y: 0, w: 700, h: 1000 }, obstacles: [blocker] })
    expect(p).toEqual({ x: 100, y: 440 })
  })

  it('右边下方都被占 → 沿源节点向下继续找，仍不重叠', () => {
    const obstacles = [
      { id: 'b1', x: 540, y: 100, w: 320, h: 240 },
      { id: 'b2', x: 540, y: 380, w: 320, h: 240 },
      { id: 'b3', x: 540, y: 660, w: 320, h: 240 },
    ]
    const p = placeAdjacent({ size, source, visible, obstacles })
    expect(p.x).not.toBe(540)
    expect(p.y).not.toBe(100)
    for (const b of obstacles) {
      const overlaps = p.x < b.x + b.w && p.x + size.w > b.x && p.y < b.y + b.h && p.y + size.h > b.y
      expect(overlaps).toBe(false)
    }
  })

  it('源节点在视口右下角 → 结果仍完整落在可视区里', () => {
    const corner = { id: 's', x: 1200, y: 700, w: 300, h: 200 }
    const p = placeAdjacent({ size, source: corner, visible })
    expect(p.x).toBeGreaterThanOrEqual(visible.x)
    expect(p.y).toBeGreaterThanOrEqual(visible.y)
    expect(p.x + size.w).toBeLessThanOrEqual(visible.x + visible.w)
    expect(p.y + size.h).toBeLessThanOrEqual(visible.y + visible.h)
  })

  it('没有源节点 → 视口中心；中心被占 → 可视区里找最近的空位', () => {
    expect(placeAdjacent({ size, visible })).toEqual({ x: 640, y: 380 })
    const centerBlocker = { id: 'c', x: 600, y: 340, w: 400, h: 300 }
    const p = placeAdjacent({ size, visible, obstacles: [centerBlocker] })
    expect(p).not.toEqual({ x: 640, y: 380 })
    const overlaps = p.x < 1000 && p.x + size.w > 600 && p.y < 640 && p.y + size.h > 340
    expect(overlaps).toBe(false)
  })

  it('既没有源节点也没有视口 → 摆在已有内容的右侧，不叠上去', () => {
    const obstacles = [
      { id: 'a', x: 0, y: 0, w: 300, h: 200 },
      { id: 'b', x: 320, y: 0, w: 300, h: 200 },
    ]
    expect(placeAdjacent({ size, obstacles })).toEqual({ x: 660, y: 0 })
  })

  it('极端窄视口（比节点还小）→ 仍贴着源节点放，不压上去', () => {
    // 视口装不下任何空位时，"塞进视口"会让新节点盖住源节点；这里宁可出屏也要留出关系。
    const p = placeAdjacent({ size, source, visible: { x: 0, y: 0, w: 200, h: 150 } })
    expect(p).toEqual({ x: 540, y: 100 })
  })

  /**
   * 2026-10-30 实测：截图时画布刚被重灌，视口尺寸/缩放还没稳定（可视区只剩一小块），
   * 旧算法为了"塞进视口"把新节点压在源视频身上（x=212，与源节点 200 重叠）。
   * 用户口径：**先别叠**，宁可稍微出屏。屏内空位仍是第一优先。
   */
  it('视口装不下 → 宁可出屏也不压源节点（源节点也是障碍）', () => {
    const tiny = { x: 0, y: 0, w: 300, h: 200 }
    const p = placeAdjacent({ size, source, visible: tiny, obstacles: [source] })
    const overlaps = p.x < source.x + source.w && p.x + size.w > source.x && p.y < source.y + source.h && p.y + size.h > source.y
    expect(overlaps).toBe(false)
    // 仍然优先贴着源节点右边
    expect(p).toEqual({ x: 540, y: 100 })
  })

  it('尺寸非法（0 / NaN）→ 回落到安全默认尺寸，不产生 NaN 坐标', () => {
    const p = placeAdjacent({ size: { w: 0, h: Number.NaN }, source, visible })
    expect(Number.isFinite(p.x)).toBe(true)
    expect(Number.isFinite(p.y)).toBe(true)
    expect(p).toEqual({ x: 540, y: 100 })
  })
})
