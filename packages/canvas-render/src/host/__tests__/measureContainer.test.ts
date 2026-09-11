/**
 * 节点量测容器解析 —— 回归测试（线上 bug：resize 过的节点尺寸没进布局）。
 *
 * 现象（用户在 http://localhost:5288 目验 + CDP 实测确认）：
 *   text 节点被右下角 resize 拖成 ~1150×451（data.cardWidth/cardHeight 已存对，DOM 也渲染对了），
 *   但自动布局仍按 text 类型 defaultSize 300×200 计算 —— 布局读到的尺寸是错的。
 *
 * 根因：CanvasSurface 拿 `.vue-flow__renderer` 当量测容器，而 Vue Flow 1.48 起 DOM 里**没有**这个
 *   类名（dist 中只有 viewport/transformationpane/pane/nodes/edges）。
 *   querySelector 恒为 null → useNodeMeasure 拿到 null 容器直接 return，从不 observe →
 *   NodeLayoutService 永远收不到实测尺寸 → nodeSize() 回落到 node.size ?? type.defaultSize。
 *
 * 本测试把「容器解析」这个接缝钉死：容器必须非空、且能覆盖到 .vue-flow__node。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NodeLayoutService } from '../../layout/nodeLayout'
import { NodeStore } from '@mini-canvas/canvas-core-v2'
import { useNodeMeasure, resolveMeasureContainer } from '../useNodeMeasure'

class FakeRO {
  static instances: FakeRO[] = []
  observed: unknown[] = []
  constructor(_cb: (entries: unknown[]) => void) { FakeRO.instances.push(this) }
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

/**
 * 仿 Vue Flow 1.48 的真实 DOM 结构：有 viewport / transformationpane / pane / nodes，
 * **没有 renderer**（这正是线上踩空的类名）。
 */
function makeVueFlow148Dom(nodeEls: Array<ReturnType<typeof fakeNode>>) {
  const layers: Record<string, { querySelectorAll: (sel: string) => unknown[] }> = {
    '.vue-flow__nodes': { querySelectorAll: (sel) => (sel === '.vue-flow__node' ? nodeEls : []) },
    '.vue-flow__viewport': { querySelectorAll: (sel) => (sel === '.vue-flow__node' ? nodeEls : []) },
    '.vue-flow__pane': { querySelectorAll: (sel) => (sel === '.vue-flow__node' ? nodeEls : []) },
  }
  const root = {
    className: 'csurface',
    querySelector: (sel: string) => layers[sel] ?? null, // .vue-flow__renderer → null
    querySelectorAll: (sel: string) => (sel === '.vue-flow__node' ? nodeEls : []),
  }
  return root as unknown as HTMLElement
}

function makeStore() {
  const s = new NodeStore()
  s.registerType({ type: 'text', label: '文本', defaultSize: { w: 300, h: 200 } })
  return s
}

describe('量测容器解析（Vue Flow 1.48 无 .vue-flow__renderer）', () => {
  beforeEach(() => {
    FakeRO.instances = []
    FakeMO.instances = []
    vi.stubGlobal('ResizeObserver', FakeRO)
    vi.stubGlobal('MutationObserver', FakeMO)
  })

  it('复现根因：旧选择器 .vue-flow__renderer 在 1.48 下解析为 null', () => {
    const root = makeVueFlow148Dom([fakeNode('1', 1150, 451)])
    // 旧写法：querySelector('.vue-flow__renderer') ?? null —— 恒为 null，容器为空
    const legacy = (root as unknown as { querySelector(s: string): unknown }).querySelector('.vue-flow__renderer') ?? null
    expect(legacy).toBeNull()
  })

  it('解析出的容器非空，且能覆盖到 .vue-flow__node', () => {
    const root = makeVueFlow148Dom([fakeNode('1', 1150, 451)])
    const container = resolveMeasureContainer(root)
    expect(container).not.toBeNull()
    expect(container!.querySelectorAll('.vue-flow__node').length).toBe(1)
  })

  it('实测尺寸真的注入 nodeLayout（resize 后的 1150×451 不再是默认 300×200）', () => {
    const store = makeStore()
    store.addNodes([{ type: 'text', position: { x: 0, y: 0 }, id: '1', data: { cardWidth: 1150, cardHeight: 451 } }])
    const layout = new NodeLayoutService(store)
    const root = makeVueFlow148Dom([fakeNode('1', 1150, 451)])

    const m = useNodeMeasure({ nodeLayout: layout, container: () => resolveMeasureContainer(root) })
    m.start()

    expect(layout.nodeSize('1')).toEqual({ w: 1150, h: 451 })
    // 修复前这里会是类型默认 300×200（容器 null → 从不 observe → 回落到 defaultSize）
    expect(layout.nodeSize('1').w).not.toBe(300)
    m.stop()
  })

  it('容器为 null（SSR / 未挂载）时安全 no-op', () => {
    expect(resolveMeasureContainer(null)).toBeNull()
    const store = makeStore()
    const layout = new NodeLayoutService(store)
    const m = useNodeMeasure({ nodeLayout: layout, container: () => resolveMeasureContainer(null) })
    expect(() => m.start()).not.toThrow()
    expect(FakeRO.instances[0]?.observed.length ?? 0).toBe(0)
    m.stop()
  })
})
