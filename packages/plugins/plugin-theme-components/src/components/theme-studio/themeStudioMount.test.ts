/**
 * 卸载 demo-kit 之后，颜色配方必须仍然能在设置里出现。
 *
 * 这条是真实回归：之前「主题工作台」这一节的 Config 分组由 demo-kit 提供，
 * 卸掉它就整节消失（分组不存在 → 菜单过滤掉）。现在分组跟着默认主题走。
 */
import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { Context } from '@mini-canvas/canvas-data'
import { RENDER_CONTEXT_KEY, type CanvasRenderContext } from '@mini-canvas/canvas-render'
import { themeComponentsPlugin } from '../../index'
import PluginSettingsContent from '../settings/PluginSettingsContent.vue'

function renderCtx(ctx: Context): CanvasRenderContext {
  return {
    ctx,
    viewport: { value: { x: 0, y: 0, zoom: 1 } },
    renderNodes: { value: [] },
    renderEdges: { value: [] },
  } as unknown as CanvasRenderContext
}

describe('只装默认主题时的颜色配方', () => {
  it('设置里仍能渲染出「主题工作台」（颜色配方）整页', async () => {
    const ctx = new Context()
    // 只装默认主题：不装 demo-kit，也不装多选/对齐/切割
    ctx.plugin(themeComponentsPlugin)
    await ctx.start()

    // 分组必须存在，否则设置菜单会整节过滤掉
    expect(ctx.get('settings').groups()).toContain('主题工作台')

    const app = createSSRApp({
      render: () => h(PluginSettingsContent, { settings: ctx.get('settings') }),
    })
    app.provide(RENDER_CONTEXT_KEY, renderCtx(ctx))
    const html = await renderToString(app)

    // 正文渲染出来了（不是空的占位），并且关键结构都在
    expect(html).toContain('颜色配方')
    expect(html).toContain('主题模板')
    expect(html).toContain('自定义')
    expect(html).toContain('实时预览')
    // 颜色配方接管配色后，零散的「主题配色 / 暗色主题配色」两节应被隐藏
    expect(html).not.toContain('暗色主题配色')
    // 但配方自己的色签仍在（字段没被隐藏影响）
    expect(html).toContain('studio-swatch')
    ctx.stop()
  })
})
