/**
 * TextContent 渲染契约（SSR 拿真实 HTML 断言）。
 *
 * 用户的原始要求（原话）：
 * - 文本节点默认显示文本，**超出这个空间应当显示滚动条** → 后来明确成两态：
 *   预览态超出**隐藏**就行，**双击**才进编辑态，编辑态**给滚动条**；
 * - 编辑态要**拦画布的滚轮**（不然滚自己的文字会把画布缩放掉）。
 *
 * 为什么要拿真 HTML 断言：光测内部 computed 是测不到"模板有没有把类名/属性接上"的 ——
 * 这里锁的正是那一步（data-mode 有没有落地、编辑态有没有 nowheel、预览态有没有被误加）。
 */
import { describe, it, expect, afterEach } from 'vitest'
import { createSSRApp, h, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { RENDER_CONTEXT_KEY, type CanvasRenderContext } from '@mini-canvas/canvas-render'
import TextContent from '../TextContent.vue'
import { beginEdit, endEdit, resetTextEditSessions } from '../textEditSession'

/** 最小渲染上下文：TextContent 只用到 ctx.get('settings'/'text') 与 viewport.zoom */
function renderCtx(zoom = 1, settings?: { get(key: string): unknown }): CanvasRenderContext {
  const services: Record<string, unknown> = {
    text: { editText: () => {} },
    ...(settings ? { settings: { ...settings, onChange: () => ({ dispose: () => {} }) } } : {}),
  }
  return {
    ctx: { get: (name: string) => services[name] },
    viewport: { value: { zoom } },
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

  it('预览态不给滚动条、也不抢滚轮（超出就裁掉是用户要的默认行为）', async () => {
    const html = await render('n1', { text: '一段文字' })
    expect(html).toContain('data-scrollable="false"')
    expect(html).not.toContain('nowheel')
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

  it('编辑态按节点隔离：另一个节点还是预览态', async () => {
    beginEdit('n1')
    const other = await render('n2', { text: '另一段' })
    expect(other).toContain('data-mode="preview"')
    expect(other).not.toContain('<textarea')
  })
})

describe('缩放分级', () => {
  it('缩到中等 → preview-condensed（只显示首行）', async () => {
    const html = await render('n1', { text: '一段文字' }, 0.3)
    expect(html).toContain('data-mode="preview-condensed"')
  })

  it('缩到极小 → icon 灰底占位，且不进编辑（双击也不进）', async () => {
    const html = await render('n1', { text: '一段文字' }, 0.1)
    expect(html).toContain('data-mode="icon"')
    expect(html).not.toContain('一段文字')
  })
})
