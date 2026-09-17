/**
 * BaseNode 上/下插槽的渲染契约（用户可见行为）。
 *
 * 用户原话："这边可以看出，你的这个节点上下控制栏都是每个组件单独实现的，
 * 我希望的是你可以在 render 导出对应的组件…… 提供上下 2 个位置的插槽
 * （定位交给 BaseNode 而不是单独的组件）…… 基础节点已经把位置计算出了，然后把插槽留给对应的插件实现"。
 *
 * 所以这条测试锁三件事：
 * 1. 插件只注册段组件，**定位层由壳画出来**（贴边 + 居中 + 反缩放都在壳这一层）；
 * 2. 同一段可以叠多个 occupant（数据层早有 nodeSegmentStack，壳必须真的把它们都渲染出来）；
 * 3. 没注册该段 → 那一层整个不出现（不留一个空的浮层壳）。
 *
 * 用 SSR 拿真实 HTML 断言：这几条全是"模板有没有真的把定位贴到元素上"的形态，
 * 只测内部 computed 看不见。
 */
import { describe, it, expect } from 'vitest'
import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { NodeRegistry } from '@mini-canvas/canvas-data'
import { RENDER_CONTEXT_KEY, useVueFlow, type CanvasRenderContext } from '@mini-canvas/canvas-render'
import BaseNode from '../BaseNode.vue'

const ContentStub = defineComponent({ name: 'ContentStub', render: () => h('div', { class: 'probe-content' }) })
/**
 * BaseNode 在 setup 期就会给 document 挂/摘键盘监听（选中态切换 F2 改名），Node 环境没有 DOM。
 * 这里给两行最小桩，只为让组件 setup 跑通 —— 本文件不测键盘行为。
 */
;(globalThis as unknown as { document: unknown }).document = {
  addEventListener() {},
  removeEventListener() {},
}

const TopA = defineComponent({ name: 'TopA', render: () => h('button', { class: 'probe-top-a' }) })
const TopB = defineComponent({ name: 'TopB', render: () => h('button', { class: 'probe-top-b' }) })
const BottomA = defineComponent({ name: 'BottomA', render: () => h('div', { class: 'probe-bottom-a' }) })
const OverlayStub = defineComponent({ name: 'OverlayStub', render: () => h('div', { class: 'probe-overlay' }) })

/**
 * 最小渲染上下文：只桩出 BaseNode 真正读到的几项。
 * 完整 CanvasRenderContext 有 20+ 个字段（宿主级能力），这里只给被用到的 —— 是刻意的取舍，不是漏写。
 */
function renderCtx(
  registry: NodeRegistry,
  settings: Record<string, unknown> = {},
  opts: { selectedIds?: string[]; selecting?: boolean; zoom?: number } = {},
): CanvasRenderContext {
  const refOf = (v: unknown) => ({ value: v })
  const selectedIds = new Set<string>(opts.selectedIds ?? [])
  const services: Record<string, unknown> = {
    nodeStore: { types: new Map(), getNode: () => undefined },
    settings: {
      get: (key: string) => settings[key],
      onChange: () => ({ dispose: () => {} }),
    },
    selection: { ids: selectedIds, has: (id: string) => selectedIds.has(id), onChange: () => () => {} },
    graph: { updateNode: () => {} },
  }
  return {
    ctx: { get: (name: string) => services[name] },
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
    viewport: refOf({ zoom: opts.zoom ?? 1, x: 0, y: 0 }),
    visibleRect: refOf(null),
    updateNodeVisualSize: () => {},
  } as unknown as CanvasRenderContext
}

/**
 * 渲染一个 image 节点；registry 由测试自行填段。
 *
 * `opts.zoom` 必须经 VueFlow 自己的 store 喂进去 —— BaseNode 的缩放读的是
 * `useVueFlow().viewport`（节点壳本就由 VueFlow 渲染，缩放对它理应从引擎来）。
 * 外层包装组件先在 setup 里 useVueFlow() 建/取实例、写好 viewport，再往下渲染 BaseNode，
 * 它 inject 到的就是同一个实例（provide 对子组件生效）。
 */
function renderNode(
  registry: NodeRegistry,
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
  app.provide(RENDER_CONTEXT_KEY, renderCtx(registry, settings, opts))
  return renderToString(app)
}

