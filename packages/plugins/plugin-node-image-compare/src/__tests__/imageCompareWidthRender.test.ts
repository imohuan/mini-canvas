/**
 * 图片对比节点的「尺寸跟随第一条连线图片」——接线契约（SSR + 记录型假 graph）。
 *
 * 纯规则由 compareFit.test 锁住，这里锁的是**另一半**：组件有没有真的在"连上图之后"
 * 把宽度算出来写回节点。过去这类缺口常见于"逻辑写好了但 watch 没接上/接错了依赖"，
 * 只测纯函数是看不见的。高度按第一张图的比例一起算（固定比例缩放，用户口径 2026-10-30）。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { createSSRApp, h, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { RENDER_CONTEXT_KEY, type CanvasRenderContext } from '@mini-canvas/canvas-render'
import { RegistryImpl } from '@mini-canvas/kernel'
import ImageCompareContent from '../ImageCompareContent.vue'

/** 记录所有写回调用的假 graph（真实实现走内核 updateNode，这里只要"收到什么"） */
const writes: Array<{ id: string; patch: { data: Record<string, unknown>; size?: { w: number; h: number } } }> = []

/** 上游图片节点表：id → data（含卡片显示宽度） */
const upstream: Record<string, Record<string, unknown>> = {
  imgA: { imageUrl: 'a.png', cardWidth: 420, cardHeight: 280 },
  imgB: { imageUrl: 'b.png', cardWidth: 300, cardHeight: 200 },
  noSize: { imageUrl: 'c.png' },
}

/** 当前接的边（按连线先后） */
let edges: Array<{ id: string; source: string; target: string }> = []

function renderCtx(): CanvasRenderContext {
  const nodes = Object.entries(upstream).map(([id, data]) => ({ id, type: 'image', position: { x: 0, y: 0 }, data }))
  return {
    ctx: {
      get: (name: string) =>
        // 5c：写回走 doc（老名 graph 已下线）
        name === 'doc' ? { updateNode: (id: string, patch: never) => writes.push({ id, patch }) } : undefined,
      // 极简 ui 目录：空态回落组件自身的一行灰字
      registryOf: () => new RegistryImpl(),
    },
    viewport: { value: { zoom: 1 } },
    renderNodes: { value: nodes },
    renderEdges: { value: edges },
  } as unknown as CanvasRenderContext
}

function render(id: string, data: Record<string, unknown>): Promise<string> {
  const app = createSSRApp({ render: () => h(ImageCompareContent as Component, { id, data }) })
  app.provide(RENDER_CONTEXT_KEY, renderCtx())
  return renderToString(app)
}

beforeEach(() => {
  writes.length = 0
  edges = []
})

describe('对比节点宽度跟随第一条连线的图片', () => {
  it('连上一张 420×280 的图 → 宽对齐 420、高按比例 280，比例存进 data', async () => {
    edges = [{ id: 'e1', source: 'imgA', target: 'cmp' }]
    await render('cmp', { cardWidth: 480, cardHeight: 260 })
    expect(writes).toHaveLength(1)
    expect(writes[0].id).toBe('cmp')
    // size 与比例 data 一起写（卡片镜像 data.cardWidth/cardHeight 由 nodeStore 自动补齐）
    expect(writes[0].patch.size).toEqual({ w: 420, h: 280 })
    expect(writes[0].patch.data).toEqual({ followRatio: 420 / 280 })
  })

  it('尺寸和比例都已一致 → 一个字都不写（幂等，避免自己触发自己）', async () => {
    edges = [{ id: 'e1', source: 'imgA', target: 'cmp' }]
    await render('cmp', { cardWidth: 420, cardHeight: 280, followRatio: 420 / 280 })
    expect(writes).toHaveLength(0)
  })

  it('只看第一条：连了 a(420) 和 b(300) → 跟 420，不跟后连的那张', async () => {
    edges = [
      { id: 'e1', source: 'imgA', target: 'cmp' },
      { id: 'e2', source: 'imgB', target: 'cmp' },
    ]
    await render('cmp', { cardWidth: 480, cardHeight: 260 })
    expect(writes).toHaveLength(1)
    expect(writes[0].patch.size?.w).toBe(420)
  })

  it('调换连线顺序 → 跟新顺序里的第一条', async () => {
    edges = [
      { id: 'e1', source: 'imgB', target: 'cmp' },
      { id: 'e2', source: 'imgA', target: 'cmp' },
    ]
    await render('cmp', { cardWidth: 480, cardHeight: 260 })
    expect(writes[0].patch.size?.w).toBe(300)
  })

  it('还没连图 → 不写（不猜尺寸，保持用户拖过的宽度）', async () => {
    await render('cmp', { cardWidth: 480, cardHeight: 260 })
    expect(writes).toHaveLength(0)
  })

  it('上游还没量出显示宽度 → 不写（宁可不跟随，也不要跳成一个猜的尺寸）', async () => {
    edges = [{ id: 'e1', source: 'noSize', target: 'cmp' }]
    await render('cmp', { cardWidth: 480, cardHeight: 260 })
    expect(writes).toHaveLength(0)
  })

  it('保持内容仍按两张图分屏渲染（跟随宽度不该影响显示逻辑）', async () => {
    edges = [
      { id: 'e1', source: 'imgA', target: 'cmp' },
      { id: 'e2', source: 'imgB', target: 'cmp' },
    ]
    const html = await render('cmp', { cardWidth: 480, cardHeight: 260, dividerPosition: 40 })
    expect(html).toContain('a.png')
    expect(html).toContain('b.png')
    expect(html).toContain('inset(0 60% 0 0)')
  })
})
