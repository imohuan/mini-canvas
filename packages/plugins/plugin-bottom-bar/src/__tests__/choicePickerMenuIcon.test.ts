/**
 * ChoicePickerMenu → Agent 面板：逐行图标必须一路传到底（用户 2026-11-08 截图的问题）。
 *
 * 这里把 Agent 的 ChoicePicker 换成一个桩，直接读它收到的 items ——
 * 于是能断言「底栏给了什么」，不必去猜浮层内部的渲染时序。
 */
import { describe, expect, it } from 'vitest'
import { createSSRApp, defineComponent, h, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { RENDER_CONTEXT_KEY, type CanvasRenderContext } from '@mini-canvas/canvas-render'
import { RegistryImpl } from '@mini-canvas/kernel'
import ChoicePickerMenu from '../node-bottom-bar/ChoicePickerMenu.vue'

const SVG = '<svg viewBox="0 0 24 24" data-own="x"><circle cx="12" cy="12" r="8"/></svg>'

function stub(name: string): Component {
  return {
    name,
    props: ['variant', 'size', 'type', 'disabled', 'modelValue', 'placeholder'],
    setup: (_p: unknown, { slots }: { slots: Record<string, (() => unknown) | undefined> }) =>
      () => h('span', { 'data-stub': name }, (slots.default?.() as never) ?? null),
  }
}

/** 把收到的 props 原样吐进 HTML，供断言 */
const AgentChoicePickerStub = defineComponent({
  name: 'AgentChoicePickerStub',
  props: ['items', 'currentId', 'title', 'railLabel', 'placeholder', 'emptyText'],
  setup(props) {
    return () =>
      h('pre', { 'data-items': JSON.stringify(props.items) }, JSON.stringify(props.items))
  },
})

function makeUi(): unknown {
  const field = new RegistryImpl<unknown>()
  for (const n of [
    'Button', 'DropdownMenu', 'DropdownMenuTrigger', 'DropdownMenuContent',
  ]) field.add(n, stub(n), { id: 'test' })
  field.add('agentChoicePicker', AgentChoicePickerStub, { id: 'test' })
  return field
}

function render(items: unknown[]): Promise<string> {
  const ui = makeUi()
  const app = createSSRApp({
    render: () =>
      h(ChoicePickerMenu as Component, {
        items: items as never,
        currentId: 'a',
        triggerLabel: '当前动作',
        triggerIcon: { tone: 'custom', svg: SVG },
      }),
  })
  app.provide(RENDER_CONTEXT_KEY, {
    host: { nodeRegistry: { get: () => undefined }, themeRegistry: { winner: () => undefined, subscribe: () => () => {} } },
    ctx: {
      get: () => undefined,
      tryGet: () => undefined,
      on: () => ({ dispose: () => {} }),
      registryOf: () => ui,
    },
    viewport: { value: { x: 0, y: 0, zoom: 1 } },
    flow: { queryNodeEl: () => null },
    renderNodes: { value: [] },
  } as unknown as CanvasRenderContext)
  return renderToString(app)
}

describe('ChoicePickerMenu：逐行图标', () => {
  it('每行的 icon.svg 都传给了 Agent 面板', async () => {
    const html = await render([
      { id: 'a', title: '有图标的动作', icon: { tone: 'custom', svg: SVG } },
      { id: 'b', title: '没图标的动作' },
    ])
    expect(html).toContain('data-own')
    // 没图标的那一行不带 svg，由面板按标题回落
    const raw = /data-items="([^"]+)"/.exec(html)?.[1] ?? ''
    const decoded = raw
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
    const items = JSON.parse(decoded) as Array<{ id: string; svg?: string }>
    expect(items[0].svg).toBe(SVG)
    expect(items[1].svg).toBeUndefined()
  })
})
