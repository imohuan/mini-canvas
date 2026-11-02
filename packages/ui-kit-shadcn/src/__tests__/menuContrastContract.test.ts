/**
 * 弹层高亮态配色契约：实色强调底必须配 --ui-on-accent 前景。
 *
 * 用户口径（2026-11-02）：下拉选中行「青底黑字」，把主题背景调暗后看不清。
 * host.css 现在把 [data-highlighted] 的底/字收紧成一对；这里扫描 CSS，
 * 保证这对规则存在且值正确（防以后改样式时漂移）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const css = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../styles/host.css'),
  'utf-8',
)

describe('弹层高亮配色：实色强调底 + on-accent 前景', () => {
  it('[data-highlighted] 的五类行都有 background: --ui-accent + color: --ui-on-accent', () => {
    for (const slot of ['select-item', 'dropdown-menu-item', 'context-menu-item', 'menubar-item', 'combobox-item']) {
      const re = new RegExp("\\[data-slot='" + slot + "'\\]\\[data-highlighted\\][^{]*\\{([^}]*)\\}")
      const m = css.match(re)
      expect(m, slot + ' 缺高亮规则').toBeTruthy()
      expect(m![1]).toContain('var(--ui-accent)')
      expect(m![1]).toContain('var(--ui-on-accent')
    }
  })

  it('内部元素跟随 inherit（次级小字不残留深色）', () => {
    expect(css).toMatch(/\[data-slot='select-item'\]\[data-highlighted\] \*[^{]*\{[^}]*color: inherit/)
  })
})
