/**
 * BaseNode 按区域遍历（设计文档步骤 3 / §五 十个区域词）。
 *
 * 锁三件事：
 * 1. 老段词已下线（步骤 9）：这里只锁「按区域词读出」的渲染结果
 *    （既有 baseNodeSlotsRender.test.ts 全组不动，这里只补"新读法"的等价证据）；
 * 2. 十个区域词各渲染出一个最小挂件（新区域 on:top/on:bottom/out:left/out:right/over:outset
 *    是本次新增渲染位，其余五个复用老容器的定位/压制语义）；
 * 3. 经 ctx.nodes.attach 落场（含 type='*' 通配）的区域条目同样能被 BaseNode 读出渲染。
 */
import { describe, it, expect } from 'vitest'
import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { NodeRegistry } from '@mini-canvas/canvas-data'
import { RegistryImpl } from '@mini-canvas/kernel'
import { RENDER_CONTEXT_KEY, useVueFlow, type CanvasRenderContext } from '@mini-canvas/canvas-render'
import BaseNode from '../BaseNode.vue'

const ContentStub = defineComponent({ name: 'ContentStub', render: () => h('div', { class: 'probe-content' }) })
const LegacyContent = defineComponent({ name: 'LegacyContent', render: () => h('div', { class: 'probe-legacy-content' }) })

/**
 * 挂件工厂：区域探针组件，class = probe-region-<区域词转 kebab>。
 * 命名规则与 nodeRegionClass（canvas-data region.ts）一致，测试自己拼，锁断言自持。
 */
const probeOf = (region: string) => {
  const cls = 'probe-region-' + region.replace(/:/g, '-')
  return defineComponent({ name: 'Probe_' + region, render: () => h('div', { class: cls }) })
}

/**
 * BaseNode 在 setup 期会挂/摘 document 键盘监听（F2 改名），Node 环境没有 DOM，给两行最小桩。
 */
;(globalThis as unknown as { document: unknown }).document = {
  addEventListener() {},
  removeEventListener() {},
}

