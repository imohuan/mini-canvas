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
