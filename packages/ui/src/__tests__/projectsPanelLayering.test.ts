/**
 * 项目页插件页签的分层契约：同一份根 ctx，项目页只看到应用级能力，进画布后才多出 doc。
 *
 * 这条用真实内核 + 真实 SlotHost 做 SSR，覆盖 18 号文档的验收：
 * - 直接打开项目页：插件页签能登记，通用 Button 拿得到；
 * - 进画布：同一个 ctx 上 doc 出现；
 * - 回项目页：doc 消失，页签还在；插槽条目始终一致（不重复登记）。
 *
 * 页签正文（插件 / 素材库）在浏览器里目验；这里只锁"页签元数据与生命周期"。
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
import { projectsApiPlugin } from '../projectsApiPlugin'

async function boot() {
  const ctx = new Context()
  const app = createCanvasAppBasePlugin({ adapter: new MemoryStorageAdapter(), persistSettings: false })
  ctx.plugin(app.plugin)
  ctx.plugin(themeComponentsPlugin)
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

async function renderTabs(ctx: Context): Promise<string> {
  const app = createSSRApp({ render: () => h(SlotHost, { slot: 'app.projects.tabs' }) })
  app.provide(CANVAS_CONTEXT_KEY, layerContext(ctx))
  return renderToString(app)
}

describe('项目页插件页签与画布能力分层', () => {
  it('项目页登记插件页签，画布级服务仍未启动', async () => {
    const { ctx, app } = await boot()
    expect(ctx.registryOf<unknown>('ui').keys()).toContain('Button')
    expect(ctx.registryOf<unknown>('ui').top('Button')?.value, 'ui 目录的 Button 是空的').toBeTruthy()
    expect(ctx.hasService('doc')).toBe(false)
    expect(ctx.tryGet('projectsApi')).toBeTruthy()

    // 项目页没有画布：SlotHost 也不会因为取不到渲染上下文而报错。
    const html = await renderTabs(ctx)
    expect(html).not.toContain('缺少画布上下文')
    ctx.stop()
  })

  it('进画布后同一个 ctx 多出 doc；回项目页页签保持不变', async () => {
    const { ctx, app } = await boot()
    const session = await mountCanvas({ ctx, appBase: app.services, plugins: [] })
    expect(ctx.hasService('doc')).toBe(true)
    const before = ctx.slots.occupants('app.projects.tabs').map((e) => e.id)

    await session.dispose()
    expect(ctx.hasService('doc')).toBe(false)
    expect(ctx.slots.occupants('app.projects.tabs').map((e) => e.id)).toEqual(before)
    ctx.stop()
  })

  it('往返两轮不重复登记插槽条目', async () => {
    const { ctx, app } = await boot()
    const before = ctx.slots.occupants('app.projects.tabs').length
    await mountCanvas({ ctx, appBase: app.services, plugins: [] })
    await unmountCanvas()
    await mountCanvas({ ctx, appBase: app.services, plugins: [] })
    await unmountCanvas()
    expect(ctx.slots.occupants('app.projects.tabs')).toHaveLength(before)
    expect(ctx.inspectPlugins().find((p) => p.name === 'projects-api')?.state).toBe('active')
    ctx.stop()
  })

  it('SlotHost 在项目页与画布页读同一份根 ctx（插槽条目一致）', async () => {
    const { ctx, app } = await boot()
    const before = ctx.slots.occupants('app.projects.tabs').map((e) => e.id)
    const session = await mountCanvas({ ctx, appBase: app.services, plugins: [] })
    expect(ctx.slots.occupants('app.projects.tabs').map((e) => e.id)).toEqual(before)
    const inside = await renderTabs(ctx)
    expect(inside).not.toContain('缺少画布上下文')
    await session.dispose()
    expect(ctx.slots.occupants('app.projects.tabs').map((e) => e.id)).toEqual(before)
    ctx.stop()
  })

  it('项目页不建画布宿主：没有 doc / canvas / nodeToolbar，也不读 default 画布', async () => {
    const { ctx } = await boot()
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    for (const name of ['doc', 'canvas', 'nodeToolbar', 'selection']) {
      expect(ctx.hasService(name), '项目页不该有 ' + name).toBe(false)
    }
    await ctx.get<{ listProjects(): Promise<unknown> }>('projectsApi').listProjects().catch(() => undefined)
    const urls = fetchSpy.mock.calls.map((c) => String(c[0]))
    expect(urls.some((u) => u.includes('/default'))).toBe(false)
    fetchSpy.mockRestore()
    ctx.stop()
  })
})
