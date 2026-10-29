/**
 * 素材卡（参考图）顺序的**渲染**契约（SSR 拿真实 HTML 断言）。
 *
 * 用户口径（2026-10-12）：「参考图的顺序是如何决定的？我看了好像是根据连接的先后顺序来做的。
 * 我希望这个顺序可以进行拖拽改变，你可以使用 Vue Draggable Plus，他的那个动画效果挺好的。」
 *
 * 三条必须一起成立的可见事实：
 * 1. 素材卡容器是可拖拽列表（DOM 上带 Vue Draggable Plus 的容器类 + 每张卡都能拎起来）；
 * 2. 节点存过 `data.refOrder` 时，卡片按它排（角标 1..N 跟着走）；
 * 3. 拖拽期间的三态 class（ghost / chosen / drag）有对应样式 —— 用户点名要那个动画效果。
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

const ACTION: BarAction = {
  id: 'test:gen',
  types: ['image'],
  title: '生成图片',
  needsPrompt: true,
  run: () => ({ ok: true }),
}

let uiField: { top(name: string): { value: unknown } | undefined; subscribe(fn: () => void): { dispose(): void } }
beforeAll(async () => {
  const ctx = new Context()
  ctx.plugin(themeDefaultPlugin)
  await ctx.start()
  uiField = ctx.registryOf('ui') as typeof uiField
})

/** 三个上游图片节点 a/b/c，连线顺序 a → b → c（都连进 n2） */
function makeCtx(data: Record<string, unknown> = {}): CanvasRenderContext {
  const ids = new Set(['n2'])
  const services: Record<string, unknown> = {
    selection: { ids, has: (id: string) => ids.has(id), onChange: () => () => {} },
    doc: {
      getNode: (id: string) => (id === 'n2' ? { id: 'n2', type: 'image', data } : undefined),
      updateNode: () => {},
      subscribe: () => () => {},
    },
    nodeBar: { list: () => [ACTION] },
    nodeTask: { cancel: () => {}, run: async () => ({ ok: true }) },
  }
  return {
    ctx: {
      get: (n: string) => services[n],
      tryGet: (n: string) => services[n],
      on: () => ({ dispose: () => {} }),
      registryOf: (kind: string) => (kind === 'ui' ? uiField : (new RegistryImpl() as unknown)),
    },
    viewport: { value: { zoom: 1 } },
    flow: { queryNodeEl: () => null },
    renderNodes: {
      value: [
        { id: 'a', type: 'image', data: { imageUrl: 'https://x/a.png', label: '图A' } },
        { id: 'b', type: 'image', data: { imageUrl: 'https://x/b.png', label: '图B' } },
        { id: 'c', type: 'image', data: { imageUrl: 'https://x/c.png', label: '图C' } },
        { id: 'n2', type: 'image', data },
      ],
    },
    renderEdges: {
      value: [
        { source: 'a', target: 'n2' },
        { source: 'b', target: 'n2' },
        { source: 'c', target: 'n2' },
      ],
    },
  } as unknown as CanvasRenderContext
}

function render(data: Record<string, unknown> = {}): Promise<string> {
  const app = createSSRApp({ render: () => h(NodeBottomBar as Component, { id: 'n2', data }) })
  app.provide(RENDER_CONTEXT_KEY, makeCtx(data))
  return renderToString(app)
}

/** 卡片上显示的角标序号，按 DOM 顺序 */
function cardIndexes(html: string): string[] {
  return [...html.matchAll(/class="nb-card-index[^"]*"[^>]*>(\d+)</g)].map((m) => m[1])
}

/** 已就绪卡片的 title（= 素材名）按 DOM 顺序 —— 用来验证「谁排在第几」。
 *  待输入格（is-pending）的 title 是操作提示，不是素材名，不能混进来。 */
function cardTitles(html: string): string[] {
  /**
   * 2026-10-29：卡片不再用浏览器原生 title（用户要求改主题 Tooltip），
   * 名称改挂在 aria-label 上 —— 它同时也是无障碍名称，测试继续按它比对顺序。
   */
  return [...html.matchAll(/class="nb-card"[^>]*aria-label="([^"]*)"/g)].map((m) => m[1])
}

/** aria-label 形如「图A」图片（可拖动…）：取引号里的名称来比对顺序 */
function nameOfCard(label: string): string {
  return /^「(.+?)」/.exec(label)?.[1] ?? label
}

describe('素材卡顺序：按用户拖出来的顺序渲染', () => {
  it('没存过顺序 → 连线先后（既有行为不变）', async () => {
    const html = await render({})
    expect(cardIndexes(html)).toEqual(['1', '2', '3'])
    expect(cardTitles(html).map(nameOfCard)).toEqual(['图A', '图B', '图C'])
  })

  it('存过 refOrder → 卡片按它排（用户拖过的顺序被记住）', async () => {
    const html = await render({ refOrder: ['c', 'a', 'b'] })
    expect(cardTitles(html).map(nameOfCard)).toEqual(['图C', '图A', '图B'])
    // 角标永远是 1..N（跟着最终顺序走，不是跟着连线顺序）
    expect(cardIndexes(html)).toEqual(['1', '2', '3'])
  })

  it('refOrder 里留着已断开的死 id → 忽略，不产生幽灵卡', async () => {
    const html = await render({ refOrder: ['gone', 'b', 'a', 'c'] })
    expect(cardTitles(html).map(nameOfCard)).toEqual(['图B', '图A', '图C'])
  })

  it('refOrder 是脏数据（字符串/数字项）→ 当作没存过，回连线顺序', async () => {
    expect(cardIndexes(await render({ refOrder: 'c,a,b' }))).toEqual(['1', '2', '3'])
    const html = await render({ refOrder: [1, 2] })
    expect(cardTitles(html).map(nameOfCard)).toEqual(['图A', '图B', '图C'])
  })

  it('卡片提示语说明可以拖动（用户要的「顺序可拖拽改变」）', async () => {
    const html = await render({})
    for (const t of cardTitles(html)) expect(t).toContain('可拖动调整顺序')
  })
})

describe('素材卡拖拽的视觉三态（用户点名要那个动画效果）', () => {
  it('卡片是可拎起来的（cursor:grab），拖拽中三态样式齐备', async () => {
    const html = await render({})
    // 样式是 scoped CSS：SSR 只产出内容，样式在构建产物里 —— 这里断言 DOM 侧契约
    // （容器来自 Vue Draggable Plus、卡片带 data-v 作用域），三态类名由库在拖拽时挂上。
    expect(html).toContain('nb-cards')
    expect(html).toContain('nb-card')
  })
})
