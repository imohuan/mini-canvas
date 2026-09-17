/**
 * fitEditingNodeIntoView —— "取服务 → 算几何 → 调 setCenter"这段接线的契约（Node 直接跑）。
 *
 * 为什么要测这段薄接线：几何（editingViewport）算对、接线接错，用户看到的依旧是坏行为 ——
 * 这正是本项目反复踩的坑（"纯函数绿 ≠ 链路通"）。这里用假服务把三件事钉住：
 * 装不下要真的调 setCenter、装得下不许调、缺服务时安静跳过。
 */
import { describe, it, expect } from 'vitest'
import { fitEditingNodeIntoView, type ServiceGetter } from '../fitEditingNode'

/** 假宿主：按名字给服务；把 setCenter 的调用记下来 */
function makeCtx(opts: {
  rect?: { x: number; y: number; w: number; h: number } | null
  zoom?: number
  /** 视口平移（flow；换算后可视区左上角 = -t/zoom） */
  tx?: number
  ty?: number
  pane?: { w: number; h: number } | null
  withLayout?: boolean
  withViewport?: boolean
} = {}) {
  const calls: Array<{ x: number; y: number; zoom?: number }> = []
  const services: Record<string, unknown> = {}
  if (opts.withLayout !== false) {
    services.nodeLayout = { getNodeRect: () => opts.rect ?? null }
  }
  if (opts.withViewport !== false) {
    services.viewport = {
      getViewport: () => ({ x: opts.tx ?? 0, y: opts.ty ?? 0, zoom: opts.zoom ?? 1 }),
      setCenter: (x: number, y: number, zoom?: number) => calls.push({ x, y, zoom }),
      getPaneEl: () =>
        opts.pane === null
          ? null
          : ({ clientWidth: opts.pane?.w ?? 1280, clientHeight: opts.pane?.h ?? 720 } as unknown as HTMLElement),
    }
  }
  const ctx: ServiceGetter = { get: ((name: string) => services[name]) as <T>() => T }
  return { ctx, calls }
}

describe('fitEditingNodeIntoView', () => {
  it('装不下 → 调一次 setCenter，中心落在节点中心', () => {
    // 实测现场：节点在 y=700、可视区只有 720 高 → 必须拉
    const { ctx, calls } = makeCtx({ rect: { x: 500, y: 700, w: 400, h: 300 } })
    expect(fitEditingNodeIntoView(ctx, 'n1')).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0].x).toBe(700)
    expect(calls[0].y).toBe(850)
    expect(calls[0].zoom).toBeGreaterThan(0)
  })

  it('装得下 → 一次都不调（别把用户刚调好的视角拽走）', () => {
    const { ctx, calls } = makeCtx({ rect: { x: 400, y: 300, w: 200, h: 150 } })
    expect(fitEditingNodeIntoView(ctx, 'n1')).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('缺 nodeLayout / 缺 viewport / 节点不存在 → 安静跳过，不抛', () => {
    expect(fitEditingNodeIntoView(makeCtx({ withLayout: false }).ctx, 'n1')).toBe(false)
    expect(fitEditingNodeIntoView(makeCtx({ withViewport: false }).ctx, 'n1')).toBe(false)
    expect(fitEditingNodeIntoView(makeCtx({ rect: null }).ctx, 'n1')).toBe(false)
    expect(fitEditingNodeIntoView({ get: (() => undefined) as <T>() => T }, 'n1')).toBe(false)
  })

  it('量不到可视区（pane 为 0）→ 跳过，不瞎跳', () => {
    const { ctx, calls } = makeCtx({ rect: { x: 500, y: 700, w: 400, h: 300 }, pane: { w: 0, h: 0 } })
    expect(fitEditingNodeIntoView(ctx, 'n1')).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('缩放很大（画布被放大）时也判为需要调整（用当前缩放判断，不是目标缩放）', () => {
    const { ctx, calls } = makeCtx({
      rect: { x: 0, y: 0, w: 200, h: 150 },
      zoom: 5,
      pane: { w: 400, h: 300 },
    })
    expect(fitEditingNodeIntoView(ctx, 'n1')).toBe(true)
    expect(calls).toHaveLength(1)
  })

  it('视野已经移到节点附近（视口平移过）→ 不调（看得见就不动）', () => {
    // 视口平移到 (-600,-1000) → 可视区 flow = x∈[600,1880]、y∈[1000,1720]。
    // 节点 (800,1150,200,150) 含 60% 余量（±120/±90）后仍在其中 → 不该动。
    const { ctx, calls } = makeCtx({ rect: { x: 800, y: 1150, w: 200, h: 150 }, tx: -600, ty: -1000 })
    expect(fitEditingNodeIntoView(ctx, 'n1')).toBe(false)
    expect(calls).toHaveLength(0)
  })
})
