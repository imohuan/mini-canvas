/**
 * BaseNode 把能力包喂给区域组件（设计文档 §4.5 / 案例 5 / 决策 9）—— 端到端那一段。
 *
 * 光测 capabilities.test.ts 里的纯函数还不够：链条是
 *   attach 落场（带 needs）→ BaseNode 读出条目 → RegionEntryHost 造袋 + provide → 组件 useCapabilities() 取到
 * 中间任何一节断掉（比如 BaseNode 只取 component 不取 needs、或没包 RegionEntryHost），
 * 纯函数测试全绿而组件 inject 不到。这里用 SSR 把整条链跑一遍。
 */
import { describe, it, expect } from 'vitest'
import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { NodeRegistry } from '@mini-canvas/canvas-data'
import { RegistryImpl } from '@mini-canvas/kernel'
import {
  RENDER_CONTEXT_KEY,
  useVueFlow,
  useCapabilities,
  useCapability,
  type CanvasRenderContext,
  type CapabilityFactory,
} from '@mini-canvas/canvas-render'
import BaseNode from '../BaseNode.vue'

;(globalThis as unknown as { document: unknown }).document = {
  addEventListener() {},
  removeEventListener() {},
}

/**
 * 探针组件：把自己拿到的能力袋渲染成可见属性。
 * 这是唯一能证明"组件真的 inject 到了"的手段 —— 纯函数测试看不见 provide 链。
 */
const CapProbe = defineComponent({
  name: 'CapProbe',
  setup() {
    const bag = useCapabilities()
    const node = useCapability<{ id: string }>('node')
    return () =>
      h('div', {
        class: 'probe-cap',
        'data-keys': Object.keys(bag).sort().join(','),
        'data-node-id': node?.id ?? 'NONE',
      })
  },
})

/** 一条都不声明 needs 的探针：必须拿到空袋（不抛错） */
const NoNeedsProbe = defineComponent({
  name: 'NoNeedsProbe',
  setup() {
    const bag = useCapabilities()
    return () => h('div', { class: 'probe-noneeds', 'data-count': String(Object.keys(bag).length) })
  },
})

/**
 * 造渲染上下文。capabilityField 就是真 Registration 场（RegistryImpl），
 * registryOf('capability') 返回它 —— 与生产里 ctx.registryOf 同语义。
 */
function renderNode(
  registry: NodeRegistry,
  regionField: RegistryImpl<unknown>,
  capField: RegistryImpl<CapabilityFactory>,
  isDev = false,
): Promise<string> {
  const refOf = (v: unknown) => ({ value: v })
  const services: Record<string, unknown> = {
    doc: { types: new Map(), getNode: () => undefined, updateNode: () => {} },
    settings: { get: () => undefined, onChange: () => ({ dispose: () => {} }) },
    selection: { ids: new Set<string>(), has: () => false, onChange: () => () => {} },
  }
  const renderCtx = {
    ctx: {
      get: (name: string) => services[name],
      isDev,
      registryOf: (kind: string) =>
        kind === 'capability' ? capField : kind === 'node/region' ? regionField : new RegistryImpl(),
    },
    registry,
    nodeWrite: () => {},
    handleParams: {
      handleRestOffset: 36,
      handleCursorGap: 24,
      handleButtonSize: 32,
      portZoneWidth: 86,
      portZoneHeightRatio: 0.55,
      portZoneOffset: 0,
      portZoneShape: 'arc',
      portZoneArcRatio: 0.8,
    },
    connectionState: {
      isConnecting: refOf(false),
      hoverNode: refOf(null),
      aimedTarget: refOf(null),
      suppressHandles: refOf(false),
      activeConnection: refOf(null),
    },
    interaction: { isNodeDragging: refOf(false), isSelecting: refOf(false) },
    debug: { handleDebug: false, connectionSnapDebugVisible: false },
    snapZone: {},
    viewport: refOf({ zoom: 1, x: 0, y: 0 }),
    visibleRect: refOf(null),
    updateNodeVisualSize: () => {},
  } as unknown as CanvasRenderContext
  const app = createSSRApp({
    setup() {
      useVueFlow().viewport.value = { x: 0, y: 0, zoom: 1 }
      return () => h(BaseNode, { id: 'n1', type: 'image', data: {}, selected: false })
    },
  })
  app.provide(RENDER_CONTEXT_KEY, renderCtx)
  return renderToString(app)
}

