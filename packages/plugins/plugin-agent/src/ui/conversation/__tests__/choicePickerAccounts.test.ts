/**
 * 多账号：模型行右侧必须出「账号」二级菜单（用户 2026-11-10 反馈「二级菜单还没做」）。
 *
 * 口径：
 * - 平台有多个号 → 这一行右侧出现 DropdownMenuSub 触发器（箭头 + 账号名）；
 * - 只有一个号 → 不出现，行里也不额外多一行；
 * - 模型行数等于动作数，不会因为账号变多而翻倍。
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { createSSRApp, h, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { RENDER_CONTEXT_KEY, type CanvasRenderContext } from '@mini-canvas/canvas-render'
import { RegistryImpl } from '@mini-canvas/kernel'
import ChoicePicker from '../ChoicePicker.vue'

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
    render: () => h(ChoicePicker as Component, { items: items as never, currentId: 'a' }),
  })
  app.provide(RENDER_CONTEXT_KEY, makeRenderCtx())
  return renderToString(app)
}

const TWO = [
  { id: 'main', name: '默认账号' },
  { id: 'second', name: '账号 2' },
]

describe('ChoicePicker 多账号二级菜单', () => {
  it('多个号：行里出账号触发器，菜单里列出每个号', async () => {
    const html = await render([{ id: 'a', title: 'Seedream 5.0', accounts: TWO, accountId: 'second' }])
    expect(html).toContain('ac-model-account-trigger')
    expect(html).toContain('账号 2')
    expect(html).toContain('默认账号')
  })

  it('只有一个号：不出账号触发器', async () => {
    const html = await render([{ id: 'a', title: 'Seedream 5.0', accounts: [TWO[0]!] }])
    expect(html).not.toContain('ac-model-account-trigger')
  })

  it('没有账号信息：不出账号触发器（不破坏旧调用）', async () => {
    const html = await render([{ id: 'a', title: 'Seedream 5.0' }])
    expect(html).not.toContain('ac-model-account-trigger')
  })

  it('多账号不复制模型行：两个动作仍是两行', async () => {
    const html = await render([
      { id: 'a', title: '动作 A', accounts: TWO },
      { id: 'b', title: '动作 B', accounts: TWO },
    ])
    // 卡片 / 分栏两套视图都常驻 DOM，所以每行出现两次
    expect(html.split('class="ac-model-entry').length - 1).toBe(4)
    expect(html.split('ac-model-account-trigger').length - 1).toBe(4)
    for (const n of ['动作 A', '动作 B']) {
      // 每个视图里名字只出现一次（卡片一次 + 分栏一次）
      expect(html.split(n).length - 1).toBe(2)
    }
  })
})
