/**
 * 文本 / 数字输入框的版式（用户 2026-11-08 截图：左侧文字贴边、像被裁掉一截）。
 *
 * 根因：`.tpf-input` 写了 `padding: 5px 8px`，把 shadcn Input 本体的 `px-3`（12px）
 * 盖成 8px，上下也从 8px 压到 5px —— 文字贴着圆角，垂直方向又偏上。
 * 同时写死的 `border-radius: 8px` 会顶掉主题圆角档位（--mct-radius）。
 *
 * 这类「覆盖组件本体尺寸」的错 SSR 断言不到样式，只能读源码锁住。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const src = readFileSync(resolve(__dirname, '../ToolParamField.vue'), 'utf8')

/** 取某个选择器的规则块内容 */
function blockOf(selector: string): string {
  const at = src.indexOf(selector)
  if (at < 0) return ''
  const open = src.indexOf('{', at)
  const close = src.indexOf('}', open)
  return open < 0 || close < 0 ? '' : src.slice(open + 1, close)
}

describe('输入框：尺寸交给组件库，自己只上色', () => {
  it('.tpf-input 不再用 padding 简写盖掉左右内边距', () => {
    const block = blockOf('.tpf-input {')
    expect(block, '找不到 .tpf-input 规则').not.toBe('')
    // `padding: 5px 8px` 会把 shadcn 的 px-3 压成 8px（真机实测过）
    expect(block).not.toMatch(/\bpadding\s*:/)
  })

  it('.tpf-input 不写死 border-radius（否则主题圆角档位失效）', () => {
    expect(blockOf('.tpf-input {')).not.toMatch(/border-radius\s*:/)
  })

  it('输入框高度与下拉触发器对齐（32px）', () => {
    const blocks = [...src.matchAll(/\.tpf-input \{([^}]*)\}/g)].map((m) => m[1])
    const all = blocks.join('\n')
    expect(all).toMatch(/height:\s*32px/)
  })

  it('上下留白明确给出（不依赖组件库的 py-1）', () => {
    const all = [...src.matchAll(/\.tpf-input \{([^}]*)\}/g)].map((m) => m[1]).join('\n')
    expect(all).toMatch(/padding-top:\s*6px/)
    expect(all).toMatch(/padding-bottom:\s*6px/)
  })
})

