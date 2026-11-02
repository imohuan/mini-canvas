import { describe, it, expect } from 'vitest'
import { defineComponent, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createSSRApp } from 'vue'
import { Context } from '@mini-canvas/canvas-data'
import { RegistryImpl } from '@mini-canvas/kernel'
import { effectScope } from 'vue'
import { uiComponent, uiComponentRefs, uiNames, useUiComponent } from '../uiCatalog'
import { CANVAS_CONTEXT_KEY, type CanvasContext } from '../canvasContext'
import type { CanvasHostHandle, MiniCanvasApi } from '../../host/createMiniCanvasHost'
import type { PluginManager } from '../../host/pluginManager'

/**
 * ui 目录场（设计文档 §4.5 / 案例 4 / 决策 4）：
 * 主题把设计系统件登记进 registryOf('ui')，业务插件按名取 —— 换主题零改动。
 */
describe('ui 组件目录（按名取设计系统件）', () => {
  it('主题登记后，消费方按名取到组件（uiComponent；以 slider 为例）', async () => {
    const ctx = new Context()
    const ThemeSlider = { name: 'ThemeSlider' };
    ctx.registryOf<unknown>('ui').add('slider', ThemeSlider, { id: 'default' });
    await ctx.start();
    expect(uiComponent(ctx, 'slider')).toBe(ThemeSlider);
    expect(uiNames(ctx)).toContain('slider');
    ctx.stop();
  })

  it('换主题 = 叠一层（order 小者赢），且原值仍可查（永不覆盖）', async () => {
    const ctx = new Context();
    const BaseBtn = { name: 'Base' };
    const NeonBtn = { name: 'Neon' };
    ctx.registryOf<unknown>('ui').add('slider', BaseBtn, { id: 'default', order: 0 });
    ctx.registryOf<unknown>('ui').add('slider', NeonBtn, { id: 'neon', order: -1 });
    await ctx.start();
    expect(uiComponent(ctx, 'slider')).toBe(NeonBtn); // order 最小者在最外
    const all = ctx.registryOf<unknown>('ui').list('slider');
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
    expect(uiComponent(undefined, 'slider')).toBeUndefined();
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
        const Button = useUiComponent('slider')
        return () => {
          // ref 在 setup 返回的 render 里要手动解包（模板里 Vue 会自动解）
          const C = Button.value as { render?: () => unknown } | undefined
          return h('div', { class: 'ui-consumer' }, C && typeof C.render === 'function' ? h(C as never) : 'NONE')
        }
      },
    })
    const app = createSSRApp({ render: () => h(Consumer) })
    app.provide(CANVAS_CONTEXT_KEY, {
      ctx: { registryOf: () => field } as unknown as CanvasContext['ctx'],
      host: {} as CanvasHostHandle,
      api: {} as MiniCanvasApi,
      manager: {} as PluginManager,
    })
    return renderToString(app)
  }

  it('目录里换成新组件后，同一个消费组件渲染出新组件（不是旧快照）', async () => {
    const field = new RegistryImpl<unknown>()
    const Base = defineComponent({ name: 'Base', render: () => h('span', { class: 'base-btn' }) })
    const Neon = defineComponent({ name: 'Neon', render: () => h('span', { class: 'neon-btn' }) })
    field.add('slider', Base, { id: 'default' })
    expect(await renderWithCatalog(field)).toContain('base-btn')
    // 换主题 = 叠一个 order 更小的条目
    field.add('slider', Neon, { id: 'neon', order: -1 })
    expect(await renderWithCatalog(field)).toContain('neon-btn')
  })

  it('目录里没有这个名字 → 渲染 NONE（undefined + warn，不炸）', async () => {
    expect(await renderWithCatalog(new RegistryImpl<unknown>())).toContain('NONE')
  })
})

/**
 * 解构写法：`const { DropdownMenu, DropdownMenuContent } = useUiComponent()`。
 *
 * 用户口径（2026-11-03）：一个组件常有多个子件，取件不能逼着人写十几行单名调用；
 * 解构出来的每个键必须是响应式 Ref，主题替换时模板自动跟着换。
 */
describe('useUiComponent() 无参：按目录名解构整组组件', () => {
  function renderGroup(field: RegistryImpl<unknown>): Promise<string> {
    const Consumer = defineComponent({
      name: 'UiGroupConsumer',
      setup() {
        const refs = useUiComponent()
        return () =>
          h('div', [
            h('span', { class: 'has-menu' }, refs.DropdownMenu?.value ? 'yes' : 'no'),
            h('span', { class: 'has-content' }, refs.DropdownMenuContent?.value ? 'yes' : 'no'),
            h('span', { class: 'has-missing' }, refs.Missing ? 'yes' : 'no'),
          ])
      },
    })
    const app = createSSRApp({ render: () => h(Consumer) })
    app.provide(CANVAS_CONTEXT_KEY, {
      ctx: { registryOf: () => field } as unknown as CanvasContext['ctx'],
      host: {} as CanvasHostHandle,
      api: {} as MiniCanvasApi,
      manager: {} as PluginManager,
    })
    return renderToString(app)
  }

  it('解构得到同一个目录里的多个子件；未登记的名字是 undefined', async () => {
    const field = new RegistryImpl<unknown>()
    field.add('DropdownMenu', defineComponent({ name: 'DM' }), { id: 'default' })
    field.add('DropdownMenuContent', defineComponent({ name: 'DMC' }), { id: 'default' })
    const html = await renderGroup(field)
    expect(html).toContain('has-menu">yes')
    expect(html).toContain('has-content">yes')
    expect(html).toContain('has-missing">no')
  })

  it('目录替换后，解构出来的 Ref 原地更新（不需重新调用 useUiComponent）', () => {
    const field = new RegistryImpl<unknown>()
    const Base = defineComponent({ name: 'Base' })
    const Replaced = defineComponent({ name: 'Replaced' })
    field.add('Button', Base, { id: 'default' })
    const scope = effectScope()
    const refs = scope.run(() =>
      uiComponentRefs({ registryOf: () => field } as unknown as CanvasContext['ctx']),
    )!
    expect(refs.Button?.value).toBe(Base)
    field.add('Button', Replaced, { id: 'next', order: -1 })
    expect(refs.Button?.value).toBe(Replaced)
    scope.stop()
  })

  it('模板解构写法可编译：const { Button, DropdownMenuContent } = useUiComponent()', async () => {
    const Consumer = defineComponent({
      name: 'DestructuredComponentsConsumer',
      template: `
        <div>
          <Button>保存</Button>
          <DropdownMenuContent>菜单内容</DropdownMenuContent>
        </div>
      `,
      setup() {
        const { Button: Btn, DropdownMenuContent: Content } = useUiComponent()
        return { Button: Btn, DropdownMenuContent: Content }
      },
    })
    const app = createSSRApp(Consumer)
    app.component('Button', defineComponent({ name: 'Button', template: '<button><slot /></button>' }))
    app.component('DropdownMenuContent', defineComponent({ name: 'DropdownMenuContent', template: '<div><slot /></div>' }))
    app.provide(CANVAS_CONTEXT_KEY, {
      ctx: {
        registryOf: () => ({
          keys: () => ['Button', 'DropdownMenuContent'],
          top: (name: string) => ({ value: app.component(name) }),
          subscribe: () => ({ dispose: () => undefined }),
        }),
      } as unknown as CanvasContext['ctx'],
      host: {} as CanvasHostHandle,
      api: {} as MiniCanvasApi,
      manager: {} as PluginManager,
    })
    expect(await renderToString(app)).toContain('保存')
  })
})
