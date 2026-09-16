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
function renderCtx(
  settings: Record<string, unknown> = {},
  zoom = 1,
  selecting = false,
  handleParamsOverride: Partial<CanvasRenderContext['handleParams']> = {},
): CanvasRenderContext {
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
    // 端口外观参数：批量连线端口复用主题的 MovingHandle，需要这份（与真实宿主同源）。
    // 给默认值即可，本文件断言的是两框几何、不是端口尺寸。
    handleParams: {
      handleRestOffset: 36,
      handleCursorGap: 24,
      handleButtonSize: 32,
      portZoneWidth: 86,
      portZoneHeightRatio: 0.55,
      portZoneOffset: 0,
      portZoneShape: 'arc',
      portZoneArcRatio: 0.8,
      ...handleParamsOverride,
    },
    // 框选态：interaction 走渲染上下文（不是内核 service），桩里按需给
    interaction: { isSelecting: { value: selecting } },
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

function render(
  settings: Record<string, unknown> = {},
  zoom = 1,
  selecting = false,
  handleParamsOverride: Partial<CanvasRenderContext['handleParams']> = {},
): Promise<string> {
  const app = createSSRApp({ render: () => h(SelectionFrame as Component) })
  app.provide(RENDER_CONTEXT_KEY, renderCtx(settings, zoom, selecting, handleParamsOverride))
  return renderToString(app)
}

/** 从 HTML 里取某个 class 元素的内联 style 字符串（SSR 下 style 会序列化成 style="..."） */
function styleOf(html: string, cls: string): string {
  const m = new RegExp(`class="${cls}"[^>]*style="([^"]*)"`).exec(html)
  return m ? m[1] : ''
}

/** 取某条内联样式里的 px 数值（读不到回落 NaN，便于断言失败时看到实际值） */
function pxIn(style: string, prop: string): number {
  const m = new RegExp(`${prop}:\\s*(-?[\\d.]+)px`).exec(style)
  return m ? Number(m[1]) : Number.NaN
}

/** 大框到小框的间距（flow 值）——直接量两个框的 left/top 之差，不依赖中间算法 */
function outerGap(html: string, outerCls: string, innerCls: string): { left: number; top: number } {
  const o = styleOf(html, outerCls)
  const i = styleOf(html, innerCls)
  return { left: pxIn(i, 'left') - pxIn(o, 'left'), top: pxIn(i, 'top') - pxIn(o, 'top') }
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

  it('内框是直角（用户要求去掉圆弧）—— 默认渲染出的内框圆角为 0，外框仍可圆角', async () => {
    const html = await render()
    expect(styleOf(html, 'selection-frame-inner')).toContain('border-radius:0px')
    // 外框保留自己的圆角配置（6px），两者互不影响
    expect(styleOf(html, 'selection-frame-outer')).toContain('border-radius:6px')
  })

  it('内框圆角仍可配：设成 10 就出 10px 圆角（不是写死直角）', async () => {
    const html = await render({ [MULTI_SELECT_FRAME_KEYS.innerRadius]: 10 })
    expect(styleOf(html, 'selection-frame-inner')).toContain('border-radius:10px')
  })

  it('小框 padding 可在设置里调：给值后内框比节点并集向外胖一圈，大框仍在小框外侧', async () => {
    const html = await render({
      [MULTI_SELECT_FRAME_KEYS.innerPaddingX]: 10,
      [MULTI_SELECT_FRAME_KEYS.innerPaddingTop]: 20,
    })
    const inner = styleOf(html, 'selection-frame-inner')
    const outer = styleOf(html, 'selection-frame-outer')
    // 节点并集是 (100,200,600,260)；小框左右各扩 10、上扩 20
    expect(inner).toContain('left:90px')
    expect(inner).toContain('top:180px')
    expect(inner).toContain('width:620px')
    expect(inner).toContain('height:280px')
    // 大框 = 小框 + 两框间距(16/34/16)
    expect(outer).toContain('left:74px')
    expect(outer).toContain('top:146px')
    expect(outer).toContain('width:652px')
    expect(outer).toContain('height:330px')
  })

  it('小框 padding 默认 0：不配时内框仍严格等于节点并集（默认观感不变）', async () => {
    const html = await render()
    const inner = styleOf(html, 'selection-frame-inner')
    expect(inner).toContain('left:100px')
    expect(inner).toContain('top:200px')
    expect(inner).toContain('width:600px')
    expect(inner).toContain('height:260px')
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

  /**
   * 用户报的缺陷："你的这个多选框缩放之后的 padding 存在 BUG"。
   *
   * 线宽反缩放（屏幕上恒定）而间距不反缩放（屏幕上 = 配置 × zoom），于是缩得越小线越粗、
   * 间距越窄，两条线糊成一条。这一条锁住"间距与线宽同空间"。
   */
  it('间距也按 1/zoom 反缩放：缩小时 flow 间距变大，屏幕上量到的才是配置值', async () => {
    const at1 = await render()
    const at05 = await render({}, 0.5)
    const gap1 = outerGap(at1, 'selection-frame-outer', 'selection-frame-inner')
    const gap05 = outerGap(at05, 'selection-frame-outer', 'selection-frame-inner')
    // zoom=1：间距就是配置默认 16
    expect(gap1.left).toBe(16)
    expect(gap1.top).toBe(34)
    // zoom=0.5：flow 间距翻倍成 32 / 68，屏幕上仍是 16 / 34
    expect(gap05.left).toBe(32)
    expect(gap05.top).toBe(68)
  })

  it('缩小时两框不会因线宽撑大而糊在一起（间距屏幕值 > 两条线半宽之和）', async () => {
    const zoom = 0.2
    // 外框线宽 8 / 内框线宽 8：两侧各半宽 4 + 4 = 8px，间距在屏幕上必须仍大于它
    const html = await render(
      { [MULTI_SELECT_FRAME_KEYS.outerWidth]: 8, [MULTI_SELECT_FRAME_KEYS.innerWidth]: 8 },
      zoom,
    )
    const gap = outerGap(html, 'selection-frame-outer', 'selection-frame-inner')
    const gapOnScreen = gap.left * zoom
    expect(gapOnScreen).toBeGreaterThan(8)
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

describe('层级与命中（用户要求：节点必须在框之上，才能加减选）', () => {
  it('框整体不接事件（pointer-events 由 CSS 给 none）——事件完整留给下面的节点', async () => {
    const html = await render()
    // 大框只画、不抓事件；也**不再**有"铺在框上抓事件"的把手元素。
    // "框内按住拖动 = 平移框 + 选中节点"改由画布层按几何判断接管（见 onPaneCaptureDown），
    // 这样节点既点得到（可单独取消选中），框内拖动又不会被 VueFlow 当成画布平移。
    expect(html).toContain('class="selection-frame-outer"')
    expect(html).not.toContain('selection-frame-grip')
  })
})

describe('群组框总开关', () => {
  it('多选框上挂的是主题的 MovingHandle（不是手绘按钮）——保证与节点端口同款', async () => {
    const html = await render()
    // 复用 MovingHandle 的既有类名 = 外观/跟随/显隐全由同一个组件负责，不会各画一套
    expect(html).toContain('moving-handle-anchor')
    expect(html).toContain('is-preview')
    expect(html).toContain('port-follow-zone')
    expect(html).toContain('moving-handle-button')
    // 左右各一个（按元素数，不按"类名出现次数"——同一元素会带多个含该词的类）
    expect((html.match(/class="moving-handle-anchor/g) ?? []).length).toBe(2)
    expect(html).toContain('selection-frame-batch-slot is-left')
    expect(html).toContain('selection-frame-batch-slot is-right')
  })

  /**
   * 用户问："有没有办法直接使用 MovingHandle？"
   *
   * 答案是能，但**不能再拿 !important 去改它的定位**：MovingHandle 的锚点自带
   * `top:50% !important` + `translateY(-50%) !important`，那是组件自己的几何契约。
   * 以前这里套了个 0×0 的定位点、再用 !important 把 top 和 transform 压回 0，
   * 于是端口的位置和尺寸全靠外面那圈覆盖撑着，稍微动一下就跟节点端口长得不一样
   * （用户报的"你的效果不对"）。
   *
   * 正确做法是顺着它的契约走：**给定位盒一个真实高度**（= 跟随区高），
   * 它的 `top:50%` 就自然落在盒子垂直中点上，跟随区上下各露一半 —— 与节点端口同一套几何。
   */
  it('端口定位靠"给盒子真实高度"，不靠 !important 覆盖 MovingHandle 自己的 top/transform', async () => {
    const html = await render()
    const slot = styleOf(html, 'selection-frame-batch-slot is-left')
    // 盒子有高度（= 跟随区高），锚点的 top:50% 才有几何意义
    expect(slot).toMatch(/height:\d/)
    // 不再有任何 !important 覆盖（模板已不产出该样式；类名也一并不要，免得日后被人加回去）
    expect(html).not.toContain('!important')
  })

  it('端口跟随区高度 = 选中节点最高者 × 配置的比例（与节点端口的算法同一语义）', async () => {
    // 桩里的两个节点高 120 / 200 → 取最高 200；handleParams.portZoneHeightRatio = 0.55 → 110
    const html = await render()
    // 跟随区与定位盒都用同一个高度（110.00000000000001 这类浮点尾数允许）
    expect(html).toMatch(/selection-frame-batch-slot is-left" style="[^"]*height:110(\.\d+)?px/)
    expect(html).toMatch(/port-follow-zone port-follow-zone--target" style="[^"]*height:110(\.\d+)?px/)
  })

  it('跟随区高度跟配置走：比例调大 → 高度跟着变大（不是写死的）', async () => {
    // 200 × 0.8 = 160
    const html = await render({}, 1, false, { portZoneHeightRatio: 0.8 })
    expect(html).toMatch(/port-follow-zone port-follow-zone--target" style="[^"]*height:160(\.\d+)?px/)
  })

  it('关掉后不画任何框（多选本身仍可用，只是没有视觉框）', async () => {
    const html = await render({ [MULTI_SELECT_FRAME_KEYS.enabled]: false })
    expect(html).not.toContain('selection-frame-outer')
    expect(html).not.toContain('selection-frame-inner')
    expect(html).not.toContain('selection-frame-grip')
  })
})

describe('框选进行中', () => {
  it('框选中不显示群组框（免得两套框叠在一起）', async () => {
    const html = await render({}, 1, true)
    expect(html).not.toContain('selection-frame-outer')
    expect(html).not.toContain('selection-frame-grip')
  })
})
