import { describe, it, expect } from 'vitest'
import { isTapGesture } from '../gestureClick'

/**
 * 用户口径 2026-10-31：拖画布 / 缩放画布不退出宫格切分。
 * 宿主在平移松手后也会 emit pane-click，必须靠"按下→抬起位移"把它和真正的点击分开。
 */
describe('isTapGesture：区分点空白与拖画布', () => {
  it('按下抬起几乎没动：算点击（点空白 → 退出模式）', () => {
    expect(isTapGesture({ x: 100, y: 100 }, { x: 101, y: 102 })).toBe(true)
  })

  it('平移画布（位移明显）：不算点击', () => {
    expect(isTapGesture({ x: 100, y: 100 }, { x: 260, y: 180 })).toBe(false)
  })

  it('只有极少抖动也在阈值内', () => {
    expect(isTapGesture({ x: 500, y: 500 }, { x: 503, y: 501 })).toBe(true)
  })

  it('缺任一端：按点击处理（保守，不吞掉退出信号）', () => {
    expect(isTapGesture(null, { x: 1, y: 1 })).toBe(true)
    expect(isTapGesture({ x: 1, y: 1 }, null)).toBe(true)
  })
})
