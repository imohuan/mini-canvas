/**
 * SelectionFrame 渲染契约（SSR 拿真实 HTML 断言）。
 *
 * 用户报的缺陷："框选之后你的 UI 存在异常，2 个框竟然有重合"。
 * 几何算对不等于画对 —— 模板把"内框尺寸"接错一个字段，照样错位。
 * 这一条锁住最终落到 DOM 上的尺寸：
 * - 内框 width/height = **节点并集**（不是外框尺寸）；
 * - 内框 left/top = padding（落在外框内侧）；
 * - 两框的颜色/线型/线宽/圆角确实来自配置（改配置 → HTML 就变）。
 */
import { describe, it, expect } from 'vitest'
import { createSSRApp, h, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { RENDER_CONTEXT_KEY, type CanvasRenderContext } from '@mini-canvas/canvas-render'
import SelectionFrame from '../SelectionFrame.vue'
import { MULTI_SELECT_FRAME_KEYS, DEFAULT_MULTI_SELECT_FRAME } from '../multiSelectConfig'

const RECTS = [
  { id: 'a', x: 100, y: 200, w: 300, h: 120 },
  { id: 'b', x: 500, y: 260, w: 200, h: 200 },
]

/**
 * 最小渲染上下文：SelectionFrame 只用到
 * ctx.get('selection'/'nodeLayout'/'nodeStore'/'graph'/'viewport'/'settings') 与 viewport.value。
 * 不 mock 几何服务 —— 用的是真实算法（与线上同一条路径）。
 */
function renderCtx(settings: Record<string, unknown> = {}, zoom = 1): CanvasRenderContext {
  const services: Record<string, unknown> = {
    selection: {
      ids: new Set(['a', 'b']),
      edgeIds: new Set<string>(),
      onChange: () => () => {},
    },
    nodeLayout: { getNodeRect: (id: string) => RECTS.find((r) => r.id === id) ?? null },
    nodeStore: { subscribe: () => () => {} },
    graph: { updateNodes: () => {} },
    viewport: { setViewport: () => {} },
    settings: {
      get: (key: string) => key in settings ? settings[key] : DEFAULT_MULTI_SELECT_FRAME_VALUE[key],
      onChange: () => ({ dispose: () => {} }),
    },
  }
  return {
    ctx: { get: (name: string) => services[name] },
    viewport: { value: { x: 0, y: 0, zoom } },
    updateNodeVisual: () => {},
  } as unknown as CanvasRenderContext
}

/** schema 默认值（读不到配置时的自然回落，保证"不传配置"与"传默认"等价） */
const DEFAULT_MULTI_SELECT_FRAME_VALUE: Record<string, unknown> = {
  [MULTI_SELECT_FRAME_KEYS.paddingX]: DEFAULT_MULTI_SELECT_FRAME.paddingX,
  [MULTI_SELECT_FRAME_KEYS.paddingTop]: DEFAULT_MULTI_SELECT_FRAME.paddingTop,
  [MULTI_SELECT_FRAME_KEYS.paddingBottom]: DEFAULT_MULTI_SELECT_FRAME.paddingBottom,
  [MULTI_SELECT_FRAME_KEYS.outerColor]: DEFAULT_MULTI_SELECT_FRAME.outer.color,
  [MULTI_SELECT_FRAME_KEYS.outerStyle]: DEFAULT_MULTI_SELECT_FRAME.outer.lineStyle,
  [MULTI_SELECT_FRAME_KEYS.outerWidth]: DEFAULT_MULTI_SELECT_FRAME.outer.lineWidth,
  [MULTI_SELECT_FRAME_KEYS.outerRadius]: DEFAULT_MULTI_SELECT_FRAME.outer.radius,
  [MULTI_SELECT_FRAME_KEYS.outerFill]: Math.round(DEFAULT_MULTI_SELECT_FRAME.outer.fillOpacity * 100),
  [MULTI_SELECT_FRAME_KEYS.innerColor]: DEFAULT_MULTI_SELECT_FRAME.inner.color,
  [MULTI_SELECT_FRAME_KEYS.innerStyle]: DEFAULT_MULTI_SELECT_FRAME.inner.lineStyle,
  [MULTI_SELECT_FRAME_KEYS.innerWidth]: DEFAULT_MULTI_SELECT_FRAME.inner.lineWidth,
  [MULTI_SELECT_FRAME_KEYS.innerRadius]: DEFAULT_MULTI_SELECT_FRAME.inner.radius,
  [MULTI_SELECT_FRAME_KEYS.innerFill]: Math.round(DEFAULT_MULTI_SELECT_FRAME.inner.fillOpacity * 100),
}

function render(settings: Record<string, unknown> = {}, zoom = 1): Promise<string> {
  const app = createSSRApp({ render: () => h(SelectionFrame as Component) })
  app.provide(RENDER_CONTEXT_KEY, renderCtx(settings, zoom))
  return renderToString(app)
}

/** 从 HTML 里取某个 class 元素的内联 style 字符串（SSR 下 style 会序列化成 style="..."） */
function styleOf(html: string, cls: string): string {
  const m = new RegExp(`class="${cls}"[^>]*style="([^"]*)"`).exec(html)
  return m ? m[1] : ''
}

describe('SelectionFrame 渲染（两个框不能重合）', () => {
  it('选中 >1 个节点时渲染出内外两个框', async () => {
    const html = await render()
    expect(html).toContain('selection-frame-outer')
    expect(html).toContain('selection-frame-inner')
  })

  it('内框尺寸 = 节点并集（600×260），不是外框尺寸（632×312）', async () => {
    const html = await render()
    const inner = styleOf(html, 'selection-frame-inner')
    // 并集 x:100..700 y:200..460 → 600×260
    expect(inner).toContain('width:600px')
    expect(inner).toContain('height:260px')
    // 旧 bug 的形态：内框被写成外框尺寸（632×310）→ 明确断言"不是它"
    expect(inner).not.toContain('632px')
    expect(inner).not.toContain('310px')
  })

  it('外框尺寸 = 节点并集 + padding（左右各 16、上 34、下 16 —— 对齐 v1 默认值）', async () => {
    const html = await render()
    const outer = styleOf(html, 'selection-frame-outer')
    expect(outer).toContain('width:632px')
    expect(outer).toContain('height:310px')
    expect(outer).toContain('left:84px')
    expect(outer).toContain('top:166px')
  })

  it('内框落在外框内侧：外框左上角 + padding = 内框左上角（不与外框错位）', async () => {
    const html = await render()
    const inner = styleOf(html, 'selection-frame-inner')
    const outer = styleOf(html, 'selection-frame-outer')
    // 外框 (84,166) + padding (16,34) = 内框 (100,200) = 节点并集左上角
    expect(outer).toContain('left:84px')
    expect(outer).toContain('top:166px')
    expect(inner).toContain('left:100px')
    expect(inner).toContain('top:200px')
  })

  it('两框线型/颜色/线宽来自配置：外框灰虚线、内框蓝实线', async () => {
    const html = await render()
    const outer = styleOf(html, 'selection-frame-outer')
    const inner = styleOf(html, 'selection-frame-inner')
    expect(outer).toContain('border-color:#94a3b8')
    expect(outer).toContain('border-style:dashed')
    expect(outer).toContain('border-width:1px')
    expect(inner).toContain('border-color:#60a5fa')
    expect(inner).toContain('border-style:solid')
  })

  it('改配置 → HTML 跟着变（线型换成点线、颜色换成红、内缩调大）', async () => {
    const html = await render({
      [MULTI_SELECT_FRAME_KEYS.outerStyle]: 'dotted',
      [MULTI_SELECT_FRAME_KEYS.outerColor]: '#ff0000',
      [MULTI_SELECT_FRAME_KEYS.paddingX]: 40,
    })
    const outer = styleOf(html, 'selection-frame-outer')
    const inner = styleOf(html, 'selection-frame-inner')
    expect(outer).toContain('border-style:dotted')
    expect(outer).toContain('border-color:#ff0000')
    // padding 只影响外框大小与内框落点，内框自身尺寸不变（仍 = 600×260）
    expect(outer).toContain('width:680px')
    expect(inner).toContain('left:100px')
    expect(inner).toContain('width:600px')
  })

  it('两框线宽都按 1/zoom 反向缩放（配置值 = 屏幕上看到的粗细，与卡片边框同一约定）', async () => {
    const html = await render(
      { [MULTI_SELECT_FRAME_KEYS.outerWidth]: 2, [MULTI_SELECT_FRAME_KEYS.innerWidth]: 3 },
      0.5,
    )
    expect(styleOf(html, 'selection-frame-outer')).toContain('border-width:4px')
    expect(styleOf(html, 'selection-frame-inner')).toContain('border-width:6px')
  })

  it('外框线宽设为 0 时仍是拖动把手（元素在、可接收事件），内框照常显示', async () => {
    const html = await render({
      [MULTI_SELECT_FRAME_KEYS.outerWidth]: 0,
      [MULTI_SELECT_FRAME_KEYS.outerFill]: 0,
    })
    // 两框互相独立：外框不画线不等于内框也没了（旧实现把内框嵌在外框里，会一起消失）
    expect(styleOf(html, 'selection-frame-outer')).toContain('border-width:0px')
    expect(html).toContain('selection-frame-inner')
  })
})
