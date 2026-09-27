/**
 * canvasFlowApi —— 有就绪状态的 Flow/DOM 能力（执行计划 T04）。
 *
 * 关键点：未就绪时**不降级**。旧 ViewportService 在后端缺席时返回默认坐标 / 原样回传，
 * 调用方分不清"没挂载"与"真的在那里"。这里逐条钉住"未就绪即抛、就绪即通、销毁即终"。
 */
import { describe, it, expect } from 'vitest'
import { createCanvasFlowController, CanvasFlowNotReadyError } from '../canvasFlowApi'
import type { ViewportBackend } from '../../viewport/viewportService'

function makeBackend(): ViewportBackend & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    getViewport: () => {
      calls.push('getViewport')
      return { x: 10, y: 20, zoom: 2 }
    },
    screenToFlow: (x, y) => {
      calls.push('screenToFlow')
      return { x: x / 2, y: y / 2 }
    },
    flowToScreen: (x, y) => {
      calls.push('flowToScreen')
      return { x: x * 2, y: y * 2 }
    },
    zoomIn: () => calls.push('zoomIn'),
    zoomOut: () => calls.push('zoomOut'),
    zoomTo: (l) => calls.push('zoomTo:' + l),
    fitView: (p) => calls.push('fitView:' + p),
    setCenter: (x, y, z) => calls.push('setCenter:' + x + ',' + y + ',' + z),
    setViewport: (v) => calls.push('setViewport:' + v.zoom),
    updateNodeVisual: (id) => calls.push('updateNodeVisual:' + id),
  }
}

describe('T04 · Flow 能力就绪状态', () => {
  it('detached：视口/坐标/DOM 调用一律抛 NotReady，不返回默认值', () => {
    const flow = createCanvasFlowController()
    expect(flow.phase()).toBe('detached')
    expect(flow.ready()).toBe(false)
    expect(flow.domReady()).toBe(false)

    expect(() => flow.viewportSnapshot()).toThrow(CanvasFlowNotReadyError)
    expect(() => flow.screenToFlow(1, 2)).toThrow(CanvasFlowNotReadyError)
    expect(() => flow.flowToScreen(1, 2)).toThrow(CanvasFlowNotReadyError)
    expect(() => flow.zoomIn()).toThrow(CanvasFlowNotReadyError)
    expect(() => flow.queryNodeEl('n1')).toThrow(CanvasFlowNotReadyError)
    // 错误里应写明阶段（调用方能看到为什么）
    try {
      flow.viewportSnapshot()
    } catch (err) {
      expect((err as CanvasFlowNotReadyError).phase).toBe('detached')
      expect((err as CanvasFlowNotReadyError).required).toBe('flow-ready')
    }
  })

  it('flow-ready：视口/坐标/节点视觉可用；DOM 查询仍抛（DOM 晚于实例）', () => {
    const flow = createCanvasFlowController()
    const backend = makeBackend()
    flow.attachFlow(backend)

    expect(flow.phase()).toBe('flow-ready')
    expect(flow.ready()).toBe(true)
    expect(flow.domReady()).toBe(false)

    expect(flow.viewportSnapshot()).toEqual({ x: 10, y: 20, zoom: 2 })
    expect(flow.screenToFlow(100, 100)).toEqual({ x: 50, y: 50 })
    expect(flow.flowToScreen(50, 50)).toEqual({ x: 100, y: 100 })
    flow.zoomTo(3)
    flow.fitView(0.2)
    expect(backend.calls).toEqual([
      'getViewport',
      'screenToFlow',
      'flowToScreen',
      'zoomTo:3',
      'fitView:0.2',
    ])

    // DOM 尚未捕获：仍抛，不回退 null 冒充成功
    expect(() => flow.queryNodeEl('n1')).toThrow(CanvasFlowNotReadyError)
    expect(() => flow.paneEl()).toThrow(CanvasFlowNotReadyError)
  })

  it('dom-ready：DOM 锚点可用，且保留 flow 能力', () => {
    const flow = createCanvasFlowController()
    const backend = makeBackend()
    const pane = { id: 'pane' } as unknown as HTMLElement
    flow.attachFlow(backend)
    flow.attachDom({
      rootEl: () => ({ id: 'root' }) as unknown as HTMLElement,
      rendererEl: () => ({ id: 'renderer' }) as unknown as HTMLElement,
      paneEl: () => pane,
      queryNodeEl: (nodeId) => ({ id: 'node-' + nodeId }) as unknown as HTMLElement,
    })

    expect(flow.phase()).toBe('dom-ready')
    expect(flow.domReady()).toBe(true)
    expect(flow.paneEl()).toBe(pane)
    expect(flow.queryNodeEl('a')?.id).toBe('node-a')
    // flow 能力没被 DOM 覆盖
    expect(flow.viewportSnapshot()).toEqual({ x: 10, y: 20, zoom: 2 })
  })

  it('dispose：终态，之后任何调用（含视口）都抛', () => {
    const flow = createCanvasFlowController()
    flow.attachFlow(makeBackend())
    flow.attachDom({
      rootEl: () => null,
      rendererEl: () => null,
      paneEl: () => null,
      queryNodeEl: () => null,
    })
    flow.dispose()
    expect(flow.phase()).toBe('disposed')
    expect(flow.ready()).toBe(false)
    expect(() => flow.viewportSnapshot()).toThrow(CanvasFlowNotReadyError)
    expect(() => flow.queryNodeEl('n1')).toThrow(CanvasFlowNotReadyError)
  })

  it('阶段推进幂等且只增不减；subscribe 在阶段变化时通知', () => {
    const flow = createCanvasFlowController()
    const seen: string[] = []
    flow.subscribe(() => seen.push(flow.phase()))
    flow.attachFlow(makeBackend())
    flow.attachFlow(makeBackend()) // 重复 attach 不再通知
    flow.attachDom({
      rootEl: () => null,
      rendererEl: () => null,
      paneEl: () => null,
      queryNodeEl: () => null,
    })
    expect(seen).toEqual(['flow-ready', 'dom-ready'])
  })

  it('updateNodeVisualSize 在 flow-ready 时把尺寸同步给节点视觉后端', () => {
    const flow = createCanvasFlowController()
    const calls: Array<{ op: string; id?: string }> = []
    flow.attachFlow(makeBackend())
    flow.attachNodeVisual({
      updateNode: (id) => calls.push({ op: 'updateNode', id }),
      updateNodeInternals: (ids) => calls.push({ op: 'internals', id: ids.join(',') }),
    })
    flow.updateNodeVisualSize('n1', 300, 200)
    expect(calls).toEqual([
      { op: 'updateNode', id: 'n1' },
      { op: 'internals', id: 'n1' },
    ])
  })
})