function renderCtx(
  registry: NodeRegistry,
  regionField?: RegistryImpl<{ component: unknown; props?: Record<string, unknown> }>,
  settings: Record<string, unknown> = {},
  opts: { selectedIds?: string[]; selecting?: boolean; zoom?: number } = {},
): CanvasRenderContext {
  const refOf = (v: unknown) => ({ value: v })
  const selectedIds = new Set<string>(opts.selectedIds ?? [])
 const services: Record<string, unknown> = {
    // 5c 起数据只有 doc 一个名字（nodeStore/graph 老名已下线，不再留死桩）
    doc: { types: new Map(), getNode: () => undefined, updateNode: () => {} },
  settings: { get: (key: string) => settings[key], onChange: () => ({ dispose: () => {} }) },
    selection: { ids: selectedIds, has: (id: string) => selectedIds.has(id), onChange: () => () => {} },
  }
  return {
    ctx: {
      get: (name: string) => services[name],
      registryOf: (kind: string) =>
        kind === 'node/region' && regionField ? regionField : new RegistryImpl(),
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
    interaction: { isNodeDragging: refOf(false), isSelecting: refOf(opts.selecting === true) },
    debug: { handleDebug: false, connectionSnapDebugVisible: false },
    snapZone: {},
    visibleRect: refOf(null),
    flow: {
      viewport: refOf({ zoom: opts.zoom ?? 1, x: 0, y: 0 }),
      updateNodeVisualSize: () => {},
      getNodeRenderPosition: () => undefined,
    },
  } as unknown as CanvasRenderContext
}

function renderNode(
  registry: NodeRegistry,
  regionField?: RegistryImpl<{ component: unknown; props?: Record<string, unknown> }>,
  data: Record<string, unknown> = {},
  settings: Record<string, unknown> = {},
  opts: { selectedIds?: string[]; selecting?: boolean; zoom?: number } = {},
): Promise<string> {
  const app = createSSRApp({
    setup() {
      useVueFlow().viewport.value = { x: 0, y: 0, zoom: opts.zoom ?? 1 }
      return () => h(BaseNode, { id: 'n1', type: 'image', data, selected: false })
    },
  })
  app.provide(RENDER_CONTEXT_KEY, renderCtx(registry, regionField, settings, opts))
  return renderToString(app)
}

describe('BaseNode 十区域渲染（步骤 3）', () => {
  it('映射等价：老 content 段组件经区域层读出，渲染结果与老路径一致（同一探针 class）', async () => {
    const r = new NodeRegistry()
    r.register('image', { in: LegacyContent })
    const html = await renderNode(r)
    expect(html).toContain('probe-legacy-content')
    expect(html).toContain('v2-content-clip')
  })

  it("in 区域：场条目（含 * 通配）与基座同摞渲染，key 语义与老 content 相同", async () => {
    const r = new NodeRegistry()
    r.register('image', { in: ContentStub })
    const f = new RegistryImpl<{ component: unknown }>()
    f.add('image/in', { component: probeOf('in') }, { id: 'r1', order: 1 })
    f.add('*/in', { component: probeOf('in') }, { id: 'star', order: 2 })
    const html = await renderNode(r, f)
    expect((html.match(/probe-region-in/g) ?? []).length).toBe(2)
  })

  it('out:top / out:bottom：区域条目复用老插槽定位层（v2-slot--top/--bottom + 壳反缩放）', async () => {
    const r = new NodeRegistry()
    r.register('image', { in: ContentStub })
    const f = new RegistryImpl<{ component: unknown }>()
    f.add('image/out:top', { component: probeOf('out:top') }, { id: 't', order: 1 })
    f.add('image/out:bottom', { component: probeOf('out:bottom') }, { id: 'b', order: 1 })
    const html = await renderNode(r, f)
    expect(html).toContain('probe-region-out-top')
    expect(html).toContain('probe-region-out-bottom')
    expect(html).toMatch(/class="v2-slot v2-slot--top[^"]*"/)
    expect(html).toContain('v2-slot--bottom')
  })

  it('out:left / out:right：新增渲染位出现（区域 class 命名容器）', async () => {
    const r = new NodeRegistry()
    r.register('image', { in: ContentStub })
    const f = new RegistryImpl<{ component: unknown }>()
    f.add('image/out:left', { component: probeOf('out:left') }, { id: 'l', order: 1 })
    f.add('image/out:right', { component: probeOf('out:right') }, { id: 'r', order: 1 })
    const html = await renderNode(r, f)
    expect(html).toContain('probe-region-out-left')
    expect(html).toContain('probe-region-out-right')
  })

  it('on:top / on:bottom：贴边渲染位出现', async () => {
    const r = new NodeRegistry()
    r.register('image', { in: ContentStub })
    const f = new RegistryImpl<{ component: unknown }>()
    f.add('image/on:top', { component: probeOf('on:top') }, { id: 't', order: 1 })
    f.add('image/on:bottom', { component: probeOf('on:bottom') }, { id: 'b', order: 1 })
    const html = await renderNode(r, f)
    expect(html).toContain('probe-region-on-top')
    expect(html).toContain('probe-region-on-bottom')
  })

  it('over:inset：走老 v2-overlay 容器语义（卡片外、不反缩放）；over:outset：新增渲染位出现', async () => {
    const r = new NodeRegistry()
    r.register('image', { in: ContentStub })
    const f = new RegistryImpl<{ component: unknown }>()
    f.add('image/over:inset', { component: probeOf('over:inset') }, { id: 'i', order: 1 })
    f.add('image/over:outset', { component: probeOf('over:outset') }, { id: 'o', order: 1 })
    const html = await renderNode(r, f)
    expect(html).toContain('probe-region-over-inset')
    expect(html).toMatch(/class="v2-overlay nodrag nopan"/)
    expect(html).toContain('probe-region-over-outset')
    // outset 也画在卡片外（不在内容裁剪层里）
    const clipAt = html.indexOf('v2-content-clip')
    const outsetAt = html.indexOf('probe-region-over-outset')
    expect(outsetAt).toBeGreaterThan(clipAt)
  })

  it('十区域各一个挂件 → 十个探针全部渲染', async () => {
    const regions = [
      'in',
      'title',
      'out:top',
      'out:bottom',
      'out:left',
      'out:right',
      'on:top',
      'on:bottom',
      'over:inset',
      'over:outset',
    ]
    const r = new NodeRegistry()
    r.register('image', { in: ContentStub })
    const f = new RegistryImpl<{ component: unknown }>()
    regions.forEach((region, i) => {
      f.add(`image/${region}`, { component: probeOf(region) }, { id: `r${i}`, order: i })
    })
    const html = await renderNode(r, f)
    for (const region of regions) {
      expect(html).toContain(`probe-region-${region.replace(/:/g, '-')}`)
    }
  })

  it('title 区域：场条目替换默认标题条渲染（custom title 语义不变）', async () => {
    const r = new NodeRegistry()
    r.register('image', { in: ContentStub })
    const f = new RegistryImpl<{ component: unknown }>()
    f.add('image/title', { component: probeOf('title') }, { id: 'tt', order: 1 })
    const html = await renderNode(r, f)
    expect(html).toContain('probe-region-title')
    expect(html).toContain('v2-title')
  })

  it('新增五区域挂进 LOD 总开关：低细节时整层不渲染（契约 §1.4-3）', async () => {
    const r = new NodeRegistry()
    r.register('image', { in: ContentStub })
    const f = new RegistryImpl<{ component: unknown }>()
    for (const region of ['out:left', 'out:right', 'on:top', 'on:bottom', 'over:outset']) {
      f.add(`image/${region}`, { component: probeOf(region) }, { id: region, order: 1 })
    }
    const html = await renderNode(r, f, {}, {}, { zoom: 0.2 })
    expect(html).not.toContain('v2-region')
    expect(html).not.toContain('probe-region-out-left')
    expect(html).not.toContain('probe-region-on-top')
    expect(html).not.toContain('probe-region-over-outset')
  })
})
