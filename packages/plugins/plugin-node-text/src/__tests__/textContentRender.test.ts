/**
 * TextContent 渲染契约（SSR 拿真实 HTML 断言）。
 *
 * 用户的原始要求（原话）：
 * - 文本节点默认显示文本，**超出这个空间应当显示滚动条** → 后来明确成两态：
 *   预览态超出**隐藏**就行，**双击**才进编辑态，编辑态**给滚动条**；
 * - 编辑态要**拦画布的滚轮**（不然滚自己的文字会把画布缩放掉）；
 * - 缩到一定程度后**两档都改成"长短不一的矩形色块"**（骨架屏），不再是"一块灰底"。
 *
 * 为什么要拿真 HTML 断言：光测内部 computed 是测不到"模板有没有把类名/属性接上"的 ——
 * 这里锁的正是那一步（data-mode 有没有落地、编辑态有没有 nowheel、预览态有没有被误加、
 * 缩略态到底渲染的是横条还是那块灰底 skel）。
 */
import { describe, it, expect, afterEach } from 'vitest'
import { createSSRApp, h, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { RENDER_CONTEXT_KEY, type CanvasRenderContext } from '@mini-canvas/canvas-render'
import { RegistryImpl } from '@mini-canvas/kernel'
import TextContent from '../TextContent.vue'
import { beginEdit, endEdit, resetTextEditSessions } from '../textEditSession'

/** 最小渲染上下文：TextContent 只用到 ctx.get('settings'/'text') 与 viewport.zoom */
function renderCtx(zoom = 1, settings?: { get(key: string): unknown }): CanvasRenderContext {
  const services: Record<string, unknown> = {
    text: { editText: () => {} },
    ...(settings ? { settings: { ...settings, onChange: () => ({ dispose: () => {} }) } } : {}),
  }
  return {
    ctx: {
      get: (name: string) => services[name],
      tryGet: (name: string) => services[name],
      // 极简 ui 目录：空态回落组件自身的一行灰字
      registryOf: () => new RegistryImpl(),
    },
    flow: { viewport: { value: { x: 0, y: 0, zoom } } },
  } as unknown as CanvasRenderContext
}

function render(id: string, data: Record<string, unknown>, zoom = 1): Promise<string> {
  const app = createSSRApp({ render: () => h(TextContent as Component, { id, data }) })
  app.provide(RENDER_CONTEXT_KEY, renderCtx(zoom))
  return renderToString(app)
}

afterEach(() => resetTextEditSessions())

describe('预览态（默认）', () => {
  it('显示文本，data-mode 是 preview，不渲染编辑框', async () => {
    const html = await render('n1', { text: '一段文字' })
    expect(html).toContain('data-mode="preview"')
    expect(html).toContain('一段文字')
    expect(html).not.toContain('<textarea')
  })

  it('预览态有滚动区并拦下画布滚轮，但内容区仍允许拖拽节点', async () => {
    const html = await render('n1', { text: '一段文字' })
    expect(html).toContain('data-scrollable="true"')
    expect(html).toContain('class="text-node nowheel"')
    // nowheel 只关掉画布滚轮；预览文字上没有 nodrag/nopan，所以按住正文仍能拖节点。
    expect(html).not.toMatch(/class="preview[^"]*\b(?:nodrag|nopan)\b/)
  })

  it('双击进编辑的入口挂在内容上（预览态才绑）', async () => {
    const html = await render('n1', { text: '一段文字' })
    expect(html).toContain('双击编辑')
  })
})