describe('BaseNode 上/下插槽：定位由壳负责', () => {
  it('注册了 top-toolbar 段 → 壳画出定位层（贴边 + 居中 + 反缩放）', async () => {
    const r = new NodeRegistry()
    r.register('image', { content: ContentStub, 'top-toolbar': TopA })
    const html = await renderNode(r)
    expect(html).toContain('probe-top-a')
    // 定位在壳这一层，不是插件组件内部
    expect(html).toMatch(/class="v2-slot v2-slot--top[^"]*"/)
    expect(html).toContain('calc(100% + 6px)')
    expect(html).toContain('translateX(-50%) scale(1)')
  })

  it('注册了 bottom-toolbar 段 → 同样由壳定位，浮在卡片下方', async () => {
    const r = new NodeRegistry()
    r.register('image', { content: ContentStub, 'bottom-toolbar': BottomA })
    const html = await renderNode(r)
    expect(html).toContain('probe-bottom-a')
    expect(html).toContain('v2-slot--bottom')
    expect(html).toContain('calc(100% + 6px)')
  })

  it('没注册该段 → 定位层整个不出现（不留空的浮层壳）', async () => {
    const r = new NodeRegistry()
    r.register('image', { content: ContentStub })
    const html = await renderNode(r)
    expect(html).not.toContain('v2-slot')
  })
})

