/**
 * animateViewport —— 「聚焦取景要动画、跟手操作要即时」的契约守卫。
 *
 * 用户口径（2026-10-07）：「添加到画布时有聚焦动作，但聚焦太快了，没有动画效果」。
 * 早先 auto-layout 的聚焦走 setViewport（即时）—— 那条路必须即时，因为小地图拖拽/逐帧写视口
 * 会每帧重启补间而卡顿（老版实测）。所以这里单开一条带过渡的路，并钉住三件事：
 *   1. 有 animateViewport 后端时，聚焦走它（带时长）；
 *   2. 后端没实现这条（假后端/老装配）时，服务内部退回即时 setViewport，行为不退化；
 *   3. setViewport 自身**不受影响**，仍然即时（跟手场景不许被悄悄加上动画）。
 */
import { describe, it, expect } from 'vitest'
import { ViewportService } from '../viewportService'
import type { ViewportBackend } from '../viewportService'

function fakeBackend(): { backend: ViewportBackend; calls: string[]; viewports: Array<{ x: number; y: number; zoom: number }> } {
  const calls: string[] = []
  const viewports: Array<{ x: number; y: number; zoom: number }> = []
  const backend: ViewportBackend = {
    getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
    screenToFlow: (x, y) => ({ x, y }),
    flowToScreen: (x, y) => ({ x, y }),
    zoomIn: () => calls.push('zoomIn'),
    zoomOut: () => calls.push('zoomOut'),
    zoomTo: () => calls.push('zoomTo'),
    fitView: () => calls.push('fitView'),
    setCenter: () => calls.push('setCenter'),
    setViewport: (v) => { calls.push('setViewport'); viewports.push(v) },
  }
  return { backend, calls, viewports }
}

describe('animateViewport（聚焦带动画）', () => {
  it('后端实现了带过渡的路径 → 聚焦走它，并把时长传下去', () => {
    const { backend, calls, viewports } = fakeBackend()
    const anim: Array<{ v: { x: number; y: number; zoom: number }; d?: number }> = []
    backend.animateViewport = (v, d) => { calls.push('animateViewport'); anim.push({ v, d }) }
    const svc = new ViewportService(backend)

    svc.animateViewport({ x: 10, y: 20, zoom: 2 })

    expect(calls).toEqual(['animateViewport'])
    expect(anim[0].v).toEqual({ x: 10, y: 20, zoom: 2 })
    expect(anim[0].d).toBe(320)
    // 不能同时再写一次即时视口（两条路只走一条）
    expect(viewports).toHaveLength(0)
  })

  it('后端没实现这条（假后端/老装配）→ 退回即时 setViewport，行为不退化', () => {
    const { backend, calls, viewports } = fakeBackend()
    const svc = new ViewportService(backend)

    svc.animateViewport({ x: 3, y: 4, zoom: 1.5 })

    expect(calls).toEqual(['setViewport'])
    expect(viewports[0]).toEqual({ x: 3, y: 4, zoom: 1.5 })
  })

  it('setViewport 自己仍然是即时那条（跟手场景不许被加上动画）', () => {
    const { backend, calls } = fakeBackend()
    backend.animateViewport = () => calls.push('animateViewport')
    const svc = new ViewportService(backend)

    svc.setViewport({ x: 1, y: 1, zoom: 1 })

    expect(calls).toEqual(['setViewport'])
  })
})

