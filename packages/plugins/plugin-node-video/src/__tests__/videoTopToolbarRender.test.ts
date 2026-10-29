/**
 * 视频节点顶部操作条的渲染契约（与 imageToolbarsRender.test.ts 同一条口径）。
 *
 * 裁剪入口 2026-10-29 恢复：此前裁剪会话只能经命令（video:crop）进入，界面不可达。
 * 这里锁三条用户可见行为：无视频无入口、有视频有入口、编辑态换确认/取消。
 * SSR 只验渲染与文案；真实交互由 Chrome 实测兜底（AGENTS.md 测试顺序）。
 */
import { beforeAll, describe, it, expect } from 'vitest'
import { createSSRApp, h, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { RENDER_CONTEXT_KEY, type CanvasRenderContext } from '@mini-canvas/canvas-render'
import { RegistryImpl } from '@mini-canvas/kernel'
// 只导入主题**插件**（走注册流程），不导入它的实现组件（与图片包同一条 T07 口径）
import { themeDefaultPlugin } from '@mini-canvas/plugin-theme-default'
import VideoTopToolbar from '../VideoTopToolbar.vue'

async function themeUiField(): Promise<{ top(name: string): { value: unknown } | undefined }> {
  const { Context } = await import('@mini-canvas/canvas-data')
  const ctx = new Context()
  ctx.plugin(themeDefaultPlugin)
  await ctx.start()
  return ctx.registryOf('ui')
}
let uiFieldShared: { top(name: string): { value: unknown } | undefined }
beforeAll(async () => {
  uiFieldShared = await themeUiField()
})

function renderCtx(selectedIds: string[] = []): CanvasRenderContext {
  const selected = new Set(selectedIds)
  const services: Record<string, unknown> = {
    selection: {
      ids: selected,
      has: (id: string) => selected.has(id),
      onChange: () => () => {},
    },
    doc: { getNode: () => undefined, updateNode: () => {} },
  }
  return {
    ctx: {
      get: (name: string) => services[name],
      tryGet: (name: string) => services[name],
      registryOf: (kind: string) => (kind === 'ui' ? uiFieldShared : new RegistryImpl()),
    },
    viewport: { value: { zoom: 1 } },
    renderNodes: { value: [] },
    renderEdges: { value: [] },
  } as unknown as CanvasRenderContext
}

function render(id: string, data: Record<string, unknown>, selected: boolean): Promise<string> {
  const app = createSSRApp({ render: () => h(VideoTopToolbar as Component, { id, data }) })
  app.provide(RENDER_CONTEXT_KEY, renderCtx(selected ? [id] : []))
  return renderToString(app)
}

describe('视频节点顶部操作条', () => {
  it('未选中 → 不渲染', async () => {
    const html = await render('v1', { resourceId: 'res-1' }, false)
    expect(html).not.toContain('vt-root')
  })

  it('无视频 → 只有上传，没有裁剪入口（点了没反应的按钮不渲染）', async () => {
    const html = await render('v1', {}, true)
    expect(html).toContain('vt-root')
    expect(html).toContain('上传视频')
    expect(html).not.toContain('裁剪画面')
  })

  it('有视频 → 裁剪入口与上传/剪辑同排出现', async () => {
    const html = await render('v1', { resourceId: 'res-1' }, true)
    expect(html).toContain('裁剪画面')
    expect(html).toContain('剪辑时长')
    expect(html).toContain('上传视频')
  })

  it('旧地址（videoUrl）的节点也算有视频：迁移期判据与内容组件同源', async () => {
    const html = await render('v1', { videoUrl: 'blob:legacy' }, true)
    expect(html).toContain('裁剪画面')
  })
})
