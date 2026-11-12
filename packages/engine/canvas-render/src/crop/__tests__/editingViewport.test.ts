/**
 * editingViewport —— "进编辑态把节点拉进视野"的几何契约（纯函数，Node 直接跑）。
 *
 * 用户实测报的缺陷（原话）：「你的图片扩展也全是 BUG，UI 控制端口移动错误显示」。
 * 用真实鼠标事件实测到的根因：节点停在画布偏下的位置，扩展框往四周长大之后卡片底部
 * 跑到视口之外（实测卡片底 899px、视口只有 720px），下侧三个控制点在 elementFromPoint
 * 里返回 null —— 根本点不到。**控制点没画错，是被推出屏幕了**。
 *
 * 所以这里锁两条：看不见/看不全要判得出来、看得见时不要乱动视口。
 * 坐标一律 flow（node 与 visible 同一套），避免掺缩放造成误判。
 */
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_EDITING_MARGIN,
  resolveEditingViewport,
  shouldFitEditingViewport,
  type EditingViewportInput,
} from '../editingViewport'

/** 复现实测现场：节点在偏下位置、可视区 y∈[0,720]、缩放 1 */
function scene(over: Partial<EditingViewportInput> = {}): EditingViewportInput {
  return {
    node: { x: 500, y: 700, width: 400, height: 300 },
    visible: { x: 0, y: 0, width: 1280, height: 720 },
    zoom: 1,
    ...over,
  }
}

describe('resolveEditingViewport：算出该把视口放哪', () => {
  it('视口中心落在节点中心（居中，控制点离四边等距）', () => {
    const plan = resolveEditingViewport(scene())!
    expect(plan.centerX).toBe(500 + 400 / 2)
    expect(plan.centerY).toBe(700 + 300 / 2)
  })

  it('缩放按"节点 + 编辑余量"装进屏幕算，留出外扩空间', () => {
    const input = scene()
    const plan = resolveEditingViewport(input)!
    const needW = input.node.width * (1 + DEFAULT_EDITING_MARGIN * 2)
    const needH = input.node.height * (1 + DEFAULT_EDITING_MARGIN * 2)
    // 屏幕可视尺寸 = visible(flow) * zoom
    const screenW = input.visible.width * input.zoom
    const screenH = input.visible.height * input.zoom
    expect(plan.zoom).toBeCloseTo(Math.min(screenW / needW, screenH / needH), 6)
    expect(needW * plan.zoom).toBeLessThanOrEqual(screenW + 0.01)
    expect(needH * plan.zoom).toBeLessThanOrEqual(screenH + 0.01)
  })

  it('缩放被夹进 [minZoom, maxZoom]（小节点不会被放到超大）', () => {
    const tiny = scene({ node: { x: 0, y: 0, width: 40, height: 30 } })
    expect(resolveEditingViewport(tiny)!.zoom).toBeLessThanOrEqual(4)
    const huge = scene({ node: { x: 0, y: 0, width: 20000, height: 20000 } })
    expect(resolveEditingViewport(huge)!.zoom).toBeGreaterThanOrEqual(0.1)
  })

  it('margin 可配（0 = 不留余量）', () => {
    const input = scene({ margin: 0 })
    const plan = resolveEditingViewport(input)!
    expect(plan.zoom).toBeCloseTo(Math.min(1280 / 400, 720 / 300), 6)
  })

  it('尺寸非法（节点/可视区为 0 或 NaN）→ null，调用方保持原视口不动', () => {
    expect(resolveEditingViewport(scene({ node: { x: 0, y: 0, width: 0, height: 100 } }))).toBeNull()
    expect(resolveEditingViewport(scene({ node: { x: 0, y: 0, width: Number.NaN, height: 100 } }))).toBeNull()
    expect(resolveEditingViewport(scene({ visible: { x: 0, y: 0, width: 0, height: 720 } }))).toBeNull()
    expect(resolveEditingViewport(scene({ visible: { x: 0, y: 0, width: 1280, height: 0 } }))).toBeNull()
  })
})

describe('shouldFitEditingViewport：该不该动视口（"该动才动"）', () => {
  it('节点在可视区之外（偏下）→ true（实测现场就是这个形态）', () => {
    expect(shouldFitEditingViewport(scene())).toBe(true)
  })

  it('节点比可视区还大 → true（尺寸装不下）', () => {
    const big = scene({
      node: { x: 0, y: 0, width: 2000, height: 2000 },
      visible: { x: 0, y: 0, width: 800, height: 600 },
    })
    expect(shouldFitEditingViewport(big)).toBe(true)
  })

  it('节点在可视区内且装得下 → false（别把用户刚调好的视角拽走）', () => {
    const comfortable = scene({
      node: { x: 400, y: 300, width: 200, height: 150 },
      visible: { x: 0, y: 0, width: 1280, height: 720 },
    })
    expect(shouldFitEditingViewport(comfortable)).toBe(false)
  })

  it('节点贴边（含余量已越界）→ true（编辑框往外长就看不见了）', () => {
    // 节点本身在可视区内，但它就在右边缘 —— 含余量后已越界
    const atEdge = scene({
      node: { x: 1230, y: 300, width: 50, height: 100 },
      visible: { x: 0, y: 0, width: 1280, height: 720 },
    })
    expect(shouldFitEditingViewport(atEdge)).toBe(true)
  })

  it('可视区跟着视口平移（flow 坐标下同一节点在不同视野里结论不同）', () => {
    const n = { x: 500, y: 700, width: 200, height: 150 }
    // 视野已移到节点附近 → 看得见
    expect(
      shouldFitEditingViewport({
        node: n,
        visible: { x: 300, y: 500, width: 1280, height: 720 },
        zoom: 1,
      }),
    ).toBe(false)
    // 视野还在原点 → 看不见
    expect(
      shouldFitEditingViewport({
        node: n,
        visible: { x: 0, y: 0, width: 1280, height: 720 },
        zoom: 1,
      }),
    ).toBe(true)
  })

  it('尺寸非法 → false（信息不全时不瞎跳）', () => {
    expect(shouldFitEditingViewport(scene({ node: { x: 0, y: 0, width: 0, height: 0 } }))).toBe(false)
    expect(shouldFitEditingViewport(scene({ visible: { x: 0, y: 0, width: 0, height: 0 } }))).toBe(false)
  })
})

