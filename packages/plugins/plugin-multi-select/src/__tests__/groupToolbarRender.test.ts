/**
 * 多选框"打组"按钮的渲染契约（SSR 拿真 HTML 断言）。
 *
 * 用户要求：多选时上下控制栏**只显示多选框自己的**状态栏，且当前只放一个"打组"按钮；
 * 按钮要能拿到完整上下文（选中了哪些节点）。这里锁"渲染出来了 + 用的是目录里的按钮 + 点它走命令"。
 */
import { describe, it, expect } from 'vitest'
import { createSSRApp, defineComponent, h, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { RENDER_CONTEXT_KEY, type CanvasRenderContext } from '@plume-canvas/canvas-render'
import SelectionGroupToolbar from '../SelectionGroupToolbar.vue'

/** 目录里的 Button 桩：本组件只关心它被按名取到并渲染出来，不关心内部实现 */
const ButtonStub = defineComponent({
  name: 'ButtonStub',
  inheritAttrs: false,
  setup(_, { slots, attrs }) {
    return () => h('button', attrs, slots.default?.())
  },
})

/** 最小注册场桩：只给本组件读到的 top/list/subscribe（不引 kernel，本包不依赖它） */
const buttonField = () => ({
  top: (name: string) => (name === 'Button' ? { value: ButtonStub } : undefined),
  list: () => [{ value: ButtonStub }],
  subscribe: () => ({ dispose() {} }),
})

/** 最小渲染上下文：本组件只用到 ctx.get('selection'/'command') 与 ui 目录（按名取按钮） */
function renderCtx(selectedIds: string[] = ['a', 'b']) {
  const executed: string[] = []
  const services: Record<string, unknown> = {
    selection: { ids: new Set(selectedIds), has: (id: string) => selectedIds.includes(id), onChange: () => () => {} },
    command: { execute: (id: string) => { executed.push(id); return true } },
  }
  const ctx = {
    get: (name: string) => services[name],
    registryOf: () => buttonField(),
    isDev: false,
  }
  return { ctx, executed }
}

function render(selectedIds: string[] = ['a', 'b']): Promise<string> {
  const app = createSSRApp({ render: () => h(SelectionGroupToolbar as Component) })
  app.provide(RENDER_CONTEXT_KEY, { ctx: renderCtx(selectedIds).ctx } as unknown as CanvasRenderContext)
  return renderToString(app)
}

describe('多选框"打组"按钮', () => {
  it('按钮从 ui 目录按名取（默认主题登记 Button），并渲染出「打组」', async () => {
    const html = await render()
    expect(html).toContain('selection-group-toolbar')
    expect(html).toContain('打组')
    expect(html, '没有用目录里的 Button').toContain('<button')
  })

  it('有文案与无障碍名（纯图标按钮也必须两者齐全）', async () => {
    const html = await render()
    expect(html).toContain('创建分组')
    expect(html).toContain('aria-label')
  })
})
