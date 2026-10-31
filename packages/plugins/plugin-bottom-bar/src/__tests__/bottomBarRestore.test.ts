/**
 * 底栏「配置能恢复」的渲染契约（SSR 拿真实 HTML 断言）。
 *
 * 用户口径（2026-10-12）：
 * ①「我在插件节点里选择了下拉的某个选项，点击其他位置隐藏掉控制栏后，再重新点开，
 *    之前选择的选项并没有恢复，而是变成了默认选项。」
 * ②「我使用了其中一个模型来生成，重新点击之后，它又恢复成了默认模型，
 *    导致我配置的这些参数全部都会消失。」
 *
 * 根因（真机实测复现）：节点 data.barValues.actionId 存着上次用的动作，但组件挂载时
 * `selectAction(defaultActionId())` 无条件把当前动作设成**第一条**，从不读这个记事本 ——
 * 于是界面回默认；再一收起（unmount → persistValues）就把默认动作 + 只剩默认动作声明过的
 * 参数**写回磁盘**，用户的配置被真删掉。
 *
 * 修法：挂载时优先恢复上次那个动作（它还在的话），参数按它声明的 key 复原。
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { createSSRApp, h, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { RENDER_CONTEXT_KEY, type CanvasRenderContext } from '@mini-canvas/canvas-render'
import { RegistryImpl } from '@mini-canvas/kernel'
import { Context } from '@mini-canvas/canvas-data'
import { themeDefaultPlugin } from '@mini-canvas/plugin-theme-default'
import NodeBottomBar from '../NodeBottomBar.vue'
import type { BarAction } from '../barTypes'

/** 第一条（= 默认会选中的那个）：与用户报的场景一致 —— 只有 ratio */
const FIRST: BarAction = {
  id: 'test:first-model',
  types: ['image'],
  order: 1,
  title: '默认模型',
  needsPrompt: true,
  fields: [
    {
      key: 'ratio',
      label: '比例',
      type: 'select',
      default: '16:9',
      options: [
        { label: '16:9', value: '16:9' },
        { label: '1:1', value: '1:1' },
      ],
    },
  ],
  run: () => ({ ok: true }),
}

/** 第二条（用户上次真正用过的那条）：多一个 resolution，用来证「参数一并复原」 */
const SECOND: BarAction = {
  id: 'test:second-model',
  types: ['image'],
  order: 2,
  title: '上次用的模型',
  needsPrompt: true,
  fields: [
    {
      key: 'ratio',
      label: '比例',
      type: 'select',
      default: '16:9',
      options: [
        { label: '16:9', value: '16:9' },
        { label: '9:16', value: '9:16' },
      ],
    },
    {
      key: 'resolution',
      label: '清晰度',
      type: 'select',
      default: '1K',
      options: [
        { label: '1K', value: '1K' },
        { label: '2K', value: '2K' },
      ],
    },
  ],
  run: () => ({ ok: true }),
}

let uiField: { top(name: string): { value: unknown } | undefined; subscribe(fn: () => void): { dispose(): void } }
beforeAll(async () => {
  const ctx = new Context()
  ctx.plugin(themeDefaultPlugin)
  await ctx.start()
  uiField = ctx.registryOf('ui') as typeof uiField
})

function makeCtx(opts: { data?: Record<string, unknown> } = {}): CanvasRenderContext {
  const ids = new Set(['n2'])
  const node = { id: 'n2', type: 'image', data: opts.data ?? {} }
  const services: Record<string, unknown> = {
    selection: { ids, has: (id: string) => ids.has(id), onChange: () => () => {} },
    doc: {
      getNode: (id: string) => (id === 'n2' ? node : undefined),
      updateNode: () => {},
      getNodes: () => [node],
      getEdges: () => [],
      subscribe: () => () => {},
      types: new Map([
        [
          'image',
          {
            type: 'image',
            label: '图片',
            inputs: [{ acceptsTypes: ['text', 'image'] }],
            outputs: [{ contentType: 'image' }],
          },
        ],
      ]),
    },
    nodeBar: { list: () => [FIRST, SECOND] },
    nodeTask: { cancel: () => {}, run: async () => ({ ok: true }) },
  }
  return {
    host: {
      nodeRegistry: { get: () => undefined },
      themeRegistry: { winner: () => undefined, subscribe: () => () => {} },
    },
    ctx: {
      get: (n: string) => services[n],
      tryGet: (n: string) => services[n],
      on: () => ({ dispose: () => {} }),
      registryOf: (kind: string) => (kind === 'ui' ? uiField : (new RegistryImpl() as unknown)),
    },
    viewport: { value: { zoom: 1 } },
    flow: { queryNodeEl: () => null },
    renderNodes: { value: [{ id: 'n2', type: 'image', data: opts.data ?? {} }] },
    renderEdges: { value: [] },
  } as unknown as CanvasRenderContext
}

function render(data: Record<string, unknown>): Promise<string> {
  const app = createSSRApp({ render: () => h(NodeBottomBar as Component, { id: 'n2', data }) })
  app.provide(RENDER_CONTEXT_KEY, makeCtx({ data }))
  return renderToString(app)
}

/** 下拉触发器上显示的动作名（没有底栏时返回空串） */
function triggerLabel(html: string): string {
  const m = html.match(/class="sel-label[^"]*"[^>]*>([^<]*)</)
  return (m?.[1] ?? '').trim()
}

describe('底栏配置恢复：上次用的动作（模型）', () => {
  it('没存过 → 默认第一条（既有行为不变）', async () => {
    const html = await render({})
    expect(triggerLabel(html)).toBe('默认模型')
  })

  it('存过第二条 → 恢复第二条，而不是回默认（用户报的 ①/②）', async () => {
    const html = await render({ barValues: { ratio: '9:16', resolution: '2K', actionId: 'test:second-model' } })
    expect(triggerLabel(html)).toBe('上次用的模型')
  })

  it('恢复时参数一并复原（上次那条声明的 resolution=2K 不许被默认值顶掉）', async () => {
    const html = await render({ barValues: { ratio: '9:16', resolution: '2K', actionId: 'test:second-model' } })
    // 参数区摘要 = 比例 · 清晰度（标签来自 options 的 label）
    expect(html).toContain('9:16 · 2K')
  })

  it('存的动作已经不在（插件卸了）→ 回默认第一条，不炸', async () => {
    const html = await render({ barValues: { ratio: '9:16', actionId: 'test:gone-model' } })
    expect(triggerLabel(html)).toBe('默认模型')
  })

  it('barValues 是脏数据（数组/字符串）→ 回默认，不炸', async () => {
    expect(triggerLabel(await render({ barValues: ['x'] }))).toBe('默认模型')
    expect(triggerLabel(await render({ barValues: 'x' }))).toBe('默认模型')
  })
})
