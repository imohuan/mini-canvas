/**
 * usePluginManager 的接线契约（真实 Vue 渲染子树）。
 *
 * 只测服务本身还不够：页面真正拿句柄的入口是 `useCanvasRender().host.manager`。
 * 这里用 RENDER_CONTEXT_KEY 挂一棵真实组件树，锁住「渲染子树里调用就会绑定」。
 */
import { describe, expect, it, vi } from 'vitest'
import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { Context } from '@mini-canvas/canvas-data'
import { RENDER_CONTEXT_KEY, type CanvasRenderContext } from '@mini-canvas/canvas-render'
import type { CanvasHostHandle } from '@mini-canvas/canvas-render'
import { createPluginManagerService, INSTALLED_KEY, type HostPluginManager } from '../pluginManagerService'
import { usePluginManager } from '../usePluginManager'

function fakeManager() {
  const installed = new Set<string>()
  const manager: HostPluginManager = {
    async install(source) {
      const name = 'name' in source ? source.name : 'from-url'
      installed.add(name)
      return name
    },
    uninstall(name) {
      return installed.delete(name)
    },
    async reload() {},
    list() {
      return [...installed].map((name) => ({ name, state: 'active' }))
    },
  }
  return { installed, manager }
}

/** 脚本一挂上就执行：造出全局插件，再触发 onload（与插件管理器既有测试同款） */
function fakeDom(win: Record<string, unknown>): Document {
  return {
    createElement() {
      return {} as Record<string, unknown>
    },
    head: {
      appendChild(el: Record<string, unknown>) {
        const src = String(el.src ?? '')
        const pkg = src.match(/plugins\/([^/]+)\//)?.[1] ?? 'unknown'
        win['MiniCanvasPlugin' + pkg] = { name: pkg, apply() {} }
        queueMicrotask(() => (el.onload as () => void)?.())
      },
    },
  } as unknown as Document
}

describe('usePluginManager：页面在渲染子树里绑定 host.manager', () => {
  it('渲染时绑定句柄，并把启动时没装上的存档缺口补齐', async () => {
    const ctx = new Context()
    const saveValues = new Map<string, unknown>([[INSTALLED_KEY, ['plugin-a']]])
    ctx.inject('save', {
      async get<T>(k: string) {
        return saveValues.get(k) as T | undefined
      },
      set(k: string, v: unknown) {
        saveValues.set(k, v)
      },
    })
    const win: Record<string, unknown> = {}
    const svc = createPluginManagerService(ctx, {
      catalogUrl: 'http://127.0.0.1:5320/catalog.json',
      fetchImpl: (async () => ({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, plugins: [{ id: 'plugin-a', name: 'a', title: 'A', url: '/plugins/plugin-a/a.js' }] }),
      })) as unknown as typeof fetch,
      document: fakeDom(win),
      win,
    })
    ctx.inject('plugin-manager', svc)
    await svc.refresh()
    expect(svc.state.ready, '清单已就绪').toBe(true)

    const { installed, manager } = fakeManager()
    const Probe = defineComponent({
      setup() {
        const got = usePluginManager()
        return () => h('div', { 'data-service': got === svc ? 'same' : 'other' }, 'probe')
      },
    })
    const app = createSSRApp({ render: () => h(Probe) })
    app.provide(RENDER_CONTEXT_KEY, {
      ctx,
      host: { manager } as unknown as CanvasHostHandle,
    } as unknown as CanvasRenderContext)

    const html = await renderToString(app)
    expect(html).toContain('data-service="same"')
    await vi.waitFor(() => {
      expect(installed.has('plugin-a'), '渲染子树里的 host.manager 真的要参与安装').toBe(true)
    })
    expect(svc.state.rows.find((r) => r.entry.id === 'plugin-a')?.installed).toBe(true)
  })
})
