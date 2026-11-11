/**
 * ChoicePicker 的逐行图标：调用方给了 svg 就原样渲染，没给才按平台查品牌图。
 *
 * 这条链路断过（用户 2026-11-08 截图：触发器有图标、列表里全是兜底图形）。
 * 根因是面板只有 `brandSvg(platformOf(item))` 一条路，没有逐行图标的入口。
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { createSSRApp, h, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { RENDER_CONTEXT_KEY, type CanvasRenderContext } from '@plume-canvas/canvas-render'
import { RegistryImpl } from '@plume-canvas/kernel'
import ChoicePicker from '../ChoicePicker.vue'

/** 只做形状的桩：面板测的是「图标选哪个」，不是按钮长相 */
function stub(name: string): Component {
  return {
    name,
    props: ['variant', 'size', 'type', 'disabled', 'modelValue', 'placeholder', 'align'],
    setup: (_p: unknown, { slots }: { slots: Record<string, (() => unknown) | undefined> }) =>
      () => h('span', { 'data-stub': name }, (slots.default?.() as never) ?? null),
  }
}

let uiField: unknown
beforeAll(() => {
  const field = new RegistryImpl<unknown>()
  for (const n of [
    'Button', 'Badge', 'ScrollArea',
    'InputGroup', 'InputGroupAddon', 'InputGroupButton', 'InputGroupInput',
    'DropdownMenuSub', 'DropdownMenuSubTrigger', 'DropdownMenuSubContent', 'DropdownMenuItem',
  ]) field.add(n, stub(n), { id: 'test' })
  uiField = field
})

function makeRenderCtx(): CanvasRenderContext {
  return {
    host: {
      nodeRegistry: { get: () => undefined },
      themeRegistry: { winner: () => undefined, subscribe: () => () => {} },
    },
    ctx: {
      get: () => undefined,
      tryGet: () => undefined,
      on: () => ({ dispose: () => {} }),
      registryOf: () => uiField,
    },
    viewport: { value: { x: 0, y: 0, zoom: 1 } },
    flow: { queryNodeEl: () => null },
    renderNodes: { value: [] },
  } as unknown as CanvasRenderContext
}

function render(items: unknown[]): Promise<string> {
  const app = createSSRApp({
    render: () => h(ChoicePicker as Component, { items: items as never, currentId: '', title: '生成模型' }),
  })
  app.provide(RENDER_CONTEXT_KEY, makeRenderCtx())
  return renderToString(app)
}

const PER_ROW =
  '<svg viewBox="0 0 24 24" data-row-icon="own"><rect x="3" y="3" width="18" height="18"/></svg>'

describe('ChoicePicker 行图标', () => {
  it('给了 svg 的行渲染自己的图标', async () => {
    const html = await render([{ id: 'a', title: '豆包 Seedance 2.0', subtitle: 'x', svg: PER_ROW }])
    expect(html).toContain('data-row-icon="own"')
  })

  it('没给 svg 的行回落品牌图标（仍有图，不空白）', async () => {
    const html = await render([{ id: 'a', title: '豆包 Seedance 2.0', subtitle: 'x' }])
    expect(html).toContain('ac-model-brand')
    expect(html).toContain('<svg')
    expect(html).not.toContain('data-row-icon="own"')
  })

  it('同一份清单里两种行各自画自己的图标', async () => {
    const html = await render([
      { id: 'a', title: '自定义动作', svg: PER_ROW },
      { id: 'b', title: '豆包 Seedance 2.0' },
    ])
    expect(html).toContain('data-row-icon="own"')
    expect(html).toContain('ac-model-brand')
  })
})
