import { describe, expect, it, vi } from 'vitest'
import { ViewService, STARTUP_FOCUS_PADDING } from '../viewService'
import { NodeLayoutService } from '../../layout/nodeLayout'
import { NodeStore } from '@plume-canvas/canvas-data'

/** 假视口后端：小地图/取景这类"程序化定位"走 setViewport（即时），并记录每次写值 */
function makeBackend(over: Partial<Parameters<ViewService['attachBackend']>[0]> = {}) {
  const writes: Array<{ x: number; y: number; zoom: number }> = []
  let state = { x: 0, y: 0, zoom: 1 }
  const backend = {
    getViewport: () => ({ ...state }),
    screenToFlow: (x: number, y: number) => ({ x, y }),
    flowToScreen: (x: number, y: number) => ({ x, y }),
    zoomIn() {},
    zoomOut() {},
    zoomTo() {},
    fitView() {},
    setCenter() {},
    setViewport: (v: { x: number; y: number; zoom: number }) => {
      writes.push({ ...v })
      state = { ...v }
    },
    getRootEl: () => null,
    ...over,
  }
  return { backend, writes }
}

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

  /**
   * 尺寸唯一来源是 node.size。实测写口保留（量测链路不断），但不再覆盖读口。
   */
  it('实测写口只记录，不覆盖 node.size', () => {
    const store = new NodeStore()
    store.registerType({ type: 'note', label: '便签', defaultSize: { w: 300, h: 200 } })
    store.addNodes([{ type: 'note', position: { x: 0, y: 0 }, id: 'n1' }])
    const id = 'n1'
    const v = new ViewService({ nodeStore: store })
    v.setMeasuredSize(id, 200, 100)
    expect(v.nodeSize(id)).toEqual({ w: 300, h: 200 })
    v.clearMeasuredSize(id)
    expect(v.nodeSize(id)).toEqual({ w: 300, h: 200 })
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

/**
 * focusAll —— 启动 / 云端整包覆盖本地之后的标准取景。
 *
 * 用户 2026-11-16：打开画布时要「全部节点都在画面里」，且启动只聚焦一次 ——
 * 本地恢复与云端恢复不能再各写一次视口。这里守住三件事：
 *   ① 有节点时按全部节点取景（不做补间、四周留白、避开界面条、算上节点标题条）；
 *   ② 空画布 / 节点尺寸还是 0 时不动视口（否则会把缩放算成极小值）；
 *   ③ 视口后端还没挂上时先记着，挂上后自动补做一次。
 */
describe('view · 全部节点取景（focusAll）', () => {
  function makeStore(): NodeStore {
    const s = new NodeStore()
    s.registerType({ type: 'note', label: '便签', defaultSize: { w: 300, h: 200 } })
    s.addNodes([
      { type: 'note', position: { x: 0, y: 0 }, id: 'a' },
      { type: 'note', position: { x: 900, y: 700 }, id: 'b' },
    ])
    return s
  }

  it('启动取景参数：留白 48px、避开上下界面条、算上节点标题条、不做补间', () => {
    expect(STARTUP_FOCUS_PADDING).toBe(48)
    const store = makeStore()
    const v = new ViewService({ nodeStore: store })
    const fit = vi.spyOn(v, 'fitTo')
    const { backend } = makeBackend()
    v.attachBackend(backend)
    expect(v.focusAll()).toBe(true)
    expect(fit).toHaveBeenCalledWith(['a', 'b'], {
      padding: 48,
      includeBars: 'both',
      includeNodeTopBar: true,
      animate: false,
    })
  })

  it('把全部节点框进视口：两张卡片都在写出的视口范围内', () => {
    const store = makeStore()
    const v = new ViewService({ nodeStore: store })
    // 假根 DOM：1200×800（真实宿主量的是画布容器尺寸）
    const { backend, writes } = makeBackend({
      getRootEl: () =>
        ({
          clientWidth: 1200,
          clientHeight: 800,
          // 节点标题条量测：真实 DOM 一定有 querySelectorAll；假根返回空表 = 「量不到标签条」
          querySelectorAll: () => [],
        }) as unknown as HTMLElement,
    })
    v.attachBackend(backend)
    v.focusAll()
    const vp = writes.at(-1)!
    // 两张卡片的包围盒 = (0,0)-(1200,900)（b 的 300×200 从 900,700 起）
    // 取景后屏幕坐标 = flow × zoom + 平移；四角必须都落在 1200×800 里
    const sx1 = 0 * vp.zoom + vp.x
    const sy1 = 0 * vp.zoom + vp.y
    const sx2 = 1200 * vp.zoom + vp.x
    const sy2 = 900 * vp.zoom + vp.y
    expect(sx1).toBeGreaterThanOrEqual(0)
    expect(sy1).toBeGreaterThanOrEqual(0)
    expect(sx2).toBeLessThanOrEqual(1200)
    expect(sy2).toBeLessThanOrEqual(800)
    // 内容确实铺开了（没有缩成一小团）
    expect(vp.zoom).toBeGreaterThan(0.2)
  })

  it('空画布 → 不动视口、返回 false', () => {
    const v = new ViewService({ nodeStore: new NodeStore() })
    const { backend, writes } = makeBackend()
    v.attachBackend(backend)
    expect(v.focusAll()).toBe(false)
    expect(writes).toEqual([])
  })

  it('节点尺寸还是 0（类型没注册 / 量测未就绪）→ 不取景，不把画面缩没', () => {
    const store = new NodeStore()
    // 注册了类型但没有默认尺寸、节点也没 size：矩形 w/h 都是 0
    store.registerType({ type: 'ghost', label: '未量测', defaultSize: { w: 0, h: 0 } })
    store.addNodes([{ type: 'ghost', position: { x: 0, y: 0 }, id: 'g' }])
    const v = new ViewService({ nodeStore: store })
    const { backend, writes } = makeBackend()
    v.attachBackend(backend)
    expect(v.focusAll()).toBe(false)
    expect(writes).toEqual([])
  })


  it('调用方可以覆盖参数（例如只平移），默认值不丢', () => {
    const store = makeStore()
    const v = new ViewService({ nodeStore: store })
    const fit = vi.spyOn(v, 'fitTo')
    const { backend } = makeBackend()
    v.attachBackend(backend)
    v.focusAll({ keepZoom: true })
    expect(fit).toHaveBeenCalledWith(['a', 'b'], {
      padding: 48,
      includeBars: 'both',
      includeNodeTopBar: true,
      animate: false,
      keepZoom: true,
    })
  })

  /**
   * 首帧取景的正式路径：**只算不写**。
   *
   * 画布挂载前没有 DOM 可量，所以容器尺寸由调用方给；结果交给 VueFlow 作为 defaultViewport。
   * 这条路径必须不产生任何 setViewport —— 有写入就说明又回到了「先渲染再校正」。
   */
  it('solveStartupViewport：按给定容器尺寸算出构图，且不写视口', () => {
    const store = makeStore()
    const v = new ViewService({ nodeStore: store })
    const { backend, writes } = makeBackend()
    v.attachBackend(backend)
    const plan = v.solveStartupViewport({ w: 1200, h: 800 })
    expect(plan).toBeDefined()
    expect(writes).toEqual([])
    // 两张卡片包围盒 (0,0)-(1200,900)，取景后四角都落在 1200×800 内
    const x1 = plan!.x
    const y1 = plan!.y
    const x2 = 1200 * plan!.zoom + plan!.x
    const y2 = 900 * plan!.zoom + plan!.y
    expect(x1).toBeGreaterThanOrEqual(0)
    expect(y1).toBeGreaterThanOrEqual(0)
    expect(x2).toBeLessThanOrEqual(1200)
    expect(y2).toBeLessThanOrEqual(800)
  })

  it('solveStartupViewport：空画布 / 没尺寸时返回 undefined（调用方用默认视口）', () => {
    const empty = new ViewService({ nodeStore: new NodeStore() })
    expect(empty.solveStartupViewport({ w: 1200, h: 800 })).toBeUndefined()

    const store = new NodeStore()
    store.registerType({ type: 'ghost', label: '未量测', defaultSize: { w: 0, h: 0 } })
    store.addNodes([{ type: 'ghost', position: { x: 0, y: 0 }, id: 'g' }])
    expect(new ViewService({ nodeStore: store }).solveStartupViewport({ w: 1200, h: 800 })).toBeUndefined()
  })
})
