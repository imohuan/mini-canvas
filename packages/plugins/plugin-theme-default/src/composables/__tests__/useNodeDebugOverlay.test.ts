/**
 * useNodeDebugOverlay —— 吸附调试几何的回归测试（用户可见行为）。
 *
 * 背景（用户报的缺陷）："你的吸附调试框被你给吃了？怎么不见了" ——
 * 真因不是调试框没渲染，而是 DEFAULT_THEME_SNAP_ZONE.width 历史上默认 0
 * （"0=塌成 0 宽、不兜底"的语义），带几何算出来宽 0，SVG 画了个看不见的空气。
 *
 * 本文件锁三件事（全走纯几何，零 Vue/DOM）：
 * 1. 主题默认配置（DEFAULT_THEME_SNAP_ZONE）给出的带**宽必须 > 0**——
 *    谁再把默认改回 0，这条先红；
 * 2. 默认配置下，左右两侧带都是"贴边竖条"：target 向左伸出卡外（x<0）、source 向右伸出（x>卡宽）；
 * 3. 组件消费侧（BaseNode 传 handleRadius=portZoneWidth）与 resolveFeedback 同源：
 *    用与 BaseNode 相同的入参调 computeSideBandRect，断言左右带的锚点贴住卡缘。
 */
import { describe, it, expect } from 'vitest'
import { ref } from 'vue'
import { computeSideBandRect } from '@mini-canvas/canvas-render'
import { DEFAULT_THEME_SNAP_ZONE } from '../../index'
import { useNodeDebugOverlay } from '../useNodeDebugOverlay'

describe('吸附调试几何 —— 带"看得见"的回归锁', () => {
  const CARD_W = 256
  const CARD_H = 128
  const PORT_ZONE_W = 10 // 主题当前 portZoneWidth 默认（handleRadius 兜底来源）

  it('主题默认配置的吸附带宽 > 0（历史上默认 0 → 调试框宽 0 → "看不见"）', () => {
    expect(DEFAULT_THEME_SNAP_ZONE.width).toBeGreaterThan(0)
    expect(DEFAULT_THEME_SNAP_ZONE.heightRatio).toBeGreaterThan(0)
  })

  it('默认配置下：target 带向左伸出卡外、source 带向右伸出卡外，均贴住卡缘', () => {
    const cardWidth = ref(CARD_W)
    const cardHeight = ref(CARD_H)
    const handleRadius = ref(PORT_ZONE_W)
    const { leftBand, rightBand, anchorY } = useNodeDebugOverlay({
      cardWidth,
      cardHeight,
      handleRadius,
      snapZone: { ...DEFAULT_THEME_SNAP_ZONE },
    })

    // 左带：x < 0（向左溢出卡片），右缘贴住卡左缘 x=0
    expect(leftBand.value.width).toBeGreaterThan(0)
    expect(leftBand.value.x).toBeLessThan(0)
    expect(leftBand.value.x + leftBand.value.width).toBeCloseTo(0)
    // 右带：x > 卡宽（向右溢出），左缘贴住卡右缘
    expect(rightBand.value.width).toBeGreaterThan(0)
    expect(rightBand.value.x).toBeCloseTo(CARD_W)
    // 两条带同高、垂直居中于卡高中点
    expect(leftBand.value.height).toBe(rightBand.value.height)
    expect(leftBand.value.height).toBeCloseTo(CARD_H * DEFAULT_THEME_SNAP_ZONE.heightRatio)
    expect(anchorY.value).toBeCloseTo(CARD_H / 2)
  })

  it('组件消费与命中判定同源：BaseNode 传 handleRadius=portZoneWidth，几何与 computeSideBandRect 一致', () => {
    const cardWidth = ref(CARD_W)
    const cardHeight = ref(CARD_H)
    const handleRadius = ref(PORT_ZONE_W)
    const { leftBand, rightBand } = useNodeDebugOverlay({
      cardWidth,
      cardHeight,
      handleRadius,
      snapZone: { ...DEFAULT_THEME_SNAP_ZONE },
    })
    const localRect = { id: '__node__', x: 0, y: 0, width: CARD_W, height: CARD_H }
    const direct = computeSideBandRect(localRect, 'target', PORT_ZONE_W, { ...DEFAULT_THEME_SNAP_ZONE })
    expect(leftBand.value).toEqual(direct)
    const directSource = computeSideBandRect(localRect, 'source', PORT_ZONE_W, { ...DEFAULT_THEME_SNAP_ZONE })
    expect(rightBand.value).toEqual(directSource)
  })

  it('显式给 width=0 仍然是"塌成 0 宽"（配置语义不回退：用户就是要 0 就真没有带）', () => {
    const { leftBand } = useNodeDebugOverlay({
      cardWidth: ref(CARD_W),
      cardHeight: ref(CARD_H),
      handleRadius: ref(PORT_ZONE_W),
      snapZone: { ...DEFAULT_THEME_SNAP_ZONE, width: 0 },
    })
    expect(leftBand.value.width).toBe(0)
  })
})
