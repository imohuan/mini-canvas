/**
 * 底栏这一行的**空间韧性**（用户 2026-11-17 反复报的「重叠」）。
 *
 * 现场：右侧 AI 按钮个数由用户配置决定，可能很多；两个下拉的文字长度也由 provider 决定。
 * 只要有一边 flex:none 又没上限，另一边的字符就会被顶出去叠在一起。
 *
 * 这里锁三件事：
 * 1. 底栏那行允许折行，窄屏时右侧落到下一行；
 * 2. 两个下拉所在的 .nb-selects 有明确的下限（不许被压成 0）；
 * 3. 发送按钮带文字时有上限，不会把左边吃掉。
 */
import { describe, expect, it } from 'vitest'
import { readBottomBarCss } from './readBottomBarCss'

const CSS = readBottomBarCss().replace(/\/\*[\s\S]*?\*\//g, '')

function blockOf(selector: string): string {
  /*
   * 必须匹配「行首选择器」，不能用 indexOf。
   *
   * 反例：查 .nb-actions 会先命中 .nb-bottom.is-stacked .nb-actions 里的子串，
   * 于是断言读到的是别的块 —— 测试因此误报（用户 2026-11-18 这次就踩到了）。
   */
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp('(?:^|\\n)' + escaped + ' \\{')
  const m = re.exec(CSS)
  if (!m) throw new Error('找不到样式块：' + selector)
  const open = CSS.indexOf('{', m.index)
  const close = CSS.indexOf('}', open)
  return CSS.slice(open + 1, close)
}

describe('底栏底部行：任何情况都不重叠', () => {
  /**
   * 折行不再是 CSS 自己决定的（用户 2026-11-18：「明明放得下却换行」）。
   *
   * 现在默认 nowrap，只有 JS 算出「一行放不下」时加 .is-stacked 才折行 ——
   * 那条类名的规则必须真的存在，否则窄屏会被压扁。
   */
  it('.nb-bottom 默认不折行，只有 .is-stacked 时才折行', () => {
    expect(blockOf('.nb-bottom')).toMatch(/flex-wrap:\s*nowrap/)
    expect(blockOf('.nb-bottom.is-stacked')).toMatch(/flex-wrap:\s*wrap/)
  })

  it('.nb-selects 有下限，不会被右侧按钮压成 0', () => {
    const body = blockOf('.nb-selects')
    expect(body).toMatch(/min-width:\s*0/)
    // 关键：flex-basis 给了可读下限，而不是 flex: 1 1 auto（那会一路压到 0）
    expect(body).toMatch(/flex:\s*1 1 (\d+)px/)
    const basis = Number(/flex:\s*1 1 (\d+)px/.exec(body)?.[1] ?? 0)
    expect(basis).toBeGreaterThanOrEqual(200)
  })

  /**
   * AI 按钮超量时收进「更多」菜单，而不是让这一组自己折行（用户 2026-11-18）：
   * 折行会把字数 / 发送按钮挤到第二行，而折叠只会多一个「…」按钮。
   */
  it('.nb-actions 不折行、宽度有上限，且不被写死 flex:none', () => {
    const body = blockOf('.nb-actions')
    expect(body).toMatch(/flex-wrap:\s*nowrap/)
    expect(body).toMatch(/max-width:\s*100%/)
    expect(body, '不许再写 flex: none（那会让按钮溢出）').not.toMatch(/flex:\s*none/)
  })
})

describe('发送按钮：图标 + 文字', () => {
  it('带文字时宽度交给内容，但有明确上限', () => {
    const body = blockOf('.nb-run.has-text')
    expect(body).toMatch(/width:\s*auto/)
    expect(body).toMatch(/max-width:\s*\d+px/)
    const max = Number(/max-width:\s*(\d+)px/.exec(body)?.[1] ?? 0)
    expect(max).toBeGreaterThan(80)
    expect(max, '上限太大又会把两个下拉挤掉').toBeLessThanOrEqual(200)
  })

  it('按钮里的文字过长时省略号，不撑破按钮', () => {
    const body = blockOf('.nb-send-text')
    expect(body).toMatch(/text-overflow:\s*ellipsis/)
    expect(body).toMatch(/white-space:\s*nowrap/)
    expect(body).toMatch(/min-width:\s*0/)
  })
})
