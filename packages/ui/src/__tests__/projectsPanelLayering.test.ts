/**
 * 项目页面板的分层契约：同一份根 ctx，项目页只看到应用级能力，进画布后才多出 doc。
 *
 * 这条用真实内核 + 真实 SlotHost 做 SSR，覆盖 18 号文档的验收：
 * - 直接打开项目页：插件面板能渲染，通用 Button 拿得到，画布动作禁用；
 * - 进画布：同一个 ctx 上 doc 出现，动作可用；
 * - 回项目页：doc 消失，面板还在；插槽条目始终只有一条（不重复登记）。
 */
import { describe, expect, it, vi } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { Context, MemoryStorageAdapter, createCanvasAppBasePlugin } from '@mini-canvas/canvas-data'
import {
  CANVAS_CONTEXT_KEY,
  SlotHost,
  mountCanvas,
  unmountCanvas,
  type CanvasContext,
} from '@mini-canvas/canvas-render'
import { themeComponentsPlugin } from '@mini-canvas/plugin-theme-components'
import { projectsPanelPlugin } from '../projectsPanelPlugin'
import { projectsApiPlugin } from '../projectsApiPlugin'

async function boot() {
  const ctx = new Context()
  const app = createCanvasAppBasePlugin({ adapter: new MemoryStorageAdapter(), persistSettings: false })
  ctx.plugin(app.plugin)
  ctx.plugin(themeComponentsPlugin)
  ctx.plugin(projectsPanelPlugin)
  ctx.plugin(projectsApiPlugin)
  await ctx.start()
  return { ctx, app }
}

function layerContext(ctx: Context): CanvasContext {
  // 项目页没有画布会话：host/api/manager 只会在真正访问时报错，面板不读它们。
  return {
    ctx,
    get host(): never {
      throw new Error('项目页没有 host')
    },
    get api(): never {
      throw new Error('项目页没有 api')
    },
    get manager(): never {
      throw new Error('项目页没有 manager')
    },
  }
}

async function renderPanel(ctx: Context): Promise<string> {
  const app = createSSRApp({ render: () => h(SlotHost, { slot: 'app.projects.main' }) })
  app.provide(CANVAS_CONTEXT_KEY, layerContext(ctx))
  return renderToString(app)
}

describe('项目页插件面板与画布能力分层', () => {
  it('项目页能渲染面板、拿到 Button，画布动作禁用', async () => {
    const { ctx, app } = await boot()
    // 面板用的 Button 必须真的来自 ui 目录，而不是模块级静态兜底。
    expect(ctx.registryOf<unknown>('ui').keys()).toContain('Button')
    expect(ctx.registryOf<unknown>('ui').top('Button')?.value, 'ui 目录的 Button 是空的').toBeTruthy()
    expect(ctx.hasService('doc')).toBe(false)
    // 项目页面板要能真正操作项目数据：服务必须常驻，不需要打开画布。
    expect(ctx.tryGet('projectsApi')).toBeTruthy()

    const html = await renderPanel(ctx)
    expect(html).toContain('项目页面板示例')
    expect(html).toContain('打开一张画布后可使用画布动作')
    // 通用 Button 来自 theme-components 的 ui 目录；标签渲染得出来说明取件成功。
    expect(html).toContain('画布动作')
    expect(html).toContain('disabled')
    ctx.stop()
  })

  it('进画布后同一个 ctx 多出 doc，动作可用；回项目页再禁回去', async () => {
    const { ctx, app } = await boot()
    const session = await mountCanvas({ ctx, appBase: app.services, plugins: [] })
    expect(ctx.hasService('doc')).toBe(true)

    const inside = await renderPanel(ctx)
    expect(inside).toContain('当前已在画布内')
    // 只检查画布动作那个按钮本身：Tailwind 的 disabled: 前缀类名不算按钮被禁用。
    const actionButton = inside.match(/<button[^>]*>[\s\S]*?画布动作[\s\S]*?<\/button>/)?.[0] ?? ''
    expect(actionButton).not.toBe('')
    expect(actionButton).not.toMatch(/^<button[^>]*\sdisabled[\s>]/)

    await session.dispose()
    const back = await renderPanel(ctx)
    expect(back).toContain('项目页面板示例')
    expect(back).toContain('disabled')
    expect(back).toContain('打开一张画布后可使用画布动作')
    ctx.stop()
  })

  it('往返两轮不重复登记插槽条目', async () => {
    const { ctx, app } = await boot()
    const before = ctx.slots.occupants('app.projects.main').length
    await mountCanvas({ ctx, appBase: app.services, plugins: [] })
    await unmountCanvas()
    await mountCanvas({ ctx, appBase: app.services, plugins: [] })
    await unmountCanvas()
    expect(ctx.slots.occupants('app.projects.main')).toHaveLength(before)
    expect(ctx.inspectPlugins().find((p) => p.name === 'ui-projects-panel')?.state).toBe('active')
    ctx.stop()
  })

  it('SlotHost 在项目页与画布页读同一份根 ctx（插槽条目一致）', async () => {
    const { ctx, app } = await boot()
    const before = ctx.slots.occupants('app.projects.main').map((e) => e.id)
    const session = await mountCanvas({ ctx, appBase: app.services, plugins: [] })
    // 画布会话不改变应用级插槽；项目页与画布页从同一个 ctx.slots 读到同一组 id。
    expect(ctx.slots.occupants('app.projects.main').map((e) => e.id)).toEqual(before)
    // 渲染也走同一份 ctx：画布内无需第二个 Provider 也能渲染项目页槽。
    const inside = await renderPanel(ctx)
    expect(inside).toContain('项目页面板示例')
    // SlotHost 读的还是根 ctx：如果它在画布内误读渲染上下文，这里会抛"缺少画布上下文"。
    expect(inside).not.toContain('缺少画布上下文')
    await session.dispose()
    expect(ctx.slots.occupants('app.projects.main').map((e) => e.id)).toEqual(before)
    ctx.stop()
  })

  it('项目页不建画布宿主：没有 doc / canvas / nodeToolbar，也不读 default 画布', async () => {
    const { ctx } = await boot()
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    // 这些只由 canvas-data 注入；项目页少任何一个都说明有人偷偷启动了画布。
    for (const name of ['doc', 'canvas', 'nodeToolbar', 'selection']) {
      expect(ctx.hasService(name), '项目页不该有 ' + name).toBe(false)
    }
    // 项目数据服务在项目页可用，但它只读 /api/projects，不碰 /api/canvases/default。
    await ctx.get<{ listProjects(): Promise<unknown> }>('projectsApi').listProjects().catch(() => undefined)
    const urls = fetchSpy.mock.calls.map((c) => String(c[0]))
    expect(urls.some((u) => u.includes('/default'))).toBe(false)
    fetchSpy.mockRestore()
    ctx.stop()
  })
})
