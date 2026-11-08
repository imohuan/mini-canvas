/**
 * Base64 图标的显示尺寸必须由 CSS 定（用户 2026-11-08 截图：列表里图标一格空白）。
 *
 * 根因：图标托 `.ac-model-brand` 只给 `:deep(svg)` 定了 22px，`<img>` 没有规则 ——
 * 1×1 的 PNG 按原始像素画成一个点，看着就是空的；大图又会撑破 35px 的托。
 * 触发器那边原来也是这样，一起补上。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8')

describe('provider 图标的 <img> 尺寸', () => {
  it('Agent 面板的图标托约束 img', () => {
    const css = read('../agent-composer/part3.css')
    const block = /\.ac-model-brand :deep\(img\) \{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(block, '缺少 .ac-model-brand :deep(img) 规则').not.toBe('')
    expect(block).toMatch(/width:\s*22px/)
    expect(block).toMatch(/height:\s*22px/)
    expect(block).toMatch(/object-fit:\s*contain/)
  })

  it('分栏左栏的图标也约束 img', () => {
    const css = readFileSync(resolve(__dirname, '../agent-composer/part4.css'), 'utf8')
    const blocks = [...css.matchAll(/\.ac-rail-brand :deep\(img\) \{([^}]*)\}/g)].map((m) => m[1])
    expect(blocks.length, '缺少 .ac-rail-brand :deep(img) 规则').toBeGreaterThan(0)
    expect(blocks[0]).toMatch(/width:\s*14px/)
    expect(blocks[0]).toMatch(/object-fit:\s*contain/)
  })

  it('底栏触发器的徽标约束 img', () => {
    const css = readFileSync(
      resolve(__dirname, '../../../../../plugin-bottom-bar/src/node-bottom-bar/bottom-bar-editor-footer.css'),
      'utf8',
    )
    const block = /\.nb-model-badge img \{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(block, '缺少 .nb-model-badge img 规则').not.toBe('')
    expect(block).toMatch(/width:\s*14px/)
    expect(block).toMatch(/height:\s*14px/)
    expect(block).toMatch(/object-fit:\s*contain/)
  })
})
