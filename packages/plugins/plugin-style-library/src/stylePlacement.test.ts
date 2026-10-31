/**
 * 「加入画布」的落点与聚焦（用户口径 2026-10-25）。
 *
 * 现场：画布有缩放/平移，但素材节点总落在固定的 flow 坐标 ——
 * 用户平移到别处之后，新节点出现在视野外，看不到、也不会自动选中。
 *
 * 要求：
 *   1. 按**当前视口中心**（屏幕中心换算成 flow 坐标）落节点；
 *   2. 落完自动**选中**并聚焦（保持当前缩放，不打断用户视野）；
 *   3. 任何一环拿不到（未挂载 / 极简宿主）→ 退回旧行为，不抛错。
 */
import { describe, it, expect, vi } from 'vitest'
import { stylePlacementOf, focusStyleNode } from './stylePlacement'

describe('stylePlacementOf：按视口中心算落点', () => {
  it('屏幕中心换算成 flow 坐标，并扣掉节点尺寸的一半（让节点中心对齐视口中心）', () => {
    const screenToFlow = vi.fn((x: number, y: number) => ({ x: (x - 100) / 2, y: (y - 50) / 2 }))
    const p = stylePlacementOf({
      screenToFlow,
      paneRect: { left: 100, top: 50, width: 800, height: 600 },
      nodeSize: { w: 320, h: 240 },
    })
    // 屏幕中心 = (500, 350) → flow (200, 150)；扣半尺寸 → (40, 30)
    expect(screenToFlow).toHaveBeenCalledWith(500, 350)
    expect(p).toEqual({ x: 40, y: 30 })
  })

  it('没有 paneRect / 没有 screenToFlow → undefined（调用方退回旧行为）', () => {
    expect(stylePlacementOf({ screenToFlow: () => ({ x: 0, y: 0 }) })).toBeUndefined()
    expect(
      stylePlacementOf({ paneRect: { left: 0, top: 0, width: 100, height: 100 } }),
    ).toBeUndefined()
  })

  it('screenToFlow 抛错（未挂载）→ undefined，不把异常抛给面板', () => {
    const p = stylePlacementOf({
      screenToFlow: () => {
        throw new Error('not ready')
      },
      paneRect: { left: 0, top: 0, width: 800, height: 600 },
    })
    expect(p).toBeUndefined()
  })
})

describe('focusStyleNode：选中 + 聚焦', () => {
  it('先选中、再走 view.fitTo（保留缩放）', () => {
    const selection = { set: vi.fn(), clearEdges: vi.fn() }
    const view = { fitTo: vi.fn(() => true) }

    focusStyleNode({ selection, view } as never, 'n1')

    expect(selection.set).toHaveBeenCalledWith(['n1'])
    expect(selection.clearEdges).toHaveBeenCalled()
    expect(view.fitTo).toHaveBeenCalledWith(['n1'], { keepZoom: true, select: true })
  })

  it('直接点选时由 fitTo 负责居中（不自己算坐标）', () => {
    // 旧实现自己 setCenter(260,320,1.5)；现在只传目标与保留缩放，
    // 居中/夹取/过渡全在 fitTo 内，避免两套坐标算法漂移。
    const selection = { set: vi.fn(), clearEdges: vi.fn() }
    const view = { fitTo: vi.fn(() => true) }
    focusStyleNode({ selection, view } as never, 'n1')
    expect(view.fitTo).toHaveBeenCalledTimes(1)
    expect(view.fitTo.mock.calls[0][1]).toEqual({ keepZoom: true, select: true })
  })

  it('fitTo 返回 false（节点不存在）→ 不抛错，选中照旧', () => {
    const selection = { set: vi.fn(), clearEdges: vi.fn() }
    const view = { fitTo: vi.fn(() => false) }
    expect(() => focusStyleNode({ selection, view } as never, 'n1')).not.toThrow()
    expect(selection.set).toHaveBeenCalledWith(['n1'])
  })

  it('服务缺失（极简宿主）→ 不抛错，能做的照做', () => {
    expect(() => focusStyleNode({} as never, 'n1')).not.toThrow()

    const selection = { set: vi.fn(), clearEdges: vi.fn() }
    focusStyleNode({ selection } as never, 'n1')
    expect(selection.set).toHaveBeenCalledWith(['n1'])
  })
})
