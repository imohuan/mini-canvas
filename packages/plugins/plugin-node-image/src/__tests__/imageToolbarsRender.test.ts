/**
 * 图片节点顶部操作条的渲染契约（用户可见行为）。
 *
 * 历史说明：本文件原为「顶部操作条 + 底部生成面板」两段；底部面板搬进
 * plugin-bottom-bar（T8），那段的渲染断言随迁移走（底栏插件的 bottomBarRender.test.ts）。
 *
 * 两点说明：
 * - 上传/裁剪的真实行为由 imageOps 纯逻辑测试覆盖，SSR 不做真实交互（也没有 DOM），
 *   这里只验渲染、可达性与文案；
 * - 渲染上下文用最小假 ctx 注入，组件只用到 ctx.get / ctx.tools 与 selection。
 */
import { beforeAll, describe, it, expect } from 'vitest'
import { createSSRApp, h, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { RENDER_CONTEXT_KEY, type CanvasRenderContext } from '@mini-canvas/canvas-render'
import type { ToolDef } from '@mini-canvas/kernel'
import { RegistryImpl } from '@mini-canvas/kernel'
import { Context } from '@mini-canvas/canvas-data'
// 只导入主题**插件**（走注册流程），不导入它的实现组件（T07）
import { themeDefaultPlugin } from '@mini-canvas/plugin-theme-default'
import ImageTopToolbar from '../ImageTopToolbar.vue'

const IMG = 'data:image/png;base64,iVBORw0KGgo='

/**
 * UI 目录来自**真实主题插件的注册流程**（T07）：不再从主题包 import 组件实现，
 * 而是装载主题插件、从它登记的 ui 目录里按名取。
 */
async function themeUiField(): Promise<{ top(name: string): { value: unknown } | undefined; subscribe(fn: () => void): { dispose(): void } }> {
  const ctx = new Context()
  ctx.plugin(themeDefaultPlugin)
  await ctx.start()
  return ctx.registryOf('ui')
}
let uiFieldShared: { top(name: string): { value: unknown } | undefined; subscribe(fn: () => void): { dispose(): void } }
beforeAll(async () => {
  uiFieldShared = await themeUiField()
})

/** 假的出图工具（顶栏的裁剪比例下拉不读它，桩上只为保持 ctx 形状完整） */
const DEMO_TOOL: ToolDef = {
  name: 'image.generate:demo',
  title: '示例出图',
  group: '图片生成',
  produces: 'image',
  accepts: ['image', 'text'],
  run: () => ({ ok: true, urls: ['out.png'] }),
}

/**
 * 最小渲染上下文：组件用到的只有 ctx.get('selection'/'doc')、ctx.tools 与 viewport。
 */
function renderCtx(selectedIds: string[] = [], tools: ToolDef[] = [], settings?: { get(key: string): unknown }): CanvasRenderContext {
  const selected = new Set(selectedIds)
  const services: Record<string, unknown> = {
    // 忠实于内核 SelectionService 的最小形状：**必须有 ids**——控制栏的显隐判定是
    // "恰好选中一个且是我"（多选要全部收起），只看 has 是过去的 bug，桩件不该再掩盖它。
    selection: {
      ids: selected,
      has: (id: string) => selected.has(id),
      onChange: () => () => {},
    },
    // 5c：读/写都走 doc（老名 nodeStore/graph 已下线）
    doc: { getNode: () => undefined, updateNode: () => {} },
    ...(settings ? { settings: { ...settings, onChange: () => ({ dispose: () => {} }) } } : {}),
  }
  return {
    ctx: {
      get: (name: string) => services[name],
      // 设计系统组件目录（§4.5）：生产由 theme-default 登记；测试里塞真组件，
      // 这样断言锁的是"按名取到的真件渲染出来长什么样"，与生产同形。
      registryOf: (kind: string) => (kind === 'ui' ? uiFieldShared : new RegistryImpl()),
      tools: { list: () => tools, invoke: async () => ({ ok: false, error: '测试里不真调工具' }) },
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

describe('图片节点顶部操作条', () => {
  it('未选中 → 不渲染', async () => {
    const html = await render(ImageTopToolbar as Component, 'i1', { imageUrl: IMG }, false)
    expect(html).not.toContain('it-root')
  })

  it('多选 → 不渲染（多选时上下控制栏一起收起，用户明确要求）', async () => {
    const app = createSSRApp({ render: () => h(ImageTopToolbar as Component, { id: 'i1', data: { imageUrl: IMG } }) })
    app.provide(RENDER_CONTEXT_KEY, renderCtx(['i1', 'i2'], [DEMO_TOOL]))
    const html = await renderToString(app)
    expect(html).not.toContain('it-root')
  })

  it('选中 → 渲染上传按钮（带无障碍标签与文件选择框）', async () => {
    const html = await render(ImageTopToolbar as Component, 'i1', { imageUrl: IMG }, true, [DEMO_TOOL])
    expect(html).toContain('it-root')
    expect(html).toContain('上传图片')
    expect(html).toContain('type="file"')
  })

  it('有图时才有裁剪入口；无图时不渲染一个点了没反应的按钮', async () => {
    const withImg = await render(ImageTopToolbar as Component, 'i1', { imageUrl: IMG }, true, [DEMO_TOOL])
    const without = await render(ImageTopToolbar as Component, 'i1', {}, true, [DEMO_TOOL])
    expect(withImg).toContain('裁剪')
    expect(without).not.toContain('裁剪')
  })

  it('定位不再由本组件负责（贴边/居中/反缩放都在壳的上插槽定位层）', async () => {
    const html = await render(ImageTopToolbar as Component, 'i1', { imageUrl: IMG }, true, [DEMO_TOOL])
    expect(html).not.toContain('position:absolute')
    expect(html).not.toContain('scale(')
  })
})

