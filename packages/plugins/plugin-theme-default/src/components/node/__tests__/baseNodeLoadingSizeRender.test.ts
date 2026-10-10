/**
 * 加载态卡片尺寸：声明 loadingDefaultSize 的类型（图片/视频）在跑任务时按**类型默认尺寸**渲染。
 *
 * 用户口径（2026-10-10）：图片/视频节点一旦有内容，node.size 就被按媒体真实比例写死（9:16 竖图 →
 * 169×300）。重新生成时卡片仍是竖版（"重新生成就变竖屏"）。要求跑任务期间回到设置里配的默认宽高，
 * 跑完再跟随新产物比例。
 *
 * 用 SSR 拿真实 HTML 断言卡片内联样式 —— "卡片有没有真的按默认尺寸画"只能从模板看出来。
 */
import { describe, it, expect } from 'vitest'
import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { NodeRegistry } from '@mini-canvas/canvas-data'
import { RENDER_CONTEXT_KEY, useVueFlow, type CanvasRenderContext } from '@mini-canvas/canvas-render'
import BaseNode from '../BaseNode.vue'

const ContentStub = defineComponent({ name: 'ContentStub', render: () => h('div', { class: 'probe-content' }) })
;(globalThis as unknown as { document: unknown }).document = {
  addEventListener() {},
  removeEventListener() {},
}

/** 类型表：image 声明加载态默认尺寸；defaultSize = 用户在设置里配的默认宽高（480×240） */
function typeTable(loadingDefaultSize: boolean): Map<string, unknown> {
  return new Map([
    ['image', { type: 'image', label: '图片', defaultSize: { w: 480, h: 240 }, loadingDefaultSize }],
  ])
}

function renderNode(
  registry: NodeRegistry,
  data: Record<string, unknown>,
  loadingDefaultSize = true,
): Promise<string> {
  const refOf = (v: unknown) => ({ value: v })
  const services: Record<string, unknown> = {
    doc: { types: typeTable(loadingDefaultSize), getNode: () => undefined, updateNode: () => {} },
    settings: { get: () => undefined, onChange: () => ({ dispose: () => {} }) },
    selection: { ids: new Set<string>(), has: () => false, onChange: () => () => {} },
  }
  const renderCtx = {
    ctx: { get: (name: string) => services[name], tryGet: (name: string) => services[name] },
    registry,
    nodeWrite: () => {},
    handleParams: {
      handleRestOffset: 36, handleCursorGap: 24, handleButtonSize: 32,
      portZoneWidth: 86, portZoneHeightRatio: 0.55, portZoneOffset: 0, portZoneShape: 'arc', portZoneArcRatio: 0.8,
    },
    connectionState: {
      isConnecting: refOf(false), hoverNode: refOf(null), aimedTarget: refOf(null),
      suppressHandles: refOf(false), activeConnection: refOf(null),
    },
    interaction: { isNodeDragging: refOf(false), isSelecting: refOf(false), nodeResizeId: refOf(null) },
    debug: { handleDebug: false, connectionSnapDebugVisible: false },
    snapZone: {},
    visibleRect: refOf(null),
    flow: { viewport: refOf({ zoom: 1, x: 0, y: 0 }), updateNodeVisualSize: () => {}, getNodeRenderPosition: () => undefined },
  } as unknown as CanvasRenderContext
  const app = createSSRApp({
    setup() {
      useVueFlow().viewport.value = { x: 0, y: 0, zoom: 1 }
      return () => h(BaseNode, { id: 'n1', type: 'image', data, selected: false })
    },
  })
  app.provide(RENDER_CONTEXT_KEY, renderCtx)
  return renderToString(app)
}

/** 取卡片那层的内联样式（.v2-card） */
function cardStyle(html: string): string {
  return html.match(/<div class="v2-card[^"]*" style="([^"]*)"/)?.[1] ?? ''
}

describe('BaseNode 加载态尺寸（loadingDefaultSize 类型）', () => {
  const r = (() => {
    const x = new NodeRegistry()
    x.register('image', { in: ContentStub })
    return x
  })()

  it('running → 卡片按类型默认尺寸（480×240），不沿用媒体比例（169×300）', async () => {
    const html = await renderNode(r, {
      cardWidth: 169, cardHeight: 300,
      runState: { status: 'running', progress: 40 },
    })
    const style = cardStyle(html)
    expect(style).toContain('width:480px')
    expect(style).toContain('height:240px')
    expect(style).not.toContain('width:169px')
    expect(style).not.toContain('height:300px')
  })

  it('done → 回到 data 里的真实产物比例（169×300）', async () => {
    const html = await renderNode(r, {
      cardWidth: 169, cardHeight: 300,
      runState: { status: 'done' },
    })
    const style = cardStyle(html)
    expect(style).toContain('width:169px')
    expect(style).toContain('height:300px')
  })

  it('error（失败/取消）→ 也回到真实比例，原图与尺寸都还在（只改渲染，不删数据）', async () => {
    const html = await renderNode(r, {
      cardWidth: 440, cardHeight: 248,
      runState: { status: 'error', message: '已取消' },
    })
    const style = cardStyle(html)
    expect(style).toContain('width:440px')
    expect(style).toContain('height:248px')
  })

  it('没声明 loadingDefaultSize 的类型：running 期间照旧用显式尺寸（行为不变）', async () => {
    const html = await renderNode(r, {
      cardWidth: 169, cardHeight: 300,
      runState: { status: 'running' },
    }, false)
    const style = cardStyle(html)
    expect(style).toContain('width:169px')
    expect(style).toContain('height:300px')
  })
})
