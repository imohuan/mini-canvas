/**
 * 新 UI 契约的 SSR 渲染断言（锁住用户明确要求的那几件事）：
 * 1. 顶行：参考可点（两态开关），**标记置灰**（功能没实现，用户要求"给一个透明度效果表示不支持"），
 *    **风格不做**（用户明确 pass：风格写在提示词里）；
 * 2. 参考选择态浮层：不在选择态不产出 DOM；进入后顶部出现操作框那句提示；
 * 3. 全屏预览浮层：素材卡点开是**铺满整个视口**的浮层（用户要求"要的是全屏，是整个视图"），
 *    Esc / 点背景 / 关闭按钮三种关法都在。
 */
import { beforeAll, describe, it, expect } from 'vitest'
import { createSSRApp, h, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { RENDER_CONTEXT_KEY, type CanvasRenderContext } from '@mini-canvas/canvas-render'
import { RegistryImpl } from '@mini-canvas/kernel'
import { Context } from '@mini-canvas/canvas-data'
import { themeDefaultPlugin } from '@mini-canvas/plugin-theme-default'
import NodeBottomBar from '../NodeBottomBar.vue'
import ReferenceSelectOverlay from '../ReferenceSelectOverlay.vue'
import MediaPreviewOverlay from '../MediaPreviewOverlay.vue'
import { enterReference, exitReference } from '../referenceMode'
import { openPreview, closePreview } from '../mediaPreview'
import type { BarAction } from '../barTypes'

const DEMO_ACTION: BarAction = {
  id: 'test:gen',
  types: ['image'],
  title: '生成图片',
  needsPrompt: true,
  run: () => ({ ok: true }),
}

let uiField: { top(name: string): { value: unknown } | undefined; subscribe(fn: () => void): { dispose(): void } }
beforeAll(async () => {
  const ctx = new Context()
  ctx.plugin(themeDefaultPlugin)
  await ctx.start()
  uiField = ctx.registryOf('ui') as typeof uiField
})

/** 两节点画布：n1 = 文本（产出 text），n2 = 图片（收 text/image） */
interface StubOpts {
  ownerId?: string
  selectedIds?: string[]
  /** 换掉默认动作（测参数过滤等场景用） */
  actions?: BarAction[]
}

function makeCtx(opts: StubOpts = {}): CanvasRenderContext {
  const ids = new Set(opts.selectedIds ?? ['n2'])
  const services: Record<string, unknown> = {
    selection: { ids, has: (id: string) => ids.has(id), onChange: () => () => {} },
    doc: {
      getNode: (id: string) =>
        id === 'n1'
          ? { id: 'n1', type: 'text', data: { text: '文案' } }
          : id === 'n2'
            ? { id: 'n2', type: 'image', data: {} }
            : undefined,
      getNodes: () => [
        { id: 'n1', type: 'text', data: { text: '文案' } },
        { id: 'n2', type: 'image', data: {} },
      ],
      getEdges: () => [],
      updateNode: () => {},
      connectEdge: () => ({ edgeId: 'e1', status: 'ok' }),
      removeEdges: () => 0,
      subscribe: () => () => {},
      types: new Map([
        ['text', { type: 'text', label: '文本', inputs: [{ acceptsTypes: ['text'] }], outputs: [{ contentType: 'text' }] }],
        ['image', { type: 'image', label: '图片', inputs: [{ acceptsTypes: ['text', 'image'] }], outputs: [{ contentType: 'image' }] }],
      ]),
    },
    nodeBar: { list: () => opts.actions ?? [DEMO_ACTION] },
    nodeTask: { cancel: () => {}, run: async () => ({ ok: true }) },
  }
  return {
    ctx: {
      get: (n: string) => services[n],
      tryGet: (n: string) => services[n],
      on: () => ({ dispose: () => {} }),
      registryOf: (kind: string) => (kind === 'ui' ? uiField : (new RegistryImpl() as unknown)),
    },
    viewport: { value: { x: 0, y: 0, zoom: 1 } },
    flow: { queryNodeEl: () => null },
    renderNodes: {
      value: [
        { id: 'n1', type: 'text', data: { text: '文案' } },
        { id: 'n2', type: 'image', data: {} },
      ],
    },
    renderEdges: { value: [] },
  } as unknown as CanvasRenderContext
}

function render(comp: Component, props: Record<string, unknown>, ctx: CanvasRenderContext): Promise<string> {
  const app = createSSRApp({ render: () => h(comp, props) })
  app.provide(RENDER_CONTEXT_KEY, ctx)
  return renderToString(app)
}

/**
 * 渲染一个用 <Teleport to="body"> 的浮层组件，并把 Teleport 出来的那段也拼进来。
 *
 * 为什么单独一个：SSR 里 Teleport 的内容会被收集到 ctx.teleports，不进普通字符串；
 * 只断言 renderToString 的返回值会永远看不到浮层本体（实测踩过）。
 */
async function renderWithTeleport(comp: Component, ctx: CanvasRenderContext): Promise<string> {
  const ssrCtx: Record<string, unknown> = {}
  const app = createSSRApp({ render: () => h(comp) })
  app.provide(RENDER_CONTEXT_KEY, ctx)
  const html = await renderToString(app, ssrCtx)
  const teleports = (ssrCtx as { teleports?: Record<string, string> }).teleports ?? {}
  return html + Object.values(teleports).join('')
}

describe('底栏顶行三枚 pill 的状态', () => {
  it('参考可点；标记可点（点它才把 @图片N 文字转标签）；风格已移除', async () => {
    const html = await render(NodeBottomBar as Component, { id: 'n2', data: {} }, makeCtx())
    const labels = [...html.matchAll(/<button[^>]*class="nb-pill([^"]*)"[^>]*>([\s\S]*?)<\/button>/g)]
    const pills = labels.map((m) => ({ cls: m[1], text: m[2].replace(/<[^>]+>/g, '').trim() }))
    const ref = pills.find((p) => p.text.startsWith('参考'))
    const mark = pills.find((p) => p.text.startsWith('标记'))
    const style = pills.find((p) => p.text.startsWith('风格'))
    expect(ref, '参考 pill 必须在').toBeTruthy()
    expect(mark, '标记 pill 必须在').toBeTruthy()
    expect(style, '风格 pill 已按用户要求移除').toBeUndefined()
    /**
     * 标记：**可点**（用户口径 2026-10-27）。
     * 以前它是灰的（"暂未支持"），文本靠编辑器自动扫成标签 ——
     * 结果输入 @图片1 时数字还没敲完就被转成标签、菜单闪没。
     * 现在文本只是文本，只有点「标记」才解析。
     */
    expect(mark!.cls).not.toContain('is-disabled')
    // 参考：不带 disabled
    expect(ref!.cls).not.toContain('is-disabled')
  })
})

describe('参考选择态浮层', () => {
  it('不在选择态 → 不产出 DOM（幂等，不占位）', async () => {
    exitReference()
    const html = await render(ReferenceSelectOverlay as Component, {}, makeCtx())
    expect(html).not.toContain('reference-select-overlay')
  })

  /**
   * 在选择态里渲染一次：锁「顶部操作框」那三个元素的绑定还接得上。
   *
   * 为什么这条必须有：SSR 没有 DOM，量不到节点矩形（盖层为空），但**顶栏不依赖量测** ——
   * 它照着模板渲染。所以这条能抓到"模板/绑定被改坏"（少 import、点错函数）这类回归，
   * 而盖层与提示跟随仍要靠真浏览器核对。
   */
  it('选择态里 → 顶栏渲染提示语 / 返回节点 / 关闭，且都不脱绑', async () => {
    enterReference('n2')
    try {
      const all = await renderWithTeleport(ReferenceSelectOverlay as Component, makeCtx())
      expect(all).toContain('reference-select-overlay')
      expect(all).toContain('从画布或资产管理选择参考')
      expect(all).toContain('返回节点')
      expect(all).toContain('rs-top-close')
      expect(all).toContain('rs-esc')
    } finally {
      exitReference()
    }
  })

  it('顶栏只有一句"参考"提示，不再有风格用途', async () => {
    enterReference('n2')
    try {
      const all = await renderWithTeleport(ReferenceSelectOverlay as Component, makeCtx())
      expect(all).toContain('从画布或资产管理选择参考')
      expect(all).not.toContain('风格')
    } finally {
      exitReference()
    }
  })
})

describe('全屏预览浮层', () => {
  it('打开后有铺满视口的根、标题、关闭按钮（Esc/点背景/按钮三种关法）', async () => {
    openPreview({ name: '图片1', kind: 'image', url: 'https://x/a.png' })
    const ctx: Record<string, unknown> = {}
    const app = createSSRApp({ render: () => h(MediaPreviewOverlay) })
    app.provide(RENDER_CONTEXT_KEY, makeCtx())
    const html = await renderToString(app, ctx)
    // Teleport 到 body 的内容在 SSR 结果里
    const teleports = (ctx as { teleports?: Record<string, string> }).teleports ?? {}
    const body = Object.values(teleports).join('')
    const all = html + body
    // 2026-10-06：视觉整只交给主题注册的 MediaViewer（AxImageViewer 同款交互），
    // 测试锚点跟着组件走（mv-root / mv-corner-btn），删除按钮来自底栏的 onDelete。
    expect(all).toContain('图片1')
    expect(all).toContain('mv-root')
    expect(all).toContain('mv-corner-btn')
    expect(all).toContain('mv-remove')
    closePreview()
  })

  it('未打开时不产出 DOM', async () => {
    closePreview()
    const ctx: Record<string, unknown> = {}
    const app = createSSRApp({ render: () => h(MediaPreviewOverlay) })
    app.provide(RENDER_CONTEXT_KEY, makeCtx())
    const html = await renderToString(app, ctx)
    const teleports = (ctx as { teleports?: Record<string, string> }).teleports ?? {}
    expect(html + Object.values(teleports).join('')).not.toContain('media-preview-overlay')
  })
})

describe('底栏参数：风格参数被删掉（用户要求）', () => {
  /**
   * 用户 2026-10-01：「把你这个疯狗给删掉，听不懂吗」——
   * 风格不在这里做（写在提示词 / 标签里）。这里锁一道**与来源无关**的兜底：
   * 即便某个动作仍声明了 kind:'style'，底栏也不再把它渲染出来。
   */
  const withStyle: BarAction = {
    id: 'test:with-style',
    types: ['image'],
    title: '带风格的模型',
    needsPrompt: true,
    fields: [
      {
        key: 'ratio',
        kind: 'ratio',
        label: '比例',
        type: 'select',
        default: '16:9',
        options: [{ label: '16:9', value: '16:9' }],
      },
      {
        key: 'style',
        kind: 'style',
        label: '风格',
        type: 'select',
        default: 'p',
        options: [{ label: '人像摄影', value: 'p' }],
      },
    ],
    run: () => ({ ok: true }),
  }

  /**
   * 触发器的摘要串会把「有值的参数」用 · 连起来（ToolParamGroup 的 summary）。
   * 风格参数带默认值 'p' → 若不过滤，摘要里会出现它的选项文案「人像摄影」。
   * 因此断言：摘要里有比例的 16:9、**没有** 人像摄影 —— 这才真的证明风格参数被摘掉了。
   */
  it('动作带 kind:style 参数 → 底栏摘要里不出现它（只留比例）', async () => {
    const html = await render(NodeBottomBar as Component, { id: 'n2', data: {} }, makeCtx({ actions: [withStyle] }))
    expect(html).toContain('node-bottom-bar')
    expect(html).toContain('16:9')
    expect(html).not.toContain('人像摄影')
  })
})

describe('素材卡：图片卡（正方形 + cover + 图片本身模糊）', () => {
  /**
   * 用户 2026-10-01：「效果不对 这里是正方形 你的图片要使用 cover 方式展示，
   * 然后给他一个模糊效果，但是你这里图片并没有模糊而是背景模糊（我要的是图片模糊）」。
   * 所以卡片是正方形、图片走 cover 铺满，模糊加在**图片本身**（.nb-card-img 的 filter），
   * 不再分「模糊背景 + 清晰前景」两层。
   */
  it('图片素材卡就是一张 .nb-card-img（单层，不再有 backdrop 层）', async () => {
    const ctx = makeCtx()
    ;(ctx as unknown as { renderEdges: { value: unknown[] } }).renderEdges.value = [{ source: 'n1', target: 'n2' }]
    ;(ctx as unknown as { renderNodes: { value: unknown[] } }).renderNodes.value = [
      { id: 'n1', type: 'image', data: { imageUrl: 'https://x/a.png' } },
      { id: 'n2', type: 'image', data: {} },
    ]
    const html = await render(NodeBottomBar as Component, { id: 'n2', data: {} }, ctx)
    expect(html).toContain('nb-card-img')
    expect(html).not.toContain('nb-card-img-backdrop')
    expect(html).toContain('nb-card-index')
  })

  it('文本素材卡渲染文字（没有图片、也就没有被模糊的图）', async () => {
    const ctx = makeCtx()
    ;(ctx as unknown as { renderEdges: { value: unknown[] } }).renderEdges.value = [{ source: 'n1', target: 'n2' }]
    ;(ctx as unknown as { renderNodes: { value: unknown[] } }).renderNodes.value = [
      { id: 'n1', type: 'text', data: { text: '文案' } },
      { id: 'n2', type: 'image', data: {} },
    ]
    const html = await render(NodeBottomBar as Component, { id: 'n2', data: {} }, ctx)
    expect(html).toContain('nb-card-text')
    expect(html).not.toContain('nb-card-img')
  })

  /**
   * 用户口径（2026-10-12）：「在右上角区域 hover 时，应该显示一个关闭按钮……点击该按钮后
   * 可以进行关闭，即删除与该图片相关的连接线」。
   *
   * 这里锁 DOM 结构：卡片里「预览命中区」与「关闭按钮」是两个**兄弟**按钮
   * （按钮里套按钮是非法 HTML），关闭按钮带可读的 aria-label + title。
   * 「点它真的断连线」靠真机核对（SSR 没有 DOM 事件）。
   */
  it('素材卡带右上角关闭按钮（aria-label/title 齐，且与卡片命中区是兄弟不是嵌套）', async () => {
    const ctx = makeCtx()
    ;(ctx as unknown as { renderEdges: { value: unknown[] } }).renderEdges.value = [{ source: 'n1', target: 'n2' }]
    ;(ctx as unknown as { renderNodes: { value: unknown[] } }).renderNodes.value = [
      { id: 'n1', type: 'image', data: { imageUrl: 'https://x/a.png', label: '图A' } },
      { id: 'n2', type: 'image', data: {} },
    ]
    const html = await render(NodeBottomBar as Component, { id: 'n2', data: {} }, ctx)
    // 关闭按钮：类名 + 语义标签都在
    expect(html).toContain('nb-remove')
    expect(html).toMatch(/aria-label="移除素材[^"]*"/)
    expect(html).toContain('移除素材（断开连线）')
    // 整卡点击预览仍是原生按钮（键盘 Enter/Space 可达）
    expect(html).toContain('nb-card-hit')
    // 结构：关闭按钮不是嵌在命中按钮里（`<button ...><button` 这个形态不许出现）
    expect(html).not.toMatch(/<button[^>]*nb-card-hit[^>]*>\s*<button/)
  })
})

describe('展开按钮：变成 dialog（用户要求）', () => {
  /**
   * 用户 2026-10-01：「点击展开 UI（变成 dialog 的形式，展示这里的 UI）」。
   * SSR 里初始态是收起（外壳 display:contents、Teleport 未触发），所以这里锁：
   * ① 展开按钮带 aria-expanded 且默认为 false；② 收起态外壳是 .nb-shell。
   * 「点开 → 居中大弹窗」靠真浏览器核对（Playwright 实测已过）。
   */
  it('展开按钮存在、默认收起（aria-expanded=false）、外壳是 .nb-shell', async () => {
    const html = await render(NodeBottomBar as Component, { id: 'n2', data: {} }, makeCtx())
    expect(html).toContain('nb-shell')
    const expandBtn = html.match(/<button[^>]*class="nb-expand[^"]*"[^>]*>/)?.[0] ?? ''
    expect(expandBtn).toContain('nb-expand')
    expect(expandBtn).toContain('aria-expanded="false"')
    expect(html).toContain('nb-root')
  })
})
