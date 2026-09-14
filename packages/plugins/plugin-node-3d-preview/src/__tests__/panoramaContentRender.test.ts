/**
 * PanoramaContent 渲染契约（SSR 拿真 HTML 断言，不启 WebGL）。
 *
 * 用户的要求（原话）："3D 预览节点这个地方也有 2 种模式的，也是双击进入，进入之后可以转动视角，
 * 默认模式下是用来拖拽节点的"。
 *
 * 模式切换最终落在**画面容器上的类名/样式**上（预览模式不吃指针事件 → 事件穿透下去 = 拖节点；
 * 交互模式才挂 nodrag/nopan/nowheel → 拖拽转视角、滚轮改视野角）。这类"模板有没有接对"
 * 的错，只测内部 computed 是看不出来的，所以这里直接断言渲染出来的属性。
 * onMounted 里的 three 初始化在 SSR 不会执行，因此本测试不需要 WebGL。
 */
import { describe, it, expect, afterEach } from 'vitest'
import { createSSRApp, h, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { RENDER_CONTEXT_KEY, type CanvasRenderContext } from '@mini-canvas/canvas-render'
import PanoramaContent from '../PanoramaContent.vue'
import { beginInteract, enterFullscreen, resetInteractSessions } from '../panoramaSession'

/**
 * 最小渲染上下文：组件用到 ctx.get('panorama3d'/'settings')、ctx.on（画布点空白事件）
 * 以及只读的 renderEdges/renderNodes（算上游贴图）。
 */
function renderCtx(): CanvasRenderContext {
  return {
    ctx: {
      get: () => undefined,
      on: () => () => {},
    },
    viewport: { value: { zoom: 1 } },
    renderNodes: { value: [] },
    renderEdges: { value: [] },
  } as unknown as CanvasRenderContext
}

function render(id: string, data: Record<string, unknown> = {}): Promise<string> {
  const app = createSSRApp({ render: () => h(PanoramaContent as Component, { id, data }) })
  app.provide(RENDER_CONTEXT_KEY, renderCtx())
  return renderToString(app)
}

afterEach(() => resetInteractSessions())

/** 取出「3D 画面容器」那一个标签：模式差别全落在它的类名/样式上 */
function surfaceTag(html: string): string {
  const match = html.match(/<div[^>]*pano-surface[^>]*>/)
  if (!match) throw new Error('渲染结果里找不到 3D 画面容器')
  return match[0]
}

describe('预览模式（默认）：用来拖节点', () => {
  it('画面容器不吃指针事件（事件穿透下去，按住就能拖节点）', async () => {
    const html = await render('p1')
    expect(html).toContain('data-mode="preview"')
    expect(html).toContain('pointer-events:none')
  })

  it('不挂 nodrag/nopan/nowheel —— 否则节点就拖不动、画布也滚不动了', async () => {
    const html = await render('p1')
    // 只看画面容器自己：模板注释里也提到了这几个类名，不能拿整份 HTML 去搜
    expect(surfaceTag(html)).not.toContain('nodrag')
    expect(surfaceTag(html)).not.toContain('nowheel')
  })

  it('重置按钮不出现（它会盖在画面上挡住拖节点的起手）', async () => {
    expect(await render('p1')).not.toContain('重置视角')
  })
})

describe('交互模式（双击进入）：用来转视角', () => {
  it('画面接管指针，并挂齐 nodrag/nopan/nowheel', async () => {
    beginInteract('p1')
    const html = await render('p1')
    expect(html).toContain('data-mode="interactive"')
    expect(html).toContain('nodrag')
    expect(html).toContain('nopan')
    expect(html).toContain('nowheel')
    expect(html).not.toContain('pointer-events:none')
  })

  it('不再有任何常驻按钮/提示（用户要求删掉：提醒会遮挡视线、重置改走 r 快捷键）', async () => {
    beginInteract('p1')
    const html = await render('p1')
    expect(html).not.toContain('重置视角')
    expect(html).not.toContain('pano-hint')
    // 画面上不再叠任何按钮（"应用地址"那个按钮属于未贴图时的占位表单，不是画面装饰）
    expect(html).not.toContain('pano-reset')
  })

  it('按节点隔离：另一个节点还在预览模式', async () => {
    beginInteract('p1')
    const other = await render('p2')
    expect(other).toContain('data-mode="preview"')
    expect(other).toContain('pointer-events:none')
  })
})

describe('没贴图时的占位', () => {
  it('占位说明与地址输入框都在，且提示不重复叠"双击进入"', async () => {
    const html = await render('p1')
    expect(html).toContain('把图片节点连进来，或填图片地址')
    expect(html).toContain('aria-label="全景图地址"')
    expect(html).not.toContain('双击进入交互')
  })
})

describe('全屏（f 命令切换）', () => {
  it('预览模式不渲染全屏层（没按 f 就不该有全屏遮罩）', async () => {
    expect(await render('p1')).not.toContain('pano-fullscreen')
  })

  it('进入全屏 → 节点内画面仍是\"接管指针\"态（全屏时 canvas 被搬走，这里不能退回成拖节点态）', async () => {
    enterFullscreen('p1')
    const html = await render('p1')
    expect(html).toContain('data-mode="fullscreen"')
    expect(surfaceTag(html)).toContain('nowheel')
  })
})
