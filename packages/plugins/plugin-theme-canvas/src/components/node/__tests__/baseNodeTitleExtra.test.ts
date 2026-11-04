/**
 * BaseNode 标题条的两条新契约（用户口径 2026-10-11）。
 *
 * 用户原话：「我希望你可以在这个插件的 config 中配置一个开关选项，用来控制是否显示这里的标题。
 * 关闭之后，就隐藏这里上面的标题内容」以及「我希望在标题的右侧插入内容……比如我的图片和视频节点，
 * 我希望把它们的宽高插入到该节点的右上角，也就是标题的右侧」。
 *
 * 这里只测默认壳（BaseNode）自己的两件事 —— 数据从哪来、怎么取值是各自类型/插件的事：
 * ① 总开关 titleVisible=false → 整块标题不画（不是只把文字藏起来）；
 * ② 类型声明的 titleExtra → 渲染成标题右侧那一格；字符串/函数两种形态都认，
 *    空串与函数抛错都收敛成"这一格不渲染"（宁可少一格，也不要显示半截脏文案）。
 *
 * 为什么用 SSR 拿真 HTML：这两条都是"模板有没有真的把东西画出来"，
 * 只测内部 computed 看不见 v-if 写错、插槽名字写错这类错误。
 */
import { describe, it, expect } from 'vitest'
import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { NodeRegistry } from '@mini-canvas/canvas-data'
import { RENDER_CONTEXT_KEY, useVueFlow, type CanvasRenderContext } from '@mini-canvas/canvas-render'
import BaseNode from '../BaseNode.vue'

/** BaseNode 在 setup 期会给 document 挂/摘键盘监听（F2 改名），Node 环境没有 DOM */
;(globalThis as unknown as { document: unknown }).document = {
  addEventListener() {},
  removeEventListener() {},
}

const ContentStub = defineComponent({ name: 'ContentStub', render: () => h('div', { class: 'probe-content' }) })

/**
 * 造一个"注册了某节点类型"的渲染上下文。
 * titleExtra 经 nodeStore 的类型表（doc.types）到达壳 —— 与生产同一条路：
 * 插件 ctx.nodes.register 声明 → 类型表 → useNodeCapability → BaseNode。
 */
function renderCtx(
  registry: NodeRegistry,
  settings: Record<string, unknown>,
  typeDef: Record<string, unknown>,
): CanvasRenderContext {
  const refOf = (v: unknown) => ({ value: v })
  const types = new Map<string, unknown>([['image', typeDef]])
  const services: Record<string, unknown> = {
    doc: { types, getNode: () => undefined, updateNode: () => {} },
    settings: { get: (key: string) => settings[key], onChange: () => ({ dispose: () => {} }) },
    selection: { ids: new Set<string>(), has: () => false, onChange: () => () => {} },
  }
  return {
    ctx: { get: (name: string) => services[name], tryGet: (name: string) => services[name] },
    registry,
    nodeWrite: () => {},
    handleParams: {
      handleRestOffset: 36,
      handleCursorGap: 24,
      handleButtonSize: 32,
      portZoneWidth: 10,
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
    interaction: { isNodeDragging: refOf(false), isSelecting: refOf(false), nodeResizeId: refOf(null) },
    debug: { handleDebug: false, connectionSnapDebugVisible: false },
    snapZone: {},
    visibleRect: refOf(null),
    flow: {
      viewport: refOf({ zoom: 1, x: 0, y: 0 }),
      updateNodeVisualSize: () => {},
      getNodeRenderPosition: () => undefined,
    },
  } as unknown as CanvasRenderContext
}

function renderNode(
  settings: Record<string, unknown> = {},
  typeDef: Record<string, unknown> = {},
  data: Record<string, unknown> = {},
): Promise<string> {
  const registry = new NodeRegistry()
  registry.register('image', { in: ContentStub })
  const app = createSSRApp({
    setup() {
      useVueFlow().viewport.value = { x: 0, y: 0, zoom: 1 }
      return () => h(BaseNode, { id: 'n1', type: 'image', data, selected: false })
    },
  })
  app.provide(RENDER_CONTEXT_KEY, renderCtx(registry, settings, typeDef))
  return renderToString(app)
}

describe('标题总开关（titleVisible）', () => {
  it('默认（没配过）→ 标题照旧显示，与历史行为逐字一致', async () => {
    const html = await renderNode()
    expect(html).toContain('v2-title')
  })

  it('开关关掉 → 整块标题不画（标题文字、类型图标、右侧附加文本一起收起）', async () => {
    const html = await renderNode(
      { titleVisible: false },
      { label: '图片', icon: '<svg data-probe="type-icon"></svg>', titleExtra: '1280×720' },
    )
    expect(html).not.toContain('v2-title')
    expect(html).not.toContain('data-probe="type-icon"')
    expect(html).not.toContain('1280×720')
  })

  it('开关打开 → 标题与右侧附加文本都在（配置项是实时读的，不是建节点时定死）', async () => {
    const html = await renderNode({ titleVisible: true }, { titleExtra: '1280×720' })
    expect(html).toContain('v2-title')
    expect(html).toContain('1280×720')
  })
})

describe('标题右侧附加文本（类型声明的 titleExtra）', () => {
  it('未声明 → 标题右侧那一格是空的（默认壳不凭空造内容）', async () => {
    const html = await renderNode()
    expect(html).not.toContain('v2-title-extra')
  })

  it('字符串形态 → 原样渲染在标题右侧那一格', async () => {
    const html = await renderNode({}, { titleExtra: '预览' })
    expect(html).toContain('v2-title-extra')
    expect(html).toContain('预览')
  })

  it('函数形态 → 按节点 data 现算（图片/视频的宽高走这条，派生值不落 data）', async () => {
    const html = await renderNode(
      {},
      { titleExtra: (d: Record<string, unknown>) => `${d.imageWidth}×${d.imageHeight}` },
      { imageWidth: 1920, imageHeight: 1080 },
    )
    expect(html).toContain('1920×1080')
  })

  it('函数返回空串 → 这一格不渲染（拿不到尺寸就什么都不显示）', async () => {
    const html = await renderNode({}, { titleExtra: () => '' })
    expect(html).not.toContain('v2-title-extra')
  })

  it('函数抛错 → 收敛成不渲染，不把标题条整个炸掉', async () => {
    const html = await renderNode({}, {
      titleExtra: () => {
        throw new Error('boom')
      },
    })
    expect(html).toContain('v2-title')
    expect(html).not.toContain('v2-title-extra')
  })
})