describe('BaseNode overlay 段：编辑浮层画在卡片外面（用户要求：和上下操控栏同级）', () => {
  it('注册了 overlay 段 → 壳在卡片**外面**画出浮层容器', async () => {
    const r = new NodeRegistry()
    r.register('image', { content: ContentStub, overlay: OverlayStub })
    const html = await renderNode(r)
    expect(html).toContain('probe-overlay')
    expect(html).toMatch(/class="v2-overlay nodrag nopan"/)
  })

  it('浮层**不在**内容裁剪层里 —— 放里面会被卡片的 overflow:hidden 切掉', async () => {
    // 这是用户报的缺陷：裁剪区域被节点切掉，因为浮层当初挂在 .v2-content-clip 内部。
    const r = new NodeRegistry()
    r.register('image', { content: ContentStub, overlay: OverlayStub })
    const html = await renderNode(r)
    const overlayAt = html.indexOf('probe-overlay')
    const clipAt = html.indexOf('v2-content-clip')
    expect(clipAt).toBeGreaterThan(-1)
    expect(overlayAt).toBeGreaterThan(clipAt)
    // 内容层内部只有 content：浮层没被塞进它的子树里
    const contentAt = html.indexOf('probe-content')
    const clipRegion = html.slice(clipAt, overlayAt)
    expect(clipRegion).toContain('probe-content')
    expect(clipRegion).not.toContain('probe-overlay')
    expect(contentAt).toBeGreaterThan(clipAt)
  })

  it('浮层尺寸 = 卡片尺寸（不反缩放：必须与底下的画面像素严格对齐）', async () => {
    const r = new NodeRegistry()
    r.register('image', { content: ContentStub, overlay: OverlayStub })
    const html = await renderNode(r, { cardWidth: 420, cardHeight: 236 })
    const overlayTag = html.match(/<div class="v2-overlay[^>]*>/)?.[0] ?? ''
    // Vue 渲染内联样式时不带空格（width:420px），故按无空格断言
    expect(overlayTag).toContain('width:420px')
    expect(overlayTag).toContain('height:236px')
    // 关键：没有 scale() 反缩放（反缩放会让框与画面错位）
    expect(overlayTag).not.toContain('scale(')
  })

  it('没注册 overlay 段 → 不出现浮层容器（不留空壳）', async () => {
    const r = new NodeRegistry()
    r.register('image', { content: ContentStub })
    const html = await renderNode(r)
    expect(html).not.toContain('v2-overlay')
  })

  it('多选时（选中 >=2）浮层跟着收起，避免多个编辑框同时出现', async () => {
    const r = new NodeRegistry()
    r.register('image', { content: ContentStub, overlay: OverlayStub })
    const html = await renderNode(r, {}, {}, { selectedIds: ['n1', 'n2'] })
    expect(html).not.toContain('v2-overlay')
  })
})

describe('BaseNode 上/下插槽：可叠加多个 occupant', () => {

  it('同段叠两个 occupant → 两个都渲染（数据层早有的能力，壳要真的用上）', async () => {
    const r = new NodeRegistry()
    r.register('image', { content: ContentStub, 'top-toolbar': TopA })
    r.registerContribution('image', 'top-toolbar', { id: 'b', component: TopB })
    const html = await renderNode(r)
    expect(html).toContain('probe-top-a')
    expect(html).toContain('probe-top-b')
  })

  it('只有叠加 occupant、没有基座 → 也要渲染（第三方往别人的节点上挂按钮）', async () => {
    const r = new NodeRegistry()
    r.register('image', { content: ContentStub })
    r.registerContribution('image', 'bottom-toolbar', { id: 'extra', component: BottomA })
    const html = await renderNode(r)
    expect(html).toContain('probe-bottom-a')
  })
})

describe('BaseNode 上/下插槽：位置与缩放来自配置', () => {
  it('上控制栏偏移读到 24 就用 24（设置面板可调，改完实时生效）', async () => {
    const r = new NodeRegistry()
    r.register('image', { content: ContentStub, 'top-toolbar': TopA })
    const html = await renderNode(r, {}, { toolbarTopOffset: 24 })
    expect(html).toContain('calc(100% + 24px)')
    expect(html).not.toContain('calc(100% + 6px)')
  })

  it('读不到配置 → 回落 6px（不产生坏 CSS）', async () => {
    const r = new NodeRegistry()
    r.register('image', { content: ContentStub, 'top-toolbar': TopA })
    expect(await renderNode(r)).toContain('calc(100% + 6px)')
  })
})

describe('多选相关显隐（用户要求：框选时不要出现控制栏；多选时标题可隐藏）', () => {
  it('框选进行中 → 上/下插槽整层不渲染（不会跟着框一起被框进去、也不挡视线）', async () => {
    const r = new NodeRegistry()
    r.register('image', { content: ContentStub, 'top-toolbar': TopA, 'bottom-toolbar': BottomA })
    const html = await renderNode(r, {}, {}, { selecting: true })
    expect(html).not.toContain('probe-top-a')
    expect(html).not.toContain('probe-bottom-a')
    expect(html).not.toContain('v2-slot')
  })

  it('多选（选中 2 个）→ 插槽整层不渲染（面板语义是"恰好选中一个"）', async () => {
    const r = new NodeRegistry()
    r.register('image', { content: ContentStub, 'top-toolbar': TopA })
    const html = await renderNode(r, {}, {}, { selectedIds: ['n1', 'n2'] })
    expect(html).not.toContain('probe-top-a')
  })

  it('单选 → 插槽照常渲染（多选压制不该误伤单选）', async () => {
    const r = new NodeRegistry()
    r.register('image', { content: ContentStub, 'top-toolbar': TopA })
    const html = await renderNode(r, {}, {}, { selectedIds: ['n1'] })
    expect(html).toContain('probe-top-a')
  })

  it('开了"多选时隐藏标题"且处于多选 → 标题条不渲染', async () => {
    const r = new NodeRegistry()
    r.register('image', { content: ContentStub })
    const html = await renderNode(
      r,
      {},
      { multiSelectHideTitles: true },
      { selectedIds: ['n1', 'n2'] },
    )
    expect(html).not.toContain('v2-title')
  })

  it('开了开关但只是单选 → 标题照常显示（不该被误隐藏）', async () => {
    const r = new NodeRegistry()
    r.register('image', { content: ContentStub })
    const html = await renderNode(
      r,
      {},
      { multiSelectHideTitles: true },
      { selectedIds: ['n1'] },
    )
    expect(html).toContain('v2-title')
  })

  it('没开开关的多选 → 标题仍显示（默认不隐藏）', async () => {
    const r = new NodeRegistry()
    r.register('image', { content: ContentStub })
    const html = await renderNode(r, {}, {}, { selectedIds: ['n1', 'n2'] })
    expect(html).toContain('v2-title')
  })
})

describe('多选单选圈（用户要求：多选时在节点内容区左上角给个圆形标记）', () => {
  it('多选（选中 2 个）→ 出现圆形标记', async () => {
    const r = new NodeRegistry()
    r.register('image', { content: ContentStub })
    const html = await renderNode(r, {}, {}, { selectedIds: ['n1', 'n2'] })
    expect(html).toContain('v2-multi-radio')
    expect(html).toContain('v2-multi-radio-dot')
  })

  it('标记是自绘 SVG（用户要求：用自定义 svg 替代）', async () => {
    const r = new NodeRegistry()
    r.register('image', { content: ContentStub })
    const html = await renderNode(r, {}, {}, { selectedIds: ['n1', 'n2'] })
    expect(html).toContain('<svg')
    expect(html).toContain('v2-multi-radio-icon')
    expect(html).toContain('v2-multi-radio-ring')
    // 外圈 + 中心点两个圆
    expect((html.match(/<circle/g) ?? []).length).toBe(2)
    expect(html).toContain('viewBox="0 0 20 20"')
  })

  it('单选 → 不出现圆形标记（卡片本身已有选中环，再多一个圆点反而多余）', async () => {
    const r = new NodeRegistry()
    r.register('image', { content: ContentStub })
    const html = await renderNode(r, {}, {}, { selectedIds: ['n1'] })
    expect(html).not.toContain('v2-multi-radio')
  })

  it('未选中 → 不出现圆形标记', async () => {
    const r = new NodeRegistry()
    r.register('image', { content: ContentStub })
    const html = await renderNode(r, {}, {}, { selectedIds: ['other'] })
    expect(html).not.toContain('v2-multi-radio')
  })

  it('标记是纯指示（不接事件、不进无障碍树），点击行为仍归卡片（Shift+点是取消选中）', async () => {
    const r = new NodeRegistry()
    r.register('image', { content: ContentStub })
    const html = await renderNode(r, {}, {}, { selectedIds: ['n1', 'n2'] })
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('role="presentation"')
    expect(html).not.toContain('v2-multi-radio-dot nodrag')
  })
})

describe('多选标记的大小 / 颜色 / 低缩放开关（用户要求：变小一些 + 可配色 + 可配 size + 低缩放也显示的开关）', () => {
  it('读不到配置 → 默认就比原先小（18px，此前写死 26px）', async () => {
    const r = new NodeRegistry()
    r.register('image', { content: ContentStub })
    const html = await renderNode(r, {}, {}, { selectedIds: ['n1', 'n2'] })
    expect(html).toMatch(/class="v2-multi-radio[^"]*"[^>]*style="[^"]*width:18px/)
  })

  it('大小配置读到 32 → 元素宽高就是 32px（配置驱动，不是写死）', async () => {
    const r = new NodeRegistry()
    r.register('image', { content: ContentStub })
    const html = await renderNode(
      r,
      {},
      { nodeMultiRadioSize: 32 },
      { selectedIds: ['n1', 'n2'] },
    )
    expect(html).toContain('width:32px')
    expect(html).toContain('height:32px')
  })

  it('颜色配置读到 hex → 标记元素带上该颜色（圆环/圆点走 currentColor）', async () => {
    const r = new NodeRegistry()
    r.register('image', { content: ContentStub })
    const html = await renderNode(
      r,
      {},
      { nodeMultiRadioColor: '#ff0000' },
      { selectedIds: ['n1', 'n2'] },
    )
    expect(html).toContain('color:#ff0000')
  })

  it('低缩放（zoom 低于低细节阈值）默认不显示标记', async () => {
    const r = new NodeRegistry()
    r.register('image', { content: ContentStub })
    const html = await renderNode(r, {}, {}, { selectedIds: ['n1', 'n2'], zoom: 0.2 })
    expect(html).not.toContain('v2-multi-radio')
  })

  it('开了"低缩放也显示"的开关 → 低缩放下标记照样出现（用户要的就是这个开关）', async () => {
    const r = new NodeRegistry()
    r.register('image', { content: ContentStub })
    const html = await renderNode(
      r,
      {},
      { nodeMultiRadioShowInLowDetail: true },
      { selectedIds: ['n1', 'n2'], zoom: 0.2 },
    )
    expect(html).toContain('v2-multi-radio')
    // 低缩放时反缩放已封顶（阈值 0.5）→ 屏幕上仍是 18px
    expect(html).toContain('transform:scale(2)')
  })

  it('开了开关但没在多选 → 依然不显示（开关只管低缩放，不改变"只在多选时出现"）', async () => {
    const r = new NodeRegistry()
    r.register('image', { content: ContentStub })
    const html = await renderNode(
      r,
      {},
      { nodeMultiRadioShowInLowDetail: true },
      { selectedIds: ['n1'], zoom: 0.2 },
    )
    expect(html).not.toContain('v2-multi-radio')
  })
})

describe('多选标记的大小与缩放阈值同源（titleScaleMinZoom 改了标记也跟着改）', () => {
  it('阈值配 0.25 → 缩到 0.2 时反缩放 4 倍（跟随配置，不写死 0.5）', async () => {
    const r = new NodeRegistry()
    r.register('image', { content: ContentStub })
    const html = await renderNode(
      r,
      {},
      { nodeMultiRadioShowInLowDetail: true, titleScaleMinZoom: 0.25 },
      { selectedIds: ['n1', 'n2'], zoom: 0.2 },
    )
    expect(html).toContain('transform:scale(4)')
  })
})

describe('resize 拖柄（用户要求：反缩放，屏幕大小恒定）', () => {
  it('data.resizable=true → 渲染拖柄，且带 scale 反缩放绑定（与标题同一套语义）', async () => {
    const r = new NodeRegistry()
    r.register('image', { content: ContentStub })
    const html = await renderNode(r, { resizable: true })
    expect(html).toContain('resize-handle')
    expect(html).toMatch(/class="resize-handle"[^>]*style="[^"]*transform:scale/)
  })

  it('不可 resize → 不渲染拖柄（不挡卡片内容）', async () => {
    const r = new NodeRegistry()
    r.register('image', { content: ContentStub })
    const html = await renderNode(r)
    expect(html).not.toContain('resize-handle')
  })
})
