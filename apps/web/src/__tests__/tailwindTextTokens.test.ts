/**
 * Tailwind 字号 token 不能被项目的字号阶梯覆盖。
 *
 * 用户口径（2026-11-02）：为什么只有下拉菜单一直出问题？
 * 根因之一是 `ui-theme.css` 在 :root 上定义了 `--text-sm: 11px` / `--text-xs: 10px`。
 * Tailwind v4 的 `text-sm` / `text-xs` 工具类编译出来就是 `font-size: var(--text-sm)`，
 * 于是组件库所有菜单行、对话框正文、按钮文字都被一起压小 —— 下拉菜单恰好整块都是
 * text-sm，所以看起来“只有下拉不对”。
 *
 * 这条测试钉住命名边界：项目自己的字号梯度改用 `--ui-text-*`；
 * `--text-*` 留给 Tailwind，不再在全局重新定义。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const themeCss = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../canvas-render/src/styles/ui-theme.css'),
  'utf-8',
)

describe('Tailwind 字号 token 命名边界', () => {
  it('不在全局定义 --text-xs / --text-sm / --text-base / --text-title', () => {
    for (const name of ['--text-xs', '--text-sm', '--text-base', '--text-title']) {
      const decl = new RegExp('^\\s*' + name + '\\s*:', 'm')
      expect(themeCss, name + ' 会覆盖 Tailwind 同名工具类').not.toMatch(decl)
    }
  })

  it('项目自己的阶梯用 --ui-text-* 前缀', () => {
    expect(themeCss).toMatch(/--ui-text-xs:\s*10px/)
    expect(themeCss).toMatch(/--ui-text-sm:\s*11px/)
    expect(themeCss).toMatch(/--ui-text-base:\s*13px/)
  })
})
