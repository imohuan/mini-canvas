/**
 * bindTypeResizeMode —— 「允许拖拽调整尺寸 / 拖拽方式」设置 → 类型表 resizable 的绑定契约。
 *
 * 用户口径（2026-10-30）：resizable 支持 boolean 和 string（true = 自由拖拽），
 * 设置面板改它要实时生效（与 bindTypeDefaultSize 同一条响应式链）。
 */
import { describe, it, expect } from 'vitest'
import { Context } from '@mini-canvas/canvas-data'
import { NodeStore, EdgeStore, Selection, History, GraphDocument, createDocService } from '@mini-canvas/canvas-data'
import { SettingsStore } from '@mini-canvas/kernel'
import { bindTypeResizeMode } from '../bindTypeDefaultSize'

function boot(config: Record<string, unknown> = {}) {
  const ctx = new Context()
  const nodeStore = new NodeStore()
  const edgeStore = new EdgeStore()
  const selection = new Selection()
  const history = new History({
    snapshot: () => ({ nodes: JSON.parse(JSON.stringify(nodeStore.getNodes())), edges: JSON.parse(JSON.stringify(edgeStore.getEdges())) }),
    restore: (g: { nodes: unknown[]; edges: unknown[] }) => { nodeStore.replaceAll(g.nodes as never); edgeStore.replaceAll(g.edges as never) },
  })
  ctx.inject('doc', createDocService({ nodeStore, edgeStore, graph: new GraphDocument(nodeStore, edgeStore, selection, history), history }))
  nodeStore.registerType({ type: 'demo', label: '演示', defaultSize: { w: 10, h: 10 }, resizable: true })

  // settings 是画布能力层的内置服务，内核取服务时内置优先于 inject：
  // 直接用 ctx 自带的那份（真宿主同一条数据源），注入会被遮蔽。
  const store = ctx.get<SettingsStore>('settings')
  store.define('测试', {
    demoResizeMode: { type: 'select', default: 'aspect', options: [
      { value: 'aspect', label: '等比例' },
      { value: 'free', label: '自由' },
      { value: 'width', label: '只宽' },
      { value: 'height', label: '只高' },
    ] },
    demoResizeEnabled: { type: 'boolean', default: true },
  }, 'test')
  return { ctx, nodeStore, store }
}

describe('bindTypeResizeMode：设置 → 类型表 resizable（实时）', () => {
  it('首次绑定：设置读不到 → 用 fallback（aspect）', () => {
    const { ctx, nodeStore } = boot()
    bindTypeResizeMode(ctx, 'demo', 'demoResizeMode', 'demoResizeEnabled', 'aspect')
    expect(nodeStore.types.get('demo')?.resizable).toBe('aspect')
  })

  it('改方式 select → 类型表立即变（aspect/free/width/height → boolean|枚举）', () => {
    const { ctx, nodeStore, store } = boot()
    bindTypeResizeMode(ctx, 'demo', 'demoResizeMode', 'demoResizeEnabled', 'aspect')
    store.set('demoResizeMode', 'width')
    expect(nodeStore.types.get('demo')?.resizable).toBe('width')
    store.set('demoResizeMode', 'free')
    expect(nodeStore.types.get('demo')?.resizable).toBe(true)
    store.set('demoResizeMode', 'aspect')
    expect(nodeStore.types.get('demo')?.resizable).toBe('aspect')
    store.set('demoResizeMode', 'height')
    expect(nodeStore.types.get('demo')?.resizable).toBe('height')
  })

  it('开关关闭 → false（无论方式是什么）；重开回到方式', () => {
    const { ctx, nodeStore, store } = boot()
    bindTypeResizeMode(ctx, 'demo', 'demoResizeMode', 'demoResizeEnabled', 'aspect')
    store.set('demoResizeEnabled', false)
    expect(nodeStore.types.get('demo')?.resizable).toBe(false)
    store.set('demoResizeEnabled', true)
    expect(nodeStore.types.get('demo')?.resizable).toBe('aspect')
  })

  it('未知类型 no-op；坏值回落 fallback，不改坏类型表', () => {
    const { ctx, nodeStore, store } = boot()
    bindTypeResizeMode(ctx, 'demo', 'demoResizeMode', 'demoResizeEnabled', 'aspect')
    store.set('demoResizeMode', 'garbage')
    expect(nodeStore.types.get('demo')?.resizable).toBe('aspect')
  })
})