describe('编辑态（双击进入）', () => {
  it('渲染出编辑框，data-mode 是 editing', async () => {
    beginEdit('n1')
    const html = await render('n1', { text: '一段文字' })
    expect(html).toContain('data-mode="editing"')
    expect(html).toContain('<textarea')
  })

  it('编辑态给滚动条（可滚动）+ nowheel 拦下画布滚轮', async () => {
    beginEdit('n1')
    const html = await render('n1', { text: '一段文字' })
    expect(html).toContain('data-scrollable="true"')
    expect(html).toContain('nowheel')
    // 编辑框仍然是"就地编辑"：透明底、没有输入框边框（v1 手感）
    expect(html).toContain('nodrag')
    expect(html).toContain('nopan')
  })

  it('编辑框不画第二根浏览器原生滚动条（与预览共用 hover 细条）', async () => {
    beginEdit('n1')
    const html = await render('n1', { text: '一段文字' })
    // textarea 自带滚动条都走自绘细条：原生的宽/高为 0。
    expect(html).not.toContain('scrollbar-width:thin')
  })

  it('编辑态按节点隔离：另一个节点还是预览态', async () => {
    beginEdit('n1')
    const other = await render('n2', { text: '另一段' })
    expect(other).toContain('data-mode="preview"')
    expect(other).not.toContain('<textarea')
  })
})

describe('缩略态（骨架横条，两档都改）', () => {
  it('缩到中等 → skeleton：渲染骨架横条容器，不再渲染真字', async () => {
    const html = await render('n1', { text: '一段足够长的文字内容用于折行', cardWidth: 400, cardHeight: 300 }, 0.3)
    expect(html).toContain('data-mode="skeleton"')
    expect(html).toContain('data-testid="text-skeleton"')
    expect(html).not.toContain('一段足够长的文字内容用于折行')
  })

  it('缩到极小 → skeleton-mini：仍然是横条（不是那块灰底扫光占位）', async () => {
    const html = await render('n1', { text: '一段足够长的文字内容用于折行', cardWidth: 400, cardHeight: 300 }, 0.1)
    expect(html).toContain('data-mode="skeleton-mini"')
    expect(html).toContain('data-testid="text-skeleton"')
    expect(html).not.toContain('text-node-skel')
  })

  it('横条的条数来自真实文本（内容多 → 条多；内容少 → 条少）', async () => {
    const line = '一'.repeat(19)
    const many = await render(
      'n1',
      { text: [line, line, line, line].join('\n'), cardWidth: 400, cardHeight: 300 },
      0.3,
    )
    const few = await render('n2', { text: line, cardWidth: 400, cardHeight: 300 }, 0.3)
    expect(countBars(many)).toBe(4)
    expect(countBars(few)).toBe(1)
  })

  it('太短的行不画条，但行位留着（换行依然保留）', async () => {
    const html = await render(
      'n1',
      { text: '一'.repeat(19) + '\n短句', cardWidth: 400, cardHeight: 300 },
      0.3,
    )
    expect(countBars(html)).toBe(2) // 两个行位
    expect(countDrawn(html)).toBe(1) // 只画出来一条
  })

  it('空内容 → 退化成一块小色块（不留空白，也不假造横条）', async () => {
    const html = await render('n1', { text: '', cardWidth: 400, cardHeight: 300 }, 0.3)
    expect(html).toContain('data-mode="skeleton"')
    expect(html).toContain('tns-chip')
    // 只断言"没有真的画出横条"，不能写 not.toContain('tns-bar')：
    // 条厚/圆角是 CSS 变量 --tns-bar-h（tns-bar 是它的子串），会误判。
    expect(html).not.toContain('class="tns-bar"')
  })

  it('缩略态不给滚动条、也不抢滚轮，且不进编辑', async () => {
    const html = await render('n1', { text: '一段文字', cardWidth: 400, cardHeight: 300 }, 0.1)
    expect(html).toContain('data-scrollable="false"')
    expect(html).not.toContain('nowheel')
  })
})

/** 数一数渲染出来的横条条数（data-bar-count 由组件直接给出，比分 HTML 更稳） */
function countBars(html: string): number {
  const m = html.match(/data-bar-count="(\d+)"/)
  return m ? Number(m[1]) : 0
}

/** 数一数真画出来的条（行位里宽度为 0 的不算） */
function countDrawn(html: string): number {
  const m = html.match(/data-drawn-count="(\d+)"/)
  return m ? Number(m[1]) : 0
}

