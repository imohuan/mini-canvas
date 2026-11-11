import { describe, expect, it, vi } from 'vitest'
import { Selection } from '@plume-canvas/canvas-data'
import { useCanvasNodeDrag } from '../canvas-host/useCanvasNodeDrag'

/**
 * 回归：选中 A 之后拖 B，松手时只把 A 的位置写回 store，B 被渲染投影拉回原位。
 *
 * 落盘依据必须是「本次手势实际拖动的节点」，而不是「VueFlow 当前选中的节点」。
 */
describe('useCanvasNodeDrag 松手落盘', () => {
  it('选中别的节点时，仍然写回本次被拖节点的新位置', () => {
    const selection = new Selection()
    selection.set(['2'])
    const updateNodes = vi.fn()
    const emit = vi.fn()

    const host = {
      selection,
      graph: { updateNodes },
      ctx: { emit },
      view: { absolutePosition: () => ({ x: 363, y: 515 }) },
    }
    const surface = {
      // 修复前这里会让落盘只写选中节点 2，漏掉真正被拖的 7
      getSelectedNodePositions: () => [{ id: '2', x: 660, y: 22 }],
    }

    const drag = useCanvasNodeDrag({
      hostRef: { value: host as never },
      surfaceRef: { value: surface as never },
      interaction: { activity: { value: {} } } as never,
      interactionSettings: { selectNodesOnDrag: false, elementsSelectable: true } as never,
      primeDragProtection: vi.fn(),
      clearDragProtection: vi.fn(),
    })

    const dragged = [
      { id: '7', position: { x: 255, y: 434 } },
      { id: '2', position: { x: 660, y: 22 } },
    ]
    drag.onNodeDragStart({ node: dragged[0], nodes: [dragged[0]] } as never)
    // VueFlow 会把本次拖动项的位置更新到最终位置再发 stop
    drag.onNodeDragStop({
      node: { id: '7', position: { x: 363, y: 515 } },
      nodes: [{ id: '7', position: { x: 363, y: 515 } }],
    } as never)

    expect(updateNodes).toHaveBeenCalledWith([
      { id: '7', patch: { position: { x: 363, y: 515 } } },
    ])
  })
})
