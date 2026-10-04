/**
 * 本轮实测修复的渲染契约（SSR 拿真实 HTML 断言）。
 *
 * 两条来自用户带截图的反馈（都属于「这类错别再犯」）：
 * 1. 滑块圆球拉到两端会戳出轨道，把外层下拉撑出横向滚动条 → 轨道两端必须内缩半径；
 * 2. 参数菜单要有宽度下限，不能被压成一条窄缝。
 *
 * 底栏左右内边距 / 覆盖层文案封顶 3 行 —— 那两个纯视觉数值在浏览器回归里量（SSR 拿不到样式）。
 */
import { describe, it, expect } from 'vitest'
import { createSSRApp, h, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import PrecisionSlider from '../PrecisionSlider.vue'
import ToolParamSlider from '../ToolParamSlider.vue'
import ToolParamGroup from '../ToolParamGroup.vue'
import Dropdown from '../Dropdown.vue'

function render(comp: Component, props: Record<string, unknown> = {}): Promise<string> {
  const app = createSSRApp({ render: () => h(comp, props) })
  return renderToString(app)
}

describe('PrecisionSlider：圆球两端收在轨道内', () => {
  it('拇指中心只在两端内缩 8px 的跑道里跑（0% / 100% 都收在轨道内）', async () => {
    const html = await render(PrecisionSlider, { modelValue: 10, min: 0, max: 10, step: 1 })
    expect(html).toContain('ps-thumb')
    expect(html).toContain('ps-track')
    // 用 calc 把跑道两端各内缩半径：8px + (100% - 16px) * 1
    expect(html).toMatch(/ps-thumb[^>]*calc\(8px \+ \(100% - 16px\)/)
  })

  it('圆球位置仍由当前值派生（100% 时按跑道右端算）', async () => {
    const html = await render(PrecisionSlider, { modelValue: 10, min: 0, max: 10, step: 1 })
    expect(html).toMatch(/ps-thumb[^>]*\* 1\)/)
  })
})

describe('ToolParamSlider：数值 + 单位', () => {
  it('时长滑块把当前值与单位并排显示（10 秒）', async () => {
    const html = await render(ToolParamSlider, {
      param: { key: 'durationSec', label: '时长', kind: 'duration', min: 4, max: 10, step: 1, unit: '秒' },
      modelValue: 10,
    })
    expect(html).toContain('10')
    expect(html).toContain('秒')
  })
})

describe('ToolParamGroup：触发器给出参数摘要', () => {
  it('收起态摘要 = 比例值（菜单本体 Teleport 到 body，SSR 看不到，形状由浏览器回归锁）', async () => {
    const html = await render(ToolParamGroup, {
      params: [{ key: 'ratio', label: '比例', kind: 'ratio', type: 'select', options: [{ label: '16:9', value: '16:9' }] }],
      values: { ratio: '16:9' },
    })
    expect(html).toContain('tpg-trigger')
    expect(html).toContain('16:9')
  })
})

/**
 * Dropdown 的两种滚动布局。
 *
 * 用户口径（2026-10-03）：「顶部标题和底部内容滚动是区分开的，上下是 flex 布局，
 * 只有下面内容滚动的地方才会显示滚动条」——需要「标题固定 + 列表滚」的调用方
 * 必须能选到 inner-scroll，而不是让整个浮层滚（那样只能靠 sticky 去补，是绕）。
 */
describe('Dropdown：滚动布局', () => {
  const renderDropdown = (props: Record<string, unknown>): Promise<string> =>
    renderToString(
      createSSRApp({
        render: () =>
          h(Dropdown, { modelValue: true, teleport: false, ...props }, { default: () => '内容' }),
      }),
    )

  it('默认 overlay-scroll：不加 inner-scroll 类（短菜单 / 单选列表用，整个浮层滚）', async () => {
    const html = await renderDropdown({})
    expect(html).toContain('dd-menu')
    expect(html).not.toContain('dd-menu--inner-scroll')
  })

  it('inner-scroll：浮层只当外框，自身不滚（内容区自己滚）', async () => {
    const html = await renderDropdown({ layout: 'inner-scroll' })
    expect(html).toContain('dd-menu--inner-scroll')
  })

  /**
   * 居中一律**相对触发器**，不引入额外的"对别的元素居中"参数。
   *
   * 用户口径（2026-10-03）：「触发是通过历史记录这个按钮来进行的，也就是它的 drop down
   * 绑定在这个按钮上面，那么居中肯定也是根据它来呀」——曾经加过一个 center-on 去对面板中线，
   * 那会盖掉组件自带的"对触发器居中"，菜单相对按钮偏一大截。所以这里钉住它**不长出**那个参数。
   */
  it('没有"对别的元素居中"的旁路参数（居中只认触发器）', async () => {
    const html = await renderDropdown({ placement: 'bottom' })
    expect(html).toContain('dd-menu')
    expect(html).not.toContain('dd-scrim')
    expect(html).not.toContain('dd-menu--modal')
    expect(html).toContain('dd-trigger')
  })
})
