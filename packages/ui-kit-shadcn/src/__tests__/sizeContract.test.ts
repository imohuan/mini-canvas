/**
 * 全局尺寸档位契约：显式 size 必须受 --mct-size-* 影响。
 *
 * 用户口径（2026-11-02）：设置里选「紧凑」，size="icon-sm" 的按钮也要一起变小。
 * 这份契约钉住两条：
 * 1) size.css 的 icon/sm/xs 档全部以 --mct-size-control-h 为基准（calc 偏移），
 *    不是写死的 px/rem —— 用户切档时它们一起缩放。
 * 2) 图标按钮仍是正方形（width === height 的同一条 calc）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const css = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../styles/size.css'),
  'utf-8',
)

function ruleFor(attr: string): string {
  // 抓「[data-size='icon-sm']」那条规则的声明体（选择器两行 + { … }）
  const re = new RegExp("\\[data-size='" + attr + "'\\][^{]*\\{([^}]*)\\}")
  const m = css.match(re)
  expect(m, 'size.css 里找不到 ' + attr + ' 档').toBeTruthy()
  return m![1]!
}

describe('size.css：显式 size 是相对档位', () => {
  it('icon-sm / icon-xs 以 --mct-size-control-h 为基准（不写死 rem）', () => {
    expect(ruleFor('icon-sm')).toContain('calc(var(--mct-size-control-h')
    expect(ruleFor('icon-xs')).toContain('calc(var(--mct-size-control-h')
  })

  it('icon 档宽高一致（保持正方形）', () => {
    const body = ruleFor('icon')
    expect(body).toContain('width: var(--mct-size-control-h')
    expect(body).toContain('height: var(--mct-size-control-h')
  })

  it('select-trigger 的 sm 档同样按全局档偏移', () => {
    const body = ruleFor('sm').includes('select-trigger') || css.includes("[data-slot='select-trigger'][data-size='sm']")
    expect(body).toBe(true)
    expect(css).toMatch(/\[data-slot='select-trigger'\]\[data-size='sm'\][^{]*\{[^}]*calc\(var\(--mct-size-control-h/)
  })

  it('每条尺寸规则都以 html[data-mct-size] 为前提（inherit 档不命中）', () => {
    const bare = css.split('\n').filter((l) => l.includes('[data-size=') && !l.trim().startsWith('*') && !l.includes('html[data-mct-size]') && l.trim().endsWith(','))
    expect(bare, '有规则没挂在 html[data-mct-size] 下：\n' + bare.join('\n')).toEqual([])
  })
})
