import { describe, expect, it } from 'vitest'

import { RAPID_MODE_STYLE, createsStackingContext } from '../rapidModeStyle'

/**
 * 回归（2026-10-27 用户实测）：平移画布时连线在节点上下反复跳。
 *
 * 根因：拖拽快速模式给 `.vue-flow__nodes` 写 `will-change: transform`。它是每边 SVG 的**兄弟**，
 * 一旦变成层叠上下文，容器 z-index 变成 auto、不参与兄弟间 z 比较 —— 容器内所有节点
 * （普通 200 / 选中 300）整体落到兄弟边的层叠顺序里，于是「节点压边」翻成「边压节点」。
 * 平移时加、300ms 后摘，画面就来回切。
 *
 * 这里锁住"提升合成层但绝不创建层叠上下文"这条契约：数值可换，语义不可破。
 */
describe('RAPID_MODE_STYLE：拖拽快速模式的层提升样式', () => {
  it('不含任何会创建层叠上下文的属性（否则节点/连线层级会翻转）', () => {
    for (const prop of Object.keys(RAPID_MODE_STYLE)) {
      expect(createsStackingContext(prop), `RAPID_MODE_STYLE.${prop} 会创建层叠上下文，禁止用于节点层`).toBe(false)
    }
  })

  it('仍然包含一个合成层提升（性能开关不能变成空操作）', () => {
    expect(Object.keys(RAPID_MODE_STYLE).length).toBeGreaterThan(0)
  })

  it('will-change: transform 必须被判为危险（防以后有人改回去）', () => {
    expect(createsStackingContext('willChange')).toBe(true)
    expect(createsStackingContext('transform')).toBe(true)
    expect(createsStackingContext('isolation')).toBe(true)
    expect(createsStackingContext('opacity')).toBe(true)
  })

  it('backface-visibility 属于安全属性', () => {
    expect(createsStackingContext('backfaceVisibility')).toBe(false)
  })
})
