/**
 * 「参数语义类型 → 预设组件」的契约测试（SSR 拿真实 HTML 断言）。
 *
 * 用户的要求：\u201c我会识别到某些固定的一些类型参数，它就会使用我的预设组件\u201d。
 * 这条测试锁的就是那层识别：
 * 1. kind:'ratio' → 比例网格（带按真实宽高比画的描边矩形，不是普通下拉）；
 * 2. kind:'quality'/'count'/… → 按钮网格（一排可点按钮）；
 * 3. kind:'duration' 两档 → 按钮网格；连续 → 滑块；
 * 4. kind:'model'/'speaker' → 明确回落下拉（选项多，网格放不下）；
 * 5. 认不得的 kind / 作者自带 component → 回落内置控件（不炸、不抢）。
 */
import { describe, it, expect } from 'vitest'
import { createSSRApp, defineComponent, h, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { ToolParamDef } from '@mini-canvas/kernel'
import ToolParamField from '../ToolParamField.vue'
import { resolvePresetKind, presetColumns, PRESET_UI_NAMES } from '../paramKind'

function render(param: ToolParamDef, modelValue: string | number | boolean = ''): Promise<string> {
  const app = createSSRApp({ render: () => h(ToolParamField as Component, { param, modelValue, idPrefix: 'tp' }) })
  return renderToString(app)
}

describe('resolvePresetKind：判定表（纯函数）', () => {
  const withOptions = (kind: string, count = 6): ToolParamDef => ({
    key: 'k',
    kind,
    type: 'select',
    options: Array.from({ length: count }, (_, i) => ({ label: 'o' + i, value: 'v' + i })),
  })

  it('ratio → 比例网格；quality/resolution/background/count/camera → 按钮网格', () => {
    expect(resolvePresetKind(withOptions('ratio'))).toBe('ratio')
    for (const k of ['quality', 'resolution', 'background', 'count', 'camera']) {
      expect(resolvePresetKind(withOptions(k)), k).toBe('grid')
    }
  })

  it('duration：有选项且 <= 3 档 → 网格；否则数值 → 滑块', () => {
    expect(resolvePresetKind(withOptions('duration', 2))).toBe('grid')
    expect(resolvePresetKind({ key: 'd', kind: 'duration', type: 'number', min: 4, max: 15 })).toBe('slider')
  })

  it('speed 这类数值区间 → 滑块', () => {
    expect(resolvePresetKind({ key: 's', kind: 'speed', type: 'number', min: -50, max: 100 })).toBe('slider')
  })

  it('model / style / speaker / format → 回落内置控件（明确不用预设件）', () => {
    for (const k of ['model', 'style', 'speaker', 'format']) {
      expect(resolvePresetKind(withOptions(k)), k).toBeUndefined()
    }
  })

  it('认不得的 kind / 没声明 kind → 回落', () => {
    expect(resolvePresetKind(withOptions('whatever'))).toBeUndefined()
    expect(resolvePresetKind({ key: 'x', type: 'select', options: [{ label: 'a', value: 'a' }] })).toBeUndefined()
  })

  it('作者自带 component → 永远优先，预设件不抢', () => {
    expect(resolvePresetKind({ ...withOptions('ratio'), component: { name: 'X' } })).toBeUndefined()
  })

  it('列数：比例 5 列，其余 3 列（照参考站实测）', () => {
    expect(presetColumns('ratio')).toBe(5)
    expect(presetColumns('grid')).toBe(3)
  })
})

describe('ToolParamField 按 kind 选预设件（渲染契约）', () => {
  it('kind:ratio → 画比例网格（有按真实宽高比的描边矩形），不再是普通下拉', async () => {
    const html = await render(
      {
        key: 'ratio',
        kind: 'ratio',
        label: '比例',
        type: 'select',
        options: [
          { label: '16:9', value: '16:9' },
          { label: '9:16', value: '9:16' },
        ],
      },
      '16:9',
    )
    expect(html).toContain('trg-grid')
    expect(html).toContain('trg-shape') // 按真实比例画的矩形
    expect(html).toContain('16:9')
    expect(html).not.toContain('sel-trigger') // 不是下拉
  })

  it('比例矩形按真实宽高比缩放：16:9 的宽 > 高，9:16 的高 > 宽', async () => {
    const wide = await render({ key: 'r', kind: 'ratio', type: 'select', options: [{ label: '16:9', value: '16:9' }] }, '16:9')
    const tall = await render({ key: 'r', kind: 'ratio', type: 'select', options: [{ label: '9:16', value: '9:16' }] }, '9:16')
    // 只取 trg-shape（描边矩形）那一处的尺寸 —— 图标位固定 17×17，不能拿它当断言对象
    const sizeOf = (html: string): { w: number; h: number } => {
      const m = /trg-shape[^>]*style="width:\s*(\d+)px;\s*height:\s*(\d+)px/.exec(html)
      return { w: Number(m?.[1]), h: Number(m?.[2]) }
    }
    const a = sizeOf(wide)
    const b = sizeOf(tall)
    expect(a.w).toBeGreaterThan(a.h)
    expect(b.h).toBeGreaterThan(b.w)
    expect(a.w).toBeGreaterThanOrEqual(4)
  })

  it('比例值解析不出（auto）→ 画虚线方块，与真比例区分', async () => {
    const html = await render({ key: 'r', kind: 'ratio', type: 'select', options: [{ label: '自动', value: 'auto' }] }, 'auto')
    expect(html).toContain('trg-shape')
    expect(html).toContain('is-dashed')
  })

  it('kind:quality → 按钮网格（3 列、一排按钮），选中项带 is-active', async () => {
    const html = await render(
      {
        key: 'quality',
        kind: 'quality',
        label: '画质',
        type: 'select',
        options: [
          { label: '标准画质', value: 'standard' },
          { label: '高画质', value: 'high' },
        ],
      },
      'high',
    )
    expect(html).toContain('tog-grid')
    expect(html).toContain('repeat(3, 1fr)') // 3 列
    expect(html).toContain('高画质')
    expect(html).toContain('is-active')
    expect(html).not.toContain('sel-trigger')
  })

  it('kind:count → 按钮网格（数量是一排按钮，不是下拉）', async () => {
    const html = await render(
      {
        key: 'count',
        kind: 'count',
        label: '生成数量',
        type: 'select',
        options: [
          { label: '1张', value: '1' },
          { label: '2张', value: '2' },
          { label: '4张', value: '4' },
        ],
      },
      '1',
    )
    expect(html).toContain('tog-grid')
    expect(html).toContain('1张')
  })

  it('kind:duration 两档（dola 的 5/10）→ 按钮网格', async () => {
    const html = await render(
      {
        key: 'durationSec',
        kind: 'duration',
        label: '时长',
        type: 'number',
        options: [
          { label: '5秒', value: '5' },
          { label: '10秒', value: '10' },
        ],
      },
      '5',
    )
    expect(html).toContain('tog-grid')
    expect(html).toContain('5秒')
  })

  it('kind:duration 连续（豆包 4-10）→ 滑块 + 当前值 + 单位', async () => {
    const html = await render(
      { key: 'durationSec', kind: 'duration', label: '时长', type: 'number', min: 4, max: 10, step: 1, unit: '秒' },
      6,
    )
    expect(html).toMatch(/slider|role="slider"|aria-valuenow/)
    expect(html).toContain('tps-value')
    expect(html).toContain('秒')
  })

  it('kind:model → 仍是下拉（选项多/名字长，参考站也是单独下拉）', async () => {
    const html = await render(
      {
        key: 'model',
        kind: 'model',
        label: '模型',
        type: 'select',
        options: [
          { label: 'Seedream 4.5', value: 'Seedream 4.5' },
          { label: 'Seedream 5.0 Pro', value: 'Seedream 5.0 Pro' },
        ],
      },
      'Seedream 4.5',
    )
    expect(html).toContain('sel-trigger')
    expect(html).not.toContain('tog-grid')
  })

  it('承认 kind 但作者自带 component → 用作者的（预设件不抢）', async () => {
    const Custom = defineComponent({
      name: 'MyRatio',
      props: { param: { type: Object, default: undefined }, modelValue: { type: null, default: undefined } },
      render() {
        return h('div', { 'data-custom-ratio': 'ok' })
      },
    })
    const html = await render(
      { key: 'ratio', kind: 'ratio', type: 'select', options: [{ label: '1:1', value: '1:1' }], component: Custom },
      '1:1',
    )
    expect(html).toContain('data-custom-ratio="ok"')
    expect(html).not.toContain('trg-grid')
  })
})

describe('ui 目录登记名（业务插件按名取的通道）', () => {
  it('三种预设件都有约定的目录名', () => {
    expect(PRESET_UI_NAMES.ratio).toBe('toolParamRatio')
    expect(PRESET_UI_NAMES.grid).toBe('toolParamGrid')
    expect(PRESET_UI_NAMES.slider).toBe('toolParamSlider')
  })
})
