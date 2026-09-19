import { describe, it, expect } from 'vitest'
import { defineComponent, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createSSRApp } from 'vue'
import { Context } from '@mini-canvas/canvas-data'
import { RegistryImpl } from '@mini-canvas/kernel'
import { uiComponent, uiNames, useUiComponent } from '../uiCatalog'
import { RENDER_CONTEXT_KEY, type CanvasRenderContext } from '../renderContext'

/**
 * ui 目录场（设计文档 §4.5 / 案例 4 / 决策 4）：
 * 主题把设计系统件登记进 registryOf('ui')，业务插件按名取 —— 换主题零改动。
 */
describe('ui 组件目录（按名取设计系统件）', () => {
  it('主题登记后，消费方按名取到组件（uiComponent）', async () => {
    const ctx = new Context()
    const ThemeButton = { name: 'ThemeButton' };
    ctx.registryOf<unknown>('ui').add('button', ThemeButton, { id: 'default' });
    await ctx.start();
    expect(uiComponent(ctx, 'button')).toBe(ThemeButton);
    expect(uiNames(ctx)).toContain('button');
    ctx.stop();
  })

  it('换主题 = 叠一层（order 小者赢），且原值仍可查（永不覆盖）', async () => {
    const ctx = new Context();
    const BaseBtn = { name: 'Base' };
    const NeonBtn = { name: 'Neon' };
    ctx.registryOf<unknown>('ui').add('button', BaseBtn, { id: 'default', order: 0 });
    ctx.registryOf<unknown>('ui').add('button', NeonBtn, { id: 'neon', order: -1 });
    await ctx.start();
    expect(uiComponent(ctx, 'button')).toBe(NeonBtn); // order 最小者在最外
    const all = ctx.registryOf<unknown>('ui').list('button');
    expect(all.map((e) => e.value)).toEqual([NeonBtn, BaseBtn]); // 原值没丢
    ctx.stop();
  })

  it('目录里没有的名字返回 undefined（调用方自行降级，不炸）', async () => {
    const ctx = new Context();
    await ctx.start();
    expect(uiComponent(ctx, 'nope')).toBeUndefined();
    ctx.stop();
  })

  it('无 ctx 时返回 undefined / 空数组（组件树外调用安全）', () => {
    expect(uiComponent(undefined, 'button')).toBeUndefined();
    expect(uiNames(undefined)).toEqual([]);
  })
})

/**
 * useUiComponent 的**响应式**契约：返回的是"当前这个名字对应的组件"而不是一次性快照 ——
 * 换主题（目录被顶掉一层）时消费组件的渲染要跟着变，不必重挂。
 * 这条正是 e2e 里"换 ui 目录按钮真的跟着换"能成立的原因（此前是快照，换目录不生效）。
 */
describe('useUiComponent：目录变了，消费组件跟着换', () => {
  function renderWithCatalog(field: RegistryImpl<unknown>): Promise<string> {
    const Consumer = defineComponent({
      name: 'UiConsumer',
      setup() {
        const Button = useUiComponent('button')
        return () => {
          // ref 在 setup 返回的 render 里要手动解包（模板里 Vue 会自动解）
          const C = Button.value as { render?: () => unknown } | undefined
          return h('div', { class: 'ui-consumer' }, C && typeof C.render === 'function' ? h(C as never) : 'NONE')
        }
      },
    })
    const app = createSSRApp({ render: () => h(Consumer) })
    app.provide(RENDER_CONTEXT_KEY, { ctx: { registryOf: () => field } } as unknown as CanvasRenderContext)
    return renderToString(app)
  }

  it('目录里换成新组件后，同一个消费组件渲染出新组件（不是旧快照）', async () => {
    const field = new RegistryImpl<unknown>()
    const Base = defineComponent({ name: 'Base', render: () => h('span', { class: 'base-btn' }) })
    const Neon = defineComponent({ name: 'Neon', render: () => h('span', { class: 'neon-btn' }) })
    field.add('button', Base, { id: 'default' })
    expect(await renderWithCatalog(field)).toContain('base-btn')
    // 换主题 = 叠一个 order 更小的条目
    field.add('button', Neon, { id: 'neon', order: -1 })
    expect(await renderWithCatalog(field)).toContain('neon-btn')
  })

  it('目录里没有这个名字 → 渲染 NONE（undefined + warn，不炸）', async () => {
    expect(await renderWithCatalog(new RegistryImpl<unknown>())).toContain('NONE')
  })
})
