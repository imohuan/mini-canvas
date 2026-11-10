/**
 * 流式生成时的加载表现（用户 2026-11-10）。
 *
 * 用户实测：AI 对话「只看到 5% 然后直接跳到完成」，中间的文字完全没看到。
 * 根因是加载覆盖层铺满整卡，把正在长出来的正文盖住了。
 *
 * 现在的契约：
 * · 加载中 + 已有正文 → 只挂顶部状态条（.v2-stream-bar），露出正文；
 * · 加载中 + 还没正文 → 仍然全屏加载件（那时候没什么可看的）；
 * · 状态条里要能看到「已输出 N 字 / ≈M tokens」（runState.stats）。
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

function makeRegistry(): NodeRegistry {
  const x = new NodeRegistry()
  x.register('text', { in: ContentStub })
  return x
}

function renderNode(registry: NodeRegistry, data: Record<string, unknown>): Promise<string> {
  const refOf = (v: unknown) => ({ value: v })
  const types = new Map([
    ['text', { type: 'text', label: '文本', defaultSize: { w: 300, h: 200 } }],
  ])
  const services: Record<string, unknown> = {
    doc: { types, getNode: () => undefined, updateNode: () => {} },
    settings: { get: () => undefined, onChange: () => ({ dispose: () => {} }) },
    selection: { ids: new Set<string>(), has: () => false, onChange: () => () => {} },
  }
  const renderCtx = {
    ctx: { get: (n: string) => services[n], tryGet: (n: string) => services[n] },
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
    viewport: refOf({ x: 0, y: 0, zoom: 1 }),
    flow: { viewport: refOf({ zoom: 1, x: 0, y: 0 }), updateNodeVisualSize: () => {}, getNodeRenderPosition: () => undefined },
  } as unknown as CanvasRenderContext
  const app = createSSRApp({
    render: () =>
      h(BaseNode as never, {
        id: 'n1',
        type: 'text',
        data,
        selected: false,
        connectable: false,
        position: { x: 0, y: 0 },
      }),
  })
  app.provide(RENDER_CONTEXT_KEY, renderCtx)
  return renderToString(app)
}

describe('流式生成：露出正文，只挂状态条', () => {
  const r = makeRegistry()

  it('加载中 + 已有正文 → 出现状态条，不铺全屏加载件', async () => {
    const html = await renderNode(r, {
      text: '这是模型边生成边写进来的正文',
      runState: { status: 'running', progress: 32, message: '生成中…', stats: { chars: 18, tokens: 27 } },
    })
    // 关键：换成顶部状态条，全屏遮罩不再铺 —— 正文因此不会被盖住
    expect(html).toContain('v2-stream-bar')
    expect(html).not.toContain('nls-root is-fill')
  })

  it('状态条把已收 token 数当大数字显示（用户 2026-11-10：20000tokens 那种）', async () => {
    const html = await renderNode(r, {
      text: '一些已经生成的文字',
      runState: { status: 'running', progress: 40, stats: { chars: 9, tokens: 14 } },
    })
    expect(html).toContain('14')
    expect(html).toContain('tokens')
  })

  it('加载中但还没有正文 → 仍然全屏加载件（没内容可看）', async () => {
    const html = await renderNode(r, {
      text: '',
      runState: { status: 'running', progress: 5, message: '正在连接模型…' },
    })
    expect(html).toContain('nls-root is-fill')
    expect(html).not.toContain('v2-stream-bar')
  })
})
