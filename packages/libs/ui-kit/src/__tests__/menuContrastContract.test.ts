/**
 * 弹层状态色契约：高亮 = 半透明 hover 底；真正选中 = 只用默认勾，不铺整行色底。
 *
 * 用户口径（2026-11-02）：下拉一打开第一行就是青底、暗色下字还发黑；
 * 这是把「键盘高亮」当成了「选中」。2026-11-03 又补充：选中统一只用勾，
 * 不再额外加主题色底。这里扫描 CSS 防漂移。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const css = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../styles/host.css'),
  'utf-8',
)

describe('弹层状态色：高亮与选中分开', () => {
  it('[data-highlighted] 的五类行使用半透明 hover 底，不再抢强调色', () => {
    for (const slot of ['select-item', 'dropdown-menu-item', 'context-menu-item', 'menubar-item', 'combobox-item']) {
      const re = new RegExp("\\[data-slot='" + slot + "'\\]\\[data-highlighted\\][^{]*\\{([^}]*)\\}")
      const m = css.match(re)
      expect(m, slot + ' 缺高亮规则').toBeTruthy()
      expect(m![1]).toContain('var(--ui-hover')
      expect(m![1]).not.toContain('var(--ui-accent)')
    }
  })

  it('选中项（data-state=checked）只用勾，不再铺主题色底', () => {
    expect(css).toMatch(/\[data-slot='dropdown-menu-radio-item'\]\[data-state='checked'\][^{]*\{[^}]*background-color: transparent/)
    expect(css).toMatch(/\[data-slot='select-item'\]\[data-state='checked'\][^{]*\{[^}]*background-color: transparent/)
    // checked 行被悬停 / 键盘高亮时，浅灰底仍要回来
    expect(css).toMatch(/\[data-slot='dropdown-menu-radio-item'\]\[data-state='checked'\]\[data-highlighted\][^{]*\{[^}]*var\(--ui-hover/)
    expect(css).not.toMatch(/\[data-slot='dropdown-menu-item'\]\.bg-accent/)
    expect(css).not.toMatch(/\[data-slot='select-item'\]\.bg-accent/)
  })

  it('内部元素跟随 inherit（次级小字不残留深色）', () => {
    expect(css).toMatch(/\[data-slot='select-item'\]\[data-highlighted\] \*[^{]*\{[^}]*color: inherit/)
  })
})
