/**
 * 底栏「Agent 模型」触发器的图标（用户 2026-11-09：
 * 图片/视频/音频的触发器有模型图标，文本对话这条没有 —— 补齐）。
 *
 * 直接渲染 BottomBarModelPicker：
 * · 选中 deepseek 模型 → 触发器里有 .nb-model-badge + 品牌图标；
 * · 没选模型（「选择模型」）→ 不出图标位。
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { createSSRApp, h, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { RENDER_CONTEXT_KEY, type CanvasRenderContext } from '@mini-canvas/canvas-render'
import { RegistryImpl } from '@mini-canvas/kernel'
import BottomBarModelPicker from '../node-bottom-bar/BottomBarModelPicker.vue'

/** 只做形状的桩：这里测的是「图标有没有」，不是下拉交互 */
function stub(name: string): Component {
  return {
    name,
    props: ['variant', 'size', 'type', 'disabled', 'open', 'side', 'align', 'asChild'],
    setup: (_p: unknown, { slots, attrs }: { slots: Record<string, (() => unknown) | undefined>; attrs: Record<string, unknown> }) =>
      () => h('span', { 'data-stub': name, ...attrs }, (slots.default?.() as never) ?? null),
  }
}

const ROW_SVC = {
  svgOfName: (n: string) => '<svg data-from="name">' + n + '</svg>',
  platformOfName: (n: string) => (/deepseek/i.test(n) ? 'deepseek' : 'custom'),
  platformOf: (modelId: string) => (/^deepseek|^ds-/.test(modelId) ? 'deepseek' : 'custom'),
  svgOf: (p: string) => '<svg data-from="brand">' + p + '</svg>',
}

let uiField: RegistryImpl<unknown>
beforeAll(() => {
  uiField = new RegistryImpl<unknown>()
  for (const n of ['Button', 'DropdownMenu', 'DropdownMenuTrigger', 'DropdownMenuContent']) uiField.add(n, stub(n), { id: 'test' })
  uiField.add('agentModelPicker', stub('AgentModelPicker'), { id: 'test' })
})

function makeCtx(): CanvasRenderContext {
  return {
    host: { nodeRegistry: { get: () => undefined }, themeRegistry: { winner: () => undefined, subscribe: () => () => {} } },
    ctx: {
      get: () => undefined,
      tryGet: (n: string) => (n === 'modelIcons' ? ROW_SVC : undefined),
      on: () => ({ dispose: () => {} }),
      registryOf: (kind: string) => (kind === 'ui' ? uiField : new RegistryImpl()),
    },
    viewport: { value: { zoom: 1 } },
    flow: { queryNodeEl: () => null },
    renderNodes: { value: [] },
  } as unknown as CanvasRenderContext
}

const MODELS = [
  { provider: 'openrouter', modelId: 'deepseek-v4.1-flash', hasKey: true, isDefault: false, isVision: false },
]

function render(model: { provider: string; modelId: string } | null): Promise<string> {
  const app = createSSRApp({
    render: () => h(BottomBarModelPicker as Component, { models: MODELS, model }),
  })
  app.provide(RENDER_CONTEXT_KEY, makeCtx())
  return renderToString(app)
}

describe('Agent 模型触发器的图标', () => {
  it('选中模型 → 触发器带 .nb-model-badge 与品牌图标', async () => {
    const html = await render({ provider: 'openrouter', modelId: 'deepseek-v4.1-flash' })
    expect(html).toContain('nb-model-trigger')
    expect(html).toMatch(/nb-model-badge[^>]*data-tone="deepseek"/)
    expect(html).toContain('data-from="brand"')
  })

  it('没选模型（选择模型占位）→ 不出图标位', async () => {
    const html = await render(null)
    expect(html).toContain('nb-model-trigger')
    expect(html).not.toContain('nb-model-badge')
  })
})
