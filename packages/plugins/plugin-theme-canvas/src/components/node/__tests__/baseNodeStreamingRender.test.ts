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

function renderNode(
  registry: NodeRegistry,
  data: Record<string, unknown>,
  /** 额外注入的服务（例如 nodeTask：取消按钮要不要画靠它回答） */
  extraServices: Record<string, unknown> = {},
): Promise<string> {
  const refOf = (v: unknown) => ({ value: v })
  const types = new Map([
    ['text', { type: 'text', label: '文本', defaultSize: { w: 300, h: 200 } }],
  ])
  const services: Record<string, unknown> = {
    doc: { types, getNode: () => undefined, updateNode: () => {} },
    settings: { get: () => undefined, onChange: () => ({ dispose: () => {} }) },
    selection: { ids: new Set<string>(), has: () => false, onChange: () => () => {} },
    ...extraServices,
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

describe('加载 UI：全局唯一一件，字段由后台给', () => {
  const r = makeRegistry()

  /**
   * 用户口径 2026-11-10：加载 UI 是全局唯一的一件，不许在它之外再画自己的状态条。
   * 之前「加载中 + 有正文」会换成顶部小胶囊，那是多画了一套 —— 已删除。
   */
  it('加载中（有正文也一样）只画全局加载件，不出现第二套 UI', async () => {
    const html = await renderNode(r, {
      text: '这是模型边生成边写进来的正文',
      runState: { status: 'running', progress: 32, message: '生成中…' },
    })
    expect(html).toContain('nls-root is-fill')
    expect(html).not.toContain('v2-stream-bar')
    // 整个覆盖层里只有一份加载件
    expect(html.match(/nls-root/g) ?? []).toHaveLength(1)
  })

  /** 后台给什么就画什么（value + suffix），超过 100 不封顶 */
  it('后台给 value=451 + suffix=tokens → 照实显示 451tokens', async () => {
    const html = await renderNode(r, {
      text: '一些已经生成的文字',
      runState: { status: 'running', progress: 60, value: 451, suffix: 'tokens' },
    })
    expect(html).toContain('451')
    expect(html).toContain('tokens')
  })

  it('后台给 value=0 也照画（提交那一帧的 0tokens）', async () => {
    const html = await renderNode(r, {
      text: '',
      runState: { status: 'running', progress: 0, value: 0, suffix: 'tokens' },
    })
    expect(html).toContain('0')
    expect(html).toContain('tokens')
  })

  /** 没给 value 的动作（图片 / 视频）继续用百分比，行为不变 */
  it('后台没给 value → 仍然按百分比画', async () => {
    const html = await renderNode(r, {
      text: '',
      runState: { status: 'running', progress: 42 },
    })
    expect(html).toContain('42')
    expect(html).toContain('%')
  })

  /** progressText 优先于 value + suffix（后台要显示任意说法时用） */
  it('后台给 progressText → 整段照画，优先于 value/suffix', async () => {
    const html = await renderNode(r, {
      text: '',
      runState: { status: 'running', progress: 30, value: 12, suffix: 'tokens', progressText: '≈1.2k tokens' },
    })
    expect(html).toContain('≈1.2k tokens')
  })

  /** 后台给的 tail 直接出现在加载件下（前端不再自己去正文末尾抠） */
  it('后台给 tail → 加载件显示这段滚动文字', async () => {
    const html = await renderNode(r, {
      text: '正文很长很长很长',
      runState: { status: 'running', progress: 40, value: 40, suffix: 'tokens', tail: '正在讲这个词的来历' },
    })
    expect(html).toContain('正在讲这个词的来历')
  })

  /**
   * 用户 2026-11-10：有些任务根本没法取消，就不该给一个点了没反应的按钮。
   * 判定交给底栏的 nodeTask.canCancel（它按「动作有没有声明取消」回答）。
   */
  it('★ 动作不支持取消 → 不画取消按钮', async () => {
    const html = await renderNode(
      r,
      { text: '', runState: { status: 'running', progress: 10, value: 3, suffix: 'tokens' } },
      { nodeTask: { cancel: () => {}, canCancel: () => false } },
    )
    expect(html).toContain('nls-root is-fill')
    expect(html).not.toContain('v2-task-cancel')
  })

  it('★ 动作支持取消 → 照常画取消按钮', async () => {
    const html = await renderNode(
      r,
      { text: '', runState: { status: 'running', progress: 10, value: 3, suffix: 'tokens' } },
      { nodeTask: { cancel: () => {}, canCancel: () => true } },
    )
    expect(html).toContain('v2-task-cancel')
  })

  /**
   * 用户口径 2026-11-10：显示依据写在**节点数据**里。
   *
   * 提交任务的一方把 `runState.canCancel` 写进节点，壳原样读它 ——
   * 不查动作表，所以刷新后动作清单还没加载完的那一小会儿也不会误判。
   */
  it('★ 节点数据说能取消 → 画按钮（不看 nodeTask 怎么答）', async () => {
    const html = await renderNode(
      r,
      { text: '', runState: { status: 'running', progress: 10, canCancel: true } },
      { nodeTask: { cancel: () => {}, canCancel: () => false } },
    )
    expect(html).toContain('v2-task-cancel')
  })

  it('★ 节点数据说不能取消 → 不画按钮（哪怕 nodeTask 说能）', async () => {
    const html = await renderNode(
      r,
      { text: '', runState: { status: 'running', progress: 10, canCancel: false } },
      { nodeTask: { cancel: () => {}, canCancel: () => true } },
    )
    expect(html).not.toContain('v2-task-cancel')
  })
})
