/**
 * useNodeMeasure 挂载冒烟 —— 验证 start/stop 的观察器配对与尺寸注入（无 DOM 环境，用最小 fake 对象）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NodeLayoutService } from '../../layout/nodeLayout'
import { NodeStore } from '@mini-canvas/canvas-core-v2'
import { useNodeMeasure } from '../useNodeMeasure'

class FakeRO {
  static instances: FakeRO[] = []
  cb: (entries: unknown[]) => void
  observed: unknown[] = []
  constructor(cb: (entries: unknown[]) => void) { this.cb = cb; FakeRO.instances.push(this) }
  observe(el: unknown) { this.observed.push(el) }
  unobserve() {}
  disconnect() {}
}

class FakeMO {
  static instances: FakeMO[] = []
  observed: Array<{ root: unknown; opts?: unknown }> = []
  constructor(_cb: () => void) { FakeMO.instances.push(this) }
  observe(root: unknown, opts?: unknown) { this.observed.push({ root, opts }) }
  disconnect() {}
}

function fakeNode(id: string, w: number, h: number) {
  return { dataset: { id }, offsetWidth: w, offsetHeight: h }
}

function makeStore() {
  const s = new NodeStore()
  s.registerType({ type: 'text', label: '文本', defaultSize: { w: 100, h: 40 } })
  return s
}

describe('useNodeMeasure 挂载冒烟（fake 观察器）', () => {
  beforeEach(() => {
    FakeRO.instances = []
    FakeMO.instances = []
    vi.stubGlobal('ResizeObserver', FakeRO)
    vi.stubGlobal('MutationObserver', FakeMO)
  })

  it('start 时容器就绪：MutationObserver observe + 节点被 ResizeObserver observe + 立即注入尺寸', () => {
    const store = makeStore()
    store.addNodes([{ type: 'text', position: { x: 0, y: 0 }, id: 'a' }])
    const layout = new NodeLayoutService(store)
    const nodeA = fakeNode('a', 320, 180)
    const root = { querySelectorAll: (sel: string) => (sel === '.vue-flow__node' ? [nodeA] : []) } as unknown as HTMLElement

    const m = useNodeMeasure({ nodeLayout: layout, container: () => root })
    m.start()

    expect(FakeMO.instances.length).toBe(1)
    expect(FakeMO.instances[0].observed[0].root).toBe(root)
    expect(FakeRO.instances[0].observed).toEqual([nodeA])
    expect(layout.getNodeRect('a')).toEqual({ id: 'a', x: 0, y: 0, w: 320, h: 180 })
    m.stop()
    // stop 后 nodeLayout 实测被 reset
    expect(layout.getNodeRect('a')!.w).toBe(100)
  })

  it('start 时容器为 null：不抛错、不 observe', () => {
    const store = makeStore()
    const layout = new NodeLayoutService(store)
    const m = useNodeMeasure({ nodeLayout: layout, container: () => null })
    expect(() => m.start()).not.toThrow()
    expect(FakeMO.instances[0].observed.length).toBe(0)
    expect(FakeRO.instances[0].observed.length).toBe(0)
    m.stop()
  })
})

describe('useNodeMeasure SSR/headless 守卫（P1-13）', () => {
  it('无 ResizeObserver/MutationObserver 时 start/stop 为 no-op，不抛错', () => {
    vi.stubGlobal('ResizeObserver', undefined)
    vi.stubGlobal('MutationObserver', undefined)
    const store = makeStore()
    const layout = new NodeLayoutService(store)
    const m = useNodeMeasure({ nodeLayout: layout, container: () => null })
    expect(() => m.start()).not.toThrow()
    expect(() => m.stop()).not.toThrow()
  })
})

