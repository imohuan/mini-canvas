/**
 * 「参数声明 → 用哪个控件画」的契约测试（SSR 拿真实 HTML 断言）。
 *
 * 2026-11-08 改版后的分工：
 * - 基础控件用 `type`：select / grid / number / string / boolean；
 * - 专属 UI 用 `kind`，只剩 ratio 一个。
 *
 * 锁住四件事：
 * 1. `type:grid` 画按钮网格，列数能配；
 * 2. `type:number` 有范围是滑块、带 options 是网格、无范围是输入框；
 * 3. `kind:ratio` 仍是比例网格，也能配列数；
 * 4. 旧的语义 kind（quality / count / model…）不再改变控件 —— 它们就是普通 select。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createSSRApp, defineComponent, h, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { ToolParamDef } from '@mini-canvas/kernel'
import ToolParamField from '../ToolParamField.vue'
import {
  resolvePresetKind,
  resolveBaseControl,
  drawsOwnTitle,
  gridColumns,
  PRESET_UI_NAMES,
  resolveInlineSoleSelect,
} from '../paramKind'

function render(param: ToolParamDef, modelValue: string | number | boolean = ''): Promise<string> {
  const app = createSSRApp({ render: () => h(ToolParamField as Component, { param, modelValue, idPrefix: 'tp' }) })
  return renderToString(app)
}

const opts = (values: string[]) => values.map((v) => ({ label: v, value: v }))

describe('resolveBaseControl：基础控件判定', () => {
  it('type:grid → 按钮网格', () => {
    expect(resolveBaseControl({ key: 'g', type: 'grid', options: opts(['a', 'b']) })).toBe('grid')
  })

  it('type:number 带 options → 网格（几档里选一个，点比拖快）', () => {
    expect(resolveBaseControl({ key: 'd', type: 'number', options: opts(['5', '10']) })).toBe('grid')
  })

  it('type:number 有 min/max → 滑块', () => {
    expect(resolveBaseControl({ key: 'd', type: 'number', min: 4, max: 10 })).toBe('slider')
    expect(resolveBaseControl({ key: 'd', type: 'number', min: 4 })).toBe('slider')
  })

  it('type:number 无范围 → 普通数字输入', () => {
    expect(resolveBaseControl({ key: 'n', type: 'number' })).toBe('number')
  })

  it('select / boolean / string / 未声明', () => {
    expect(resolveBaseControl({ key: 's', type: 'select', options: opts(['a']) })).toBe('select')
    expect(resolveBaseControl({ key: 'b', type: 'boolean' })).toBe('boolean')
    expect(resolveBaseControl({ key: 't', type: 'string' })).toBe('text')
    expect(resolveBaseControl({ key: 'x' })).toBe('text')
  })
})

describe('resolvePresetKind：只剩 ratio', () => {
  it('kind:ratio 有选项 → 比例网格', () => {
    expect(resolvePresetKind({ key: 'r', kind: 'ratio', type: 'select', options: opts(['16:9']) })).toBe('ratio')
  })

  it('kind:ratio 没选项 → 回落基础控件', () => {
    expect(resolvePresetKind({ key: 'r', kind: 'ratio', type: 'select' })).toBeUndefined()
  })

  it('旧的语义 kind 不再改变控件', () => {
    const legacy = ['quality', 'resolution', 'background', 'count', 'camera', 'duration', 'model', 'speaker', 'format', 'speed', 'style', 'whatever']
    for (const k of legacy) {
      expect(resolvePresetKind({ key: 'k', kind: k, type: 'select', options: opts(['a', 'b']) }), k).toBeUndefined()
    }
  })

  it('作者自带 component → 什么都不抢', () => {
    const param: ToolParamDef = { key: 'r', kind: 'ratio', type: 'select', options: opts(['1:1']), component: { name: 'X' } }
    expect(resolvePresetKind(param)).toBeUndefined()
  })
})

describe('gridColumns：列数', () => {
  it('作者显式给 columns 就用它（小数取整）', () => {
    expect(gridColumns({ key: 'g', type: 'grid', columns: 2 }, 6)).toBe(2)
    expect(gridColumns({ key: 'g', type: 'grid', columns: 1 }, 6)).toBe(1)
    expect(gridColumns({ key: 'g', type: 'grid', columns: 4.7 }, 6)).toBe(4)
  })

  it('没给就按选项数排一行，最多 6 列', () => {
    expect(gridColumns({ key: 'g', type: 'grid' }, 2)).toBe(2)
    expect(gridColumns({ key: 'g', type: 'grid' }, 6)).toBe(6)
    expect(gridColumns({ key: 'g', type: 'grid' }, 9)).toBe(6)
  })

  it('选项数未知 → 3 列兜底（不能给 0，否则网格塌掉）', () => {
    expect(gridColumns({ key: 'g', type: 'grid' }, 0)).toBe(3)
  })

  it('非法 columns 忽略，回落自动排', () => {
    expect(gridColumns({ key: 'g', type: 'grid', columns: 0 }, 4)).toBe(4)
    expect(gridColumns({ key: 'g', type: 'grid', columns: -2 }, 4)).toBe(4)
    expect(gridColumns({ key: 'g', type: 'grid', columns: Number.NaN }, 4)).toBe(4)
  })
})

describe('drawsOwnTitle：谁能自己画标题', () => {
  it('按钮网格与比例网格自己画，其余由外层补', () => {
    expect(drawsOwnTitle({ key: 'g', type: 'grid', options: opts(['a']) })).toBe(true)
    expect(drawsOwnTitle({ key: 'r', kind: 'ratio', type: 'select', options: opts(['1:1']) })).toBe(true)
    expect(drawsOwnTitle({ key: 's', type: 'select', options: opts(['a']) })).toBe(false)
    expect(drawsOwnTitle({ key: 'n', type: 'number', min: 1, max: 5 })).toBe(false)
    expect(drawsOwnTitle({ key: 'b', type: 'boolean' })).toBe(false)
  })
})

describe('ToolParamField 渲染：基础控件', () => {
  it('type:grid → 按钮网格，默认按选项数排一行', async () => {
    const html = await render({ key: 'q', label: '画质', type: 'grid', options: opts(['标准', '高清']) }, '高清')
    expect(html).toContain('tog-grid')
    expect(html).toContain('repeat(2, 1fr)')
    expect(html).toContain('is-active')
    expect(html).not.toContain('data-slot="select-trigger"')
  })

  it('type:grid + columns → 按配置的列数', async () => {
    const one = await render({ key: 'q', type: 'grid', columns: 1, options: opts(['低', '中', '高']) }, '中')
    expect(one).toContain('repeat(1, 1fr)')
    const four = await render({ key: 'q', type: 'grid', columns: 4, options: opts(['a', 'b', 'c', 'd']) }, 'a')
    expect(four).toContain('repeat(4, 1fr)')
  })

  it('type:number + options → 也是按钮网格', async () => {
    const html = await render({ key: 'd', label: '时长', type: 'number', options: opts(['5', '10']) }, '5')
    expect(html).toContain('tog-grid')
    expect(html).not.toContain('data-slot="select-trigger"')
  })

  it('type:number 有范围 → 滑块 + 数字框，unit 显示', async () => {
    const html = await render({ key: 'd', label: '时长', type: 'number', min: 4, max: 10, step: 1, unit: '秒' }, 6)
    expect(html).toMatch(/data-slot="slider"|role="slider"/)
    expect(html).toContain('tps-number-field')
    expect(html).toContain('秒')
  })

  it('type:number 无范围 → 普通数字输入框', async () => {
    const html = await render({ key: 'seed', type: 'number', default: 42 }, 42)
    expect(html).toContain('tpf-input')
    expect(html).not.toContain('tps-number-field')
  })

  it('type:select → 下拉（哪怕只有 2 个选项）', async () => {
    const html = await render({ key: 'm', type: 'select', options: opts(['A', 'B']) }, 'A')
    expect(html).toContain('data-slot="select-trigger"')
    expect(html).not.toContain('tog-grid')
  })

  it('type:boolean → 开关', async () => {
    const html = await render({ key: 'b', label: '放大', type: 'boolean' }, true)
    expect(html).toContain('tpf-bool')
  })

  it('type:string → 文本输入', async () => {
    const html = await render({ key: 't', type: 'string', placeholder: '写点什么' }, 'x')
    expect(html).toContain('tpf-input')
    expect(html).toContain('type="text"')
  })
})

describe('ToolParamField 渲染：专属 UI', () => {
  it('kind:ratio → 比例网格（有按真实宽高比的描边矩形）', async () => {
    const html = await render(
      { key: 'ratio', kind: 'ratio', label: '比例', type: 'select', options: opts(['16:9', '9:16']) },
      '16:9',
    )
    expect(html).toContain('trg-grid')
    expect(html).toContain('trg-shape')
    expect(html).not.toContain('data-slot="select-trigger"')
  })

  it('比例 16:9 的宽 > 高，9:16 的高 > 宽', async () => {
    const sizeOf = (html: string) => {
      const m = /trg-shape[^>]*style="width:\s*(\d+)px;\s*height:\s*(\d+)px/.exec(html)
      return { w: Number(m?.[1]), h: Number(m?.[2]) }
    }
    const a = sizeOf(await render({ key: 'r', kind: 'ratio', type: 'select', options: opts(['16:9']) }, '16:9'))
    const b = sizeOf(await render({ key: 'r', kind: 'ratio', type: 'select', options: opts(['9:16']) }, '9:16'))
    expect(a.w).toBeGreaterThan(a.h)
    expect(b.h).toBeGreaterThan(b.w)
  })

  it('比例解析不出（auto）→ 虚线方块', async () => {
    const html = await render({ key: 'r', kind: 'ratio', type: 'select', options: opts(['auto']) }, 'auto')
    expect(html).toContain('is-dashed')
  })

  it('kind:ratio + columns → 按配置的列数排', async () => {
    const html = await render(
      { key: 'r', kind: 'ratio', type: 'select', columns: 2, options: opts(['1:1', '16:9', '9:16']) },
      '1:1',
    )
    expect(html).toContain('repeat(2, 1fr)')
  })

  it('作者自带 component 时，kind:ratio 也不抢', async () => {
    const Custom = defineComponent({
      name: 'MyRatio',
      props: { param: { type: Object, default: undefined }, modelValue: { type: null, default: undefined } },
      render() {
        return h('div', { 'data-custom-ratio': 'ok' })
      },
    })
    const html = await render(
      { key: 'ratio', kind: 'ratio', type: 'select', options: opts(['1:1']), component: Custom },
      '1:1',
    )
    expect(html).toContain('data-custom-ratio="ok"')
    expect(html).not.toContain('trg-grid')
  })
})

describe('resolveInlineSoleSelect：唯一一个普通下拉就铺到外面', () => {
  const sel = (n = 3, type = 'select'): ToolParamDef => ({
    key: 'k',
    type: type as ToolParamDef['type'],
    options: Array.from({ length: n }, (_, i) => ({ label: 'o' + i, value: 'v' + i })),
  })

  it('恰好一项 + 普通下拉 → 铺出去', () => {
    expect(resolveInlineSoleSelect([sel(20)])?.key).toBe('k')
    expect(resolveInlineSoleSelect([sel(5)])?.key).toBe('k')
  })

  it('那唯一一项是网格 / 滑块 / 比例 → 不铺', () => {
    expect(resolveInlineSoleSelect([{ key: 'g', type: 'grid', options: opts(['a', 'b']) }])).toBeUndefined()
    expect(resolveInlineSoleSelect([{ key: 'n', type: 'number', min: 1, max: 5 }])).toBeUndefined()
    expect(resolveInlineSoleSelect([{ key: 'r', kind: 'ratio', type: 'select', options: opts(['1:1']) }])).toBeUndefined()
  })

  it('两项以上 / 空 → 不铺', () => {
    expect(resolveInlineSoleSelect([sel(3), sel(3)])).toBeUndefined()
    expect(resolveInlineSoleSelect([])).toBeUndefined()
  })

  it('不是下拉（布尔 / 文本 / 数字）→ 不铺', () => {
    expect(resolveInlineSoleSelect([{ key: 'b', type: 'boolean' }])).toBeUndefined()
    expect(resolveInlineSoleSelect([{ key: 't', type: 'string' }])).toBeUndefined()
    expect(resolveInlineSoleSelect([{ key: 'n', type: 'number' }])).toBeUndefined()
  })

  it('作者自带 component → 不铺', () => {
    expect(resolveInlineSoleSelect([{ ...sel(20), component: { name: 'X' } }])).toBeUndefined()
  })
})

describe('参数面板版式', () => {
  it('宽度随内容，不写死 288px', () => {
    const css = readFileSync(new URL('../ToolParamGroup.vue', import.meta.url), 'utf-8')
    expect(css).toMatch(/width:\s*max-content/)
    expect(css).not.toMatch(/width:\s*288px/)
  })
})

describe('ui 目录登记名', () => {
  it('专属 UI 只有比例网格', () => {
    expect(PRESET_UI_NAMES.ratio).toBe('toolParamRatio')
    expect(Object.keys(PRESET_UI_NAMES)).toEqual(['ratio'])
  })
})

