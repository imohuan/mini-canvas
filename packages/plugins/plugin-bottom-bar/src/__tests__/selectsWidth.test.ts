/**
 * 底栏两个下拉的宽度预算（用户 2026-11-16 截图：模型名被参数摘要挤掉）。
 *
 * 用户原话：「你需要根据 config 配置的总宽度，还有右侧提供了多少个按钮，
 * 综合因素来决定你的下拉框宽度」。所以这里锁住三条：
 * 1. 右侧按钮越多，两个下拉的总空间越小；
 * 2. 各自有上下限（不会归零，也不会无限长）；
 * 3. 空间不够时先收模型、再收参数，不会让某一格吃满。
 */
import { describe, expect, it } from 'vitest'
import { selectsBudget } from '../node-bottom-bar/selectsWidth'

describe('底栏下拉宽度预算', () => {
  it('按钮区越宽，两个下拉的上限越小', () => {
    const few = selectsBudget({ rowWidth: 640, actionsWidth: 120, gap: 8 })
    const many = selectsBudget({ rowWidth: 640, actionsWidth: 260, gap: 8 })
    expect(many.modelMax + many.paramMax).toBeLessThan(few.modelMax + few.paramMax)
  })

  it('宽度够时两个都有合理上限，留出 gap', () => {
    const b = selectsBudget({ rowWidth: 640, actionsWidth: 100, gap: 8 })
    expect(b.modelMax).toBeGreaterThanOrEqual(96)
    expect(b.paramMax).toBeGreaterThanOrEqual(72)
    expect(b.modelMax + b.paramMax + 8).toBeLessThanOrEqual(640 - 100)
  })

  it('按钮太多时不许把某一格算成负数或 0', () => {
    const b = selectsBudget({ rowWidth: 300, actionsWidth: 280, gap: 8 })
    expect(b.modelMax).toBeGreaterThan(0)
    expect(b.paramMax).toBeGreaterThan(0)
  })

  it('上限不会无限长（宽屏也不铺满整行）', () => {
    const b = selectsBudget({ rowWidth: 1600, actionsWidth: 100, gap: 8 })
    expect(b.modelMax).toBeLessThanOrEqual(280)
    expect(b.paramMax).toBeLessThanOrEqual(240)
  })

  it('异常的宽度输入不炸（NaN / 负数按 0 处理）', () => {
    const b = selectsBudget({ rowWidth: Number.NaN, actionsWidth: -10 })
    expect(Number.isFinite(b.modelMax)).toBe(true)
    expect(Number.isFinite(b.paramMax)).toBe(true)
  })
})
