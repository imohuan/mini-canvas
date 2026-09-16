/**
 * 图片节点上下状态栏的渲染契约（用户可见行为）。
 *
 * 用户的原始要求："图片节点的顶部和底部都有一个状态栏"；随后对底部的具体要求是
 * "按 V1 做成生成图片的控制栏"——素材行 + 大输入框 + 模型/参数下拉 + 发送按钮。
 *
 * 这条测试锁"到底有没有渲染出来"：不能只测内部 computed，模板写错、下拉没渲出来、
 * 没工具时留一片空白，这些只有真拿 SSR 出来的 HTML 才看得见。
 *
 * 两点说明：
 * - 上传/裁剪/生成的**真实行为**由 imageOps / imageRun / panelSource 的纯逻辑测试覆盖，
 *   SSR 不做真实交互（也没有 DOM），这里只验渲染、可达性与文案；
 * - 渲染上下文用最小假 ctx 注入（含一个假的工具服务），组件只用到 ctx.get / ctx.tools 与 selection。
 */
import { describe, it, expect } from 'vitest'
import { createSSRApp, h, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { RENDER_CONTEXT_KEY, type CanvasRenderContext } from '@mini-canvas/canvas-render'
import type { ToolDef } from '@mini-canvas/kernel'
import ImageTopToolbar from '../ImageTopToolbar.vue'
import ImageGeneratePanel from '../ImageGeneratePanel.vue'

const IMG = 'data:image/png;base64,iVBORw0KGgo='

/** 假的出图工具：带一条比例参数（用于验证"参数下拉是照工具声明长出来的"） */
const DEMO_TOOL: ToolDef = {
  name: 'image.generate:demo',
  title: '示例出图',
  group: '图片生成',
  produces: 'image',
  accepts: ['image', 'text'],
  params: [
    {
      key: 'ratio',
      label: '比例',
      type: 'select',
      default: '1:1',
      options: [
        { label: '1:1', value: '1:1' },
        { label: '16:9', value: '16:9' },
      ],
    },
  ],
  run: () => ({ ok: true, urls: ['out.png'] }),
}

/**
 * 最小渲染上下文：组件用到的只有 ctx.get('selection'/'nodeStore'/'graph')、ctx.tools 与 viewport
 * 以及只读的 renderNodes/renderEdges（算上游素材）。完整 CanvasRenderContext 有 20+ 个字段
 * （宿主级能力），测试里只桩出被用到的几个，故显式断言类型——这是"最小桩"的刻意取舍，不是漏写。
 */
function renderCtx(
  selectedIds: string[] = [],
  tools: ToolDef[] = [],
  settings?: { get(key: string): unknown },
): CanvasRenderContext {
  const selected = new Set(selectedIds)
  const services: Record<string, unknown> = {
    // 忠实于内核 SelectionService 的最小形状：**必须有 ids**——控制栏的显隐判定是
    // "恰好选中一个且是我"（多选要全部收起），只看 has 是过去的 bug，桩件不该再掩盖它。
    selection: {
      ids: selected,
      has: (id: string) => selected.has(id),
      onChange: () => () => {},
    },
    nodeStore: { getNode: () => undefined },
    graph: { updateNode: () => {} },
    ...(settings ? { settings: { ...settings, onChange: () => ({ dispose: () => {} }) } } : {}),
  }
  return {
    ctx: {
      get: (name: string) => services[name],
      // 面板只认 ctx.tools 的 list/invoke（与内核 PluginCapabilities['tools'] 同形）
      tools: {
        list: () => tools,
        invoke: async () => ({ ok: false, error: '测试里不真调工具' }),
      },
    },
    viewport: { value: { zoom: 1 } },
    renderNodes: { value: [] },
    renderEdges: { value: [] },
  } as unknown as CanvasRenderContext
}

function render(
  comp: Component,
  id: string,
  data: Record<string, unknown>,
  selected: boolean,
  tools: ToolDef[] = [],
  settings?: { get(key: string): unknown },
): Promise<string> {
  const app = createSSRApp({ render: () => h(comp, { id, data }) })
  app.provide(RENDER_CONTEXT_KEY, renderCtx(selected ? [id] : [], tools, settings))
  return renderToString(app)
}

/** 渲染时**指定整份选中集**（用于多选场景：选中集里不止我一个） */
function renderManySelected(
  comp: Component,
  id: string,
  data: Record<string, unknown>,
  selectedIds: string[],
  tools: ToolDef[] = [],
): Promise<string> {
  const app = createSSRApp({ render: () => h(comp, { id, data }) })
  app.provide(RENDER_CONTEXT_KEY, renderCtx(selectedIds, tools))
  return renderToString(app)
}

describe('图片节点顶部操作条', () => {
  it('未选中 → 不渲染', async () => {
    const html = await render(ImageTopToolbar as Component, 'i1', { imageUrl: IMG }, false)
    expect(html).not.toContain('it-root')
  })

  it('多选 → 不渲染（多选时上下控制栏一起收起，用户明确要求）', async () => {
    const html = await renderManySelected(ImageTopToolbar as Component, 'i1', { imageUrl: IMG }, ['i1', 'i2'])
    expect(html).not.toContain('it-root')
  })

  it('选中 → 渲染上传按钮（带无障碍标签与文件选择框）', async () => {
    const html = await render(ImageTopToolbar as Component, 'i1', {}, true)
    expect(html).toContain('it-root')
    expect(html).toContain('aria-label="上传图片"')
    expect(html).toContain('type="file"')
  })

  it('有图时才有裁剪入口；无图时不渲染一个点了没反应的按钮', async () => {
    const withImage = await render(ImageTopToolbar as Component, 'i1', { imageUrl: IMG }, true)
    expect(withImage).toContain('aria-label="裁剪图片"')

    const withoutImage = await render(ImageTopToolbar as Component, 'i1', { imageUrl: '' }, true)
    expect(withoutImage).not.toContain('aria-label="裁剪图片"')
    expect(withoutImage).toContain('aria-label="上传图片"')
  })

  it('定位不再由本组件负责（贴边/居中/反缩放都在壳的上插槽定位层）', async () => {
    // 用户要求："定位交给 BaseNode 而不是单独的组件"。
    // 这里锁"插件组件里没有 position/transform" —— 定位一旦被抄回插件就会互相漂移，
    // 正是这次要根治的问题。壳那一侧的取值由 baseNodeSlotsRender.test.ts 与
    // canvas-render 的 resolveNodeSlotStyle 单测负责。
    const html = await render(ImageTopToolbar as Component, 'i1', {}, true, [], {
      get: (k) => (k === 'toolbarTopOffset' ? 20 : undefined),
    })
    expect(html).not.toContain('transform:')
    expect(html).not.toContain('calc(100%')
    expect(html).toContain('it-root')
  })
})

describe('图片节点底部生成面板', () => {
  it('未选中 → 不渲染（面板只在选中时浮出）', async () => {
    const html = await render(ImageGeneratePanel as Component, 'i1', {}, false, [DEMO_TOOL])
    expect(html).not.toContain('ig-root')
  })

  it('多选 → 不渲染（两个及以上被选中时全部收起，避免多份面板互相叠）', async () => {
    // 用户报的 bug：框选多个节点时每个节点都弹出一份控制栏
    const html = await renderManySelected(ImageGeneratePanel as Component, 'i1', {}, ['i1', 'i2'], [DEMO_TOOL])
    expect(html).not.toContain('ig-root')
  })

  it('选中 → 素材行、输入框、模型下拉、发送按钮都在', async () => {
    const html = await render(ImageGeneratePanel as Component, 'i1', {}, true, [DEMO_TOOL])
    expect(html).toContain('ig-root')
    // 素材行末尾的「加素材」入口（点击选本地图）
    expect(html).toContain('aria-label="添加素材"')
    // 大输入框：富文本编辑器挂载点（placeholder 里带 @ 引用说明）
    expect(html).toContain('prose-mirror-editor')
    expect(html).toContain('@ 引用素材')
    // 模型下拉 + 该模型声明的参数下拉：走项目统一 Select（.sel-trigger 是它的触发器类名），
    // 用户明确要求"下拉不要用原生的" —— 这里连原生 select 标签都不该出现
    expect(html).toContain('sel-trigger')
    expect(html).not.toContain('<select')
    // 字段数 = 模型 + 比例（Select 内部会渲染 wrap/trigger 两层类名，故按面板字段容器计数）
    expect(html.match(/class="ig-field"/g)?.length).toBe(2)
    // 发送按钮
    expect(html).toContain('发送')
  })

  it('模型下拉显示当前工具的标题（选项来自工具列表）', async () => {
    const html = await render(ImageGeneratePanel as Component, 'i1', {}, true, [DEMO_TOOL])
    expect(html).toContain('示例出图')
  })

  it('参数下拉按工具声明的 params 长出来（默认值显示在触发框上）', async () => {
    const html = await render(ImageGeneratePanel as Component, 'i1', {}, true, [DEMO_TOOL])
    expect(html).toContain('1:1')
    expect(html.match(/class="ig-field"/g)?.length).toBe(2)
  })

  it('没有可用工具 → 给出明确空态文案，且发送按钮真的被禁用（不是点了一片空白）', async () => {
    const html = await render(ImageGeneratePanel as Component, 'i1', {}, true, [])
    expect(html).toContain('ig-root')
    expect(html).toContain('没有可用的生成工具')
    expect(html).toContain('无可用工具')
    expect(html).toMatch(/class="ig-send[^"]*"[^>]*disabled/)
  })

  it('工具没声明参数 → 只渲染一个模型下拉（参数下拉照声明长，不写死）', async () => {
    const noParams = { ...DEMO_TOOL, params: undefined }
    const html = await render(ImageGeneratePanel as Component, 'i1', {}, true, [noParams])
    expect(html.match(/class="ig-field"/g)?.length).toBe(1)
    expect(html).not.toContain('1:1')
  })

  it('既有能力仍在：旋转/下载按钮在，且无图时禁用', async () => {
    const html = await render(ImageGeneratePanel as Component, 'i1', {}, true, [DEMO_TOOL])
    expect(html).toContain('aria-label="顺时针旋转 90°"')
    expect(html).toContain('aria-label="下载图片"')
    expect(html).toContain('disabled')
  })

  it('图标按钮走通用 NodeToolbarButton（不再各自抄一份 .ig-icon-btn）', async () => {
    // 用户要求"实现一个通用的按钮"：三处自绘拷贝必须收成一份，否则数值迟早漂移。
    const html = await render(ImageGeneratePanel as Component, 'i1', {}, true, [DEMO_TOOL])
    expect(html).toContain('ntb-btn')
    expect(html).not.toContain('ig-icon-btn')
  })

  it('有图时下载按钮的提示里带文件名与尺寸（元信息不至于丢掉）', async () => {
    const html = await render(
      ImageGeneratePanel as Component,
      'i1',
      { imageUrl: IMG, imageName: '风景.png', imageWidth: 1920, imageHeight: 1080 },
      true,
      [DEMO_TOOL],
    )
    expect(html).toContain('风景.png')
    expect(html).toContain('1920×1080')
  })

  it('宽度来自配置（读到 800 就用 800），定位仍不在本组件（贴边/居中/反缩放归壳）', async () => {
    const custom = await render(ImageGeneratePanel as Component, 'i1', {}, true, [DEMO_TOOL], {
      get: (k) => (k === 'panelImageWidth' ? 800 : undefined),
    })
    expect(custom).toContain('width:800px')
    // 定位一旦被抄回插件就会与壳漂移 —— 这正是本次要根治的，故反向锁住
    // （只查定位层那几个声明；面板内部元素自身的 translateX 居中不在此列）
    expect(custom).not.toContain('calc(100%')
    expect(custom).not.toMatch(/class="ig-root[^"]*"[^>]*style="[^"]*(translateX\(-50%\)|scale\()/)
  })
})
