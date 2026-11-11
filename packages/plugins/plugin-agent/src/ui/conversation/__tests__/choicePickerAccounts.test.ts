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
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToString } from 'vue/server-renderer'
import { RENDER_CONTEXT_KEY, type CanvasRenderContext } from '@plume-canvas/canvas-render'
import { RegistryImpl } from '@plume-canvas/kernel'
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
    'DropdownMenu', 'DropdownMenuTrigger', 'DropdownMenuContent', 'DropdownMenuLabel',
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
  it('多个号：整行就是二级菜单触发器，菜单里列出每个号', async () => {
    const html = await render([{ id: 'a', title: 'Seedream 5.0', accounts: TWO, accountId: 'second' }])
    expect(html).toContain('ac-model-entry-sub')
    expect(html).toContain('选择账号')
    expect(html).toContain('账号 2')
  })

  it('只有一个号：不出二级菜单', async () => {
    const html = await render([{ id: 'a', title: 'Seedream 5.0', accounts: [TWO[0]!] }])
    expect(html).not.toContain('ac-model-entry-sub')
    expect(html).not.toContain('选择账号')
  })

  it('没有账号信息：不出二级菜单（不破坏旧调用）', async () => {
    const html = await render([{ id: 'a', title: 'Seedream 5.0' }])
    expect(html).not.toContain('ac-model-entry-sub')
  })

  it('多账号不复制模型行：两个动作仍是两行', async () => {
    const html = await render([
      { id: 'a', title: '动作 A', accounts: TWO },
      { id: 'b', title: '动作 B', accounts: TWO },
    ])
    // 卡片 / 分栏两套视图都常驻 DOM，所以每行出现两次
    expect(html.split('class="ac-model-entry').length - 1).toBe(4)
    // 每个动作的名字出现 4 次 = 两个视图 × （行内文本 + 触发器的 text-value），
    // 关键是「不随账号数翻倍」：两个号也只出现 4 次，而不是 8 次。
    for (const n of ['动作 A', '动作 B']) {
      expect(html.split(n).length - 1).toBe(4)
    }
  })

  /**
   * 结构与 packages/ui 左上角画布菜单一致（用户 2026-11-10：
   * 「参考一下我的 Package UI 里面左上角的这个画布菜单，它是如何实现嵌套的」）。
   *
   * 要点：整行本身就是 DropdownMenuSubTrigger —— 悬停整行即展开，两级菜单之间的
   * 间距由主题组件给；不能再自己写浮层 + 定时器（那样没有间隔）。
   */
  it('嵌套用 DropdownMenuSub：整行即触发器，子菜单用 SubContent', async () => {
    const src = readFileSync(resolve(__dirname, '../ChoicePicker.vue'), 'utf8')
    expect(src).toContain('<DropdownMenuSub ')
    expect(src).toContain('DropdownMenuSubTrigger')
    expect(src).toContain('DropdownMenuSubContent')
    // 两个视图都要有：卡片 + 分栏
    expect(src.match(/<DropdownMenuSubTrigger v-if="hasAccounts/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
    // 不再自己画浮层 / 自己管 hover 计时
    expect(src).not.toContain('ac-account-pop')
    expect(src).not.toContain('Teleport to="body"')
    expect(src).not.toContain('@mouseenter="openAccountSoon')
  })
})
