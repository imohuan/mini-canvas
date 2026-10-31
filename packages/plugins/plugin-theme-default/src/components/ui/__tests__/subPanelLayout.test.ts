import { describe, expect, it } from 'vitest'
import { fitSubPanel } from '../subPanelLayout'

describe('二级浮层收纳进视口', () => {
  it('内容放得下时贴着触发项，不额外限高', () => {
    expect(fitSubPanel(100, 600)).toEqual({ top: 100, maxHeight: 492 })
  })

  it('贴近底部时向上挪，至少留 320px，底部仍留 8px', () => {
    const box = fitSubPanel(729, 855)
    expect(box.top).toBe(527)
    expect(box.maxHeight).toBe(320)
  })

  it('视口比最小高度还矮时从顶部开始，面板内部滚动', () => {
    const box = fitSubPanel(300, 200)
    expect(box.top).toBe(8)
    expect(box.maxHeight).toBe(184)
  })

  it('极端矮视口也不会算出负数', () => {
    const box = fitSubPanel(10, 12, 260, 8)
    expect(box.top).toBe(8)
    expect(box.maxHeight).toBe(0)
  })
})
