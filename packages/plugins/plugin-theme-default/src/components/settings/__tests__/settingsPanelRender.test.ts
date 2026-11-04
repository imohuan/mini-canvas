/**
 * 设置面板真实渲染契约：打开设置不能白屏。
 *
 * 用户实测 2026-11-02：打开设置只看到空白面板，控制台报
 * `ReferenceError: Cannot access 'ue' before initialization`。
 * 根因是 navEntries 的 immediate watch 先执行，而它读取的 navIcons
 * 声明在后面（暂时性死区）。这里用真实内核 + SSR 把这条路径钉住，
 * 只读源码的测试抓不到这种运行时顺序错误。
 */
import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { Context } from '@mini-canvas/canvas-data'
import { RENDER_CONTEXT_KEY, type CanvasRenderContext } from '@mini-canvas/canvas-render'
import { themeDefaultPlugin } from '@mini-canvas/plugin-theme-default'
import PluginSettingsContent from '../PluginSettingsContent.vue'

async function boot(): Promise<Context> {
  const ctx = new Context()
  ctx.plugin(themeDefaultPlugin)
  await ctx.start()
  return ctx
}

function renderCtx(ctx: Context): CanvasRenderContext {
  return {
    ctx,
    viewport: { value: { x: 0, y: 0, zoom: 1 } },
    renderNodes: { value: [] },
    renderEdges: { value: [] },
  } as unknown as CanvasRenderContext
}

describe('设置面板打开不白屏', () => {
  it('默认皮在真实内核下能渲染出分类和菜单', async () => {
    const ctx = await boot()
    const app = createSSRApp({
      render: () => h(PluginSettingsContent, { settings: ctx.get('settings') }),
    })
    app.provide(RENDER_CONTEXT_KEY, renderCtx(ctx))
    const html = await renderToString(app)
    // 只装主题皮时没有「个人 → 通用」的配置项，快捷键配置页就是第一项；
    // 断言分类、快捷键配置页与搜索框都真的挂上了（不是白屏/空白导航）。
    expect(html).toContain('外观')
    expect(html).toContain('主题')
    expect(html).toContain('快捷键')
    expect(html).toContain('搜索命令、键位或 ID')
    expect(html).toContain('设置')
    ctx.stop()
  })
})
