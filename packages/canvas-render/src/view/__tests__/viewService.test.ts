import { describe, expect, it, vi } from 'vitest'
import { ViewService } from '../viewService'
import { NodeLayoutService } from '../../layout/nodeLayout'
import { NodeStore } from '@mini-canvas/canvas-data'

describe('view · 几何与视口合体', () => {
  it('未 attach 后端时读默认 {0,0,1}，控制 no-op 不抛', () => {
    const v = new ViewService({ nodeStore: new NodeStore() })
    expect(v.getViewport()).toEqual({ x: 0, y: 0, zoom: 1 })
    expect(() => v.zoomIn()).not.toThrow()
    expect(() => v.setViewport({ x: 10, y: 10, zoom: 2 })).not.toThrow()
  })

  it('几何读口与 NodeLayoutService 逐字一致', () => {
    const store = new NodeStore()
    store.registerType({ type: 'note', label: '便签', defaultSize: { w: 300, h: 200 } })
    store.addNodes([{ type: 'note', position: { x: 12, y: 34 }, id: 'n1' }])
    const id = 'n1'
    const layout = new NodeLayoutService(store)
    const view = new ViewService({ nodeStore: store, layout })
    expect(view.nodeSize(id)).toEqual(layout.nodeSize(id))
    expect(view.absolutePosition(id)).toEqual(layout.absolutePosition(id))
    expect(view.getNodeRect(id)).toEqual(layout.getNodeRect(id))
  })

  it('setViewport 即时、animateViewport 走过渡', () => {
    const setViewport = vi.fn()
    const animate = vi.fn()
    const v = new ViewService({ nodeStore: new NodeStore() })
    v.attachBackend({
      getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
      screenToFlow: (x, y) => ({ x, y }),
      flowToScreen: (x, y) => ({ x, y }),
      zoomIn() {},
      zoomOut() {},
      zoomTo() {},
      fitView() {},
      setCenter() {},
      setViewport,
      animateViewport: animate,
    })
    v.setViewport({ x: 1, y: 2, zoom: 3 })
    expect(setViewport).toHaveBeenCalledTimes(1)
    v.animateViewport({ x: 4, y: 5, zoom: 1 })
    expect(animate).toHaveBeenCalledWith({ x: 4, y: 5, zoom: 1 }, 320)
  })

  it('内部写口仍能改实测尺寸（量测不能断）', () => {
    const store = new NodeStore()
    store.registerType({ type: 'note', label: '便签', defaultSize: { w: 300, h: 200 } })
    store.addNodes([{ type: 'note', position: { x: 0, y: 0 }, id: 'n1' }])
    const id = 'n1'
    const v = new ViewService({ nodeStore: store })
    v.setMeasuredSize(id, 200, 100)
    expect(v.nodeSize(id)).toEqual({ w: 200, h: 100 })
    v.clearMeasuredSize(id)
    expect(v.nodeSize(id)).not.toEqual({ w: 200, h: 100 })
  })

  it('fitTo 选中集合按 id 解析，空目标返回 false', () => {
    const store = new NodeStore()
    store.registerType({ type: 'note', label: '便签', defaultSize: { w: 300, h: 200 } })
    store.addNodes([{ type: 'note', position: { x: 0, y: 0 }, id: 'n1' }])
    const v = new ViewService({ nodeStore: store })
    expect(v.fitTo(['missing'])).toBe(false)
    expect(v.fitTo('selection')).toBe(false)
  })
})
