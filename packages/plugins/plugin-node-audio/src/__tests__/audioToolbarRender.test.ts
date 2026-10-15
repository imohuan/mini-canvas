/**
 * 音频节点顶部操作条的渲染契约（用户可见行为）。
 *
 * 用户口径（原话）：「我希望把上传按钮放在顶部菜单栏中。你可以参考一下图片或视频的上传功能」。
 * 这条测试钉住搬完之后的三件事：
 * 1. **未选中 / 多选时不渲染** —— 上插槽由壳统一按"恰好选中一个"的规矩显隐（与图片/视频同款）；
 * 2. 选中时**上传按钮在上控制栏里**（带无障碍名称 + 文件选择框），已经有音频时也能从这里换；
 * 3. 定位不归本组件管（贴边/居中/反缩放都在壳的上插槽定位层）—— 自己写 position 会与壳打架。
 *
 * 上传/解码的真实行为由 audioOps 纯逻辑测试覆盖，SSR 不做真实交互（也没有 DOM），
 * 这里只验渲染、可达性与文案。
 */
import { beforeAll, describe, it, expect } from 'vitest'
import { createSSRApp, h, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { RENDER_CONTEXT_KEY, type CanvasRenderContext } from '@mini-canvas/canvas-render'
import { RegistryImpl } from '@mini-canvas/kernel'
import { Context } from '@mini-canvas/canvas-data'
// 只导入主题**插件**（走注册流程），不导入它的实现组件（T08）
import { themeDefaultPlugin } from '@mini-canvas/plugin-theme-default'
import AudioTopToolbar from '../AudioTopToolbar.vue'

const AUDIO = 'blob:mock-audio'

/**
 * UI 目录来自**真实主题插件的注册流程**（T08）：不从主题包 import 组件实现，
 * 而是装载主题插件、从它登记的 ui 目录里按名取 —— 与图片顶部条那条测试同一套做法。
 */
async function themeUiField(): Promise<{
  top(name: string): { value: unknown } | undefined
  subscribe(fn: () => void): { dispose(): void }
}> {
  const ctx = new Context()
  ctx.plugin(themeDefaultPlugin)
  await ctx.start()
  return ctx.registryOf('ui')
}
let uiFieldShared: Awaited<ReturnType<typeof themeUiField>>
beforeAll(async () => {
  uiFieldShared = await themeUiField()
})

/** 最小渲染上下文：组件用到的只有 ctx.get('selection'/'doc'/'command') 与 ctx.registryOf('ui') */
function renderCtx(selectedIds: string[] = []): CanvasRenderContext {
  const selected = new Set(selectedIds)
  const services: Record<string, unknown> = {
    // 忠实于内核 SelectionService 的最小形状：**必须有 ids** —— 显隐判定是"恰好选中一个且是我"
    selection: {
      ids: selected,
      has: (id: string) => selected.has(id),
      onChange: () => () => {},
    },
    doc: { getNode: () => undefined, updateNode: () => {}, updateNodeRuntime: () => {} },
  }
  return {
    ctx: {
      get: (name: string) => services[name],
      tryGet: (name: string) => services[name],
      registryOf: (kind: string) => (kind === 'ui' ? uiFieldShared : new RegistryImpl()),
    },
    viewport: { value: { zoom: 1 } },
  } as unknown as CanvasRenderContext
}

function render(id: string, data: Record<string, unknown>, selected: boolean): Promise<string> {
  const app = createSSRApp({ render: () => h(AudioTopToolbar as Component, { id, data }) })
  app.provide(RENDER_CONTEXT_KEY, renderCtx(selected ? [id] : []))
  return renderToString(app)
}

describe('音频节点顶部操作条', () => {
  it('未选中 → 不渲染', async () => {
    const html = await render('a1', {}, false)
    expect(html).not.toContain('at-root')
  })

  it('多选 → 不渲染（多选时上下控制栏一起收起，用户明确要求）', async () => {
    const app = createSSRApp({ render: () => h(AudioTopToolbar as Component, { id: 'a1', data: {} }) })
    app.provide(RENDER_CONTEXT_KEY, renderCtx(['a1', 'a2']))
    const html = await renderToString(app)
    expect(html).not.toContain('at-root')
  })

  it('选中 → 渲染上传按钮（带无障碍名称与文件选择框）', async () => {
    const html = await render('a1', {}, true)
    expect(html).toContain('at-root')
    expect(html).toContain('上传音频')
    expect(html).toContain('type="file"')
    expect(html).toContain('accept="audio/*"')
  })

  it('已经有音频时上传入口照样在（这里是"换一段"的入口，不再只有空态才有）', async () => {
    const html = await render('a1', { audioUrl: AUDIO, audioName: 'voice.mp3' }, true)
    expect(html).toContain('上传音频')
  })

  it('定位不由本组件负责（贴边/居中/反缩放都在壳的上插槽定位层）', async () => {
    const html = await render('a1', {}, true)
    expect(html).not.toContain('position:absolute')
    expect(html).not.toContain('scale(')
  })
})
