/**
 * paneSize 观测 —— 窗口/容器尺寸变化后必须重新量 pane（2026-10-17 可视区不跟随 resize 的根因）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePaneSizeObserver } from '../paneSize'

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = []
  observed: unknown[] = []
  disconnected = false
  constructor(public cb: (entries: unknown[]) => void) {
    FakeResizeObserver.instances.push(this)
  }
  observe(el: unknown) {
    this.observed.push(el)
  }
  unobserve() {}
  disconnect() {
    this.disconnected = true
  }
}

function fakePane(width: number, height: number) {
  return {
    width,
    height,
    getBoundingClientRect: () => ({ x: 0, y: 0, width, height, top: 0, left: 0, right: width, bottom: height }) as DOMRect,
  } as unknown as HTMLElement
}

afterEach(() => {
  FakeResizeObserver.instances = []
  vi.unstubAllGlobals()
})

describe('usePaneSizeObserver —— pane 尺寸跟随容器变化', () => {
  it('observe 时立即量一次，并挂上 ResizeObserver', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    const seen: number[] = []
    const o = usePaneSizeObserver((r) => seen.push(r ? r.width : -1))
    const pane = fakePane(800, 600)
    o.observe(pane)

    expect(FakeResizeObserver.instances.length).toBe(1)
    expect(FakeResizeObserver.instances[0].observed).toEqual([pane])
    expect(seen).toEqual([800])
  })

  it('容器 resize（窗口变大/变小）后回调新尺寸 —— 这正是以前漏掉的刷新', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    const seen: number[] = []
    const o = usePaneSizeObserver((r) => seen.push(r ? r.width : -1))
    let w = 800
    const pane = {
      getBoundingClientRect: () => ({ width: w, height: 600 }) as DOMRect,
    } as unknown as HTMLElement
    o.observe(pane)

    w = 1200
    FakeResizeObserver.instances[0].cb([])
    expect(seen).toEqual([800, 1200])
  })

  it('尺寸没变不重复上报（避免每帧无意义重算）', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    const seen: number[] = []
    const o = usePaneSizeObserver((r) => seen.push(r ? r.width : -1))
    o.observe(fakePane(800, 600))
    FakeResizeObserver.instances[0].cb([])
    expect(seen).toEqual([800])
  })

  it('换 pane 元素（插件重挂整树）时改为观测新元素，旧观测断开', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    const seen: number[] = []
    const o = usePaneSizeObserver((r) => seen.push(r ? r.width : -1))
    o.observe(fakePane(800, 600))
    const old = FakeResizeObserver.instances[0]
    o.observe(fakePane(1024, 768))

    expect(old.disconnected).toBe(true)
    const fresh = FakeResizeObserver.instances[1]
    expect(fresh.observed.length).toBe(1)
    expect(seen).toEqual([800, 1024])
  })

  it('没有 ResizeObserver 时退回 window resize 监听（老浏览器兜底）', () => {
    vi.stubGlobal('ResizeObserver', undefined)
    const handlers = new Map<string, Set<() => void>>()
    vi.stubGlobal('window', {
      addEventListener: (type: string, fn: () => void) => {
        if (!handlers.has(type)) handlers.set(type, new Set())
        handlers.get(type)!.add(fn)
      },
      removeEventListener: (type: string, fn: () => void) => {
        handlers.get(type)?.delete(fn)
      },
    })
    const seen: number[] = []
    const o = usePaneSizeObserver((r) => seen.push(r ? r.width : -1))
    let w = 800
    const pane = { getBoundingClientRect: () => ({ width: w, height: 600 }) as DOMRect } as unknown as HTMLElement
    o.observe(pane)

    w = 1100
    for (const fn of handlers.get('resize') ?? []) fn()
    expect(seen).toEqual([800, 1100])

    o.stop()
    expect(handlers.get('resize')?.size ?? 0).toBe(0)
  })

  it('stop() 后断开观测、不再上报', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    const seen: number[] = []
    const o = usePaneSizeObserver((r) => seen.push(r ? r.width : -1))
    o.observe(fakePane(800, 600))
    const ro = FakeResizeObserver.instances[0]
    o.stop()
    expect(ro.disconnected).toBe(true)
    ro.cb([])
    expect(seen).toEqual([800])
  })

  it('pane 不可用 → 回调 null（宿主退回安全兜底，不按旧尺寸乱剔）', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    const seen: Array<number | null> = []
    const o = usePaneSizeObserver((r) => seen.push(r ? r.width : null))
    o.observe(null)
    expect(seen).toEqual([null])
  })
})