const noCaps = () => new RegistryImpl<CapabilityFactory>()

describe('BaseNode → 区域组件：needs 声明的能力真的送得到', () => {
  it('声明 needs:[node] → 组件 useCapabilities() 拿到该节点的 node 实例', async () => {
    const cap = new RegistryImpl<CapabilityFactory>()
    cap.add('node', (n) => ({ id: n.id, type: n.type }))
    const r = new NodeRegistry()
    r.register('image', { in: CapProbe })
    const f = new RegistryImpl<unknown>()
    // 经 attach 的落点（node/region 场）：needs 随 value 存
    f.add('image/in', { component: CapProbe, needs: ['node'] }, { id: 'x', order: 1 })
    const html = await renderNode(r, f, cap)
    expect(html).toContain('probe-cap')
    expect(html).toContain('data-keys="node"')
    expect(html).toContain('data-node-id="n1"')
  })

  it('未声明 needs → 空袋、不抛错（"我不用任何能力"是合法声明）', async () => {
    const r = new NodeRegistry()
    r.register('image', { in: NoNeedsProbe })
    const f = new RegistryImpl<unknown>()
    f.add('image/in', { component: NoNeedsProbe }, { id: 'y', order: 1 })
    const html = await renderNode(r, f, noCaps())
    expect(html).toContain('probe-noneeds')
    expect(html).toContain('data-count="0"')
  })

  it('声明的能力没注册（prod）→ 组件仍渲染，只少那一格（不白屏）', async () => {
    const r = new NodeRegistry()
    r.register('image', { in: CapProbe })
    const f = new RegistryImpl<unknown>()
    f.add('image/in', { component: CapProbe, needs: ['nope'] }, { id: 'z', order: 1 })
    const html = await renderNode(r, f, noCaps())
    expect(html).toContain('probe-cap')
    expect(html).toContain('data-node-id="NONE"')
    // 空袋：data-keys 空串（Vue SSR 会把空串属性渲染成裸属性名），总之不含 "nope"
    expect(html).not.toContain('data-keys="nope"')
  })

  it('dev（isDev=true）下同一场景 → 抛错而不是静默降级（决策 9 的"响亮"）', async () => {
    const r = new NodeRegistry()
    r.register('image', { in: CapProbe })
    const f = new RegistryImpl<unknown>()
    f.add('image/in', { component: CapProbe, needs: ['nope'] }, { id: 'w', order: 1 })
    await expect(renderNode(r, f, noCaps(), true)).rejects.toThrow(/needs 里声明了 "nope"/)
  })

  it('两个条目各带自己的 needs：互不串（按条目分发，不是按节点一锅）', async () => {
    const cap = new RegistryImpl<CapabilityFactory>()
    cap.add('node', (n) => ({ id: n.id }))
    cap.add('zoom', () => ({ zoom: 1 }))
    const r = new NodeRegistry()
    r.register('image', { in: NoNeedsProbe })
    const f = new RegistryImpl<unknown>()
    f.add('image/out:top', { component: CapProbe, needs: ['node'] }, { id: 'a', order: 1 })
    f.add('image/out:bottom', { component: CapProbe, needs: ['zoom'] }, { id: 'b', order: 1 })
    const html = await renderNode(r, f, cap)
    expect(html).toContain('data-keys="node"')
    expect(html).toContain('data-keys="zoom"')
  })
})
