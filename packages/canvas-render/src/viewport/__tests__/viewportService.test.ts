import { describe, it, expect, vi } from 'vitest'
import { ViewportService, type ViewportBackend, type ViewportState } from '../viewportService'

function makeBackend(): ViewportBackend & { calls: string[] } {
  const calls: string[] = []
  const b: ViewportBackend & { calls: string[] } = {
    calls,
    getViewport: () => { calls.push('getViewport'); return { x: 100, y: 200, zoom: 1.5 } },
    screenToFlow: (x, y) => { calls.push('screenToFlow'); return { x: (x - 100) / 1.5, y: (y - 200) / 1.5 } },
    flowToScreen: (x, y) => { calls.push('flowToScreen'); return { x: x * 1.5 + 100, y: y * 1.5 + 200 } },
    zoomIn: () => { calls.push('zoomIn') },
    zoomOut: () => { calls.push('zoomOut') },
    zoomTo: (l) => { calls.push('zoomTo:' + l) },
    fitView: (p) => { calls.push('fitView:' + p) },
    setCenter: (x, y, z) => { calls.push('setCenter:' + x + ',' + y + ',' + z) },
    setViewport: (v) => { calls.push('setViewport:' + v.x + ',' + v.y + ',' + v.zoom) },
  }
  return b
}

describe('ViewportService 视口服务', () => {
  it('读视口透传后端', () => {
    const b = makeBackend()
    const s = new ViewportService(b)
    expect(s.getViewport()).toEqual({ x: 100, y: 200, zoom: 1.5 })
    expect(b.calls).toContain('getViewport')
  })

  it('screen-flow 双向换算透传后端', () => {
    const b = makeBackend()
    const s = new ViewportService(b)
    expect(s.screenToFlow(250, 350)).toEqual({ x: 100, y: 100 })
    expect(s.flowToScreen(100, 100)).toEqual({ x: 250, y: 350 })
  })

  it('缩放/适配/定位命令透传后端', () => {
    const b = makeBackend()
    const s = new ViewportService(b)
    s.zoomIn(); s.zoomOut(); s.zoomTo(2)
    s.fitView()
    s.fitView(0.2)
    s.setCenter(5, 6)
    s.setCenter(5, 6, 2)
    s.setViewport({ x: 1, y: 2, zoom: 3 })
    expect(b.calls).toEqual([
      'zoomIn', 'zoomOut', 'zoomTo:2',
      'fitView:0.1', 'fitView:0.2',
      'setCenter:5,6,undefined', 'setCenter:5,6,2',
      'setViewport:1,2,3',
    ])
  })
})





  it('无 backend 时 no-op；attachBackend 后生效', () => {
    const s = new ViewportService()
    // 未挂载：不抛，读视口回落默认
    expect(s.getViewport()).toEqual({ x: 0, y: 0, zoom: 1 })
    expect(() => s.zoomIn()).not.toThrow()
    // attach 后生效
    const b = makeBackend()
    s.attachBackend(b)
    s.zoomIn()
    expect(b.calls).toContain('zoomIn')
    expect(s.getViewport()).toEqual({ x: 100, y: 200, zoom: 1.5 })
  })

