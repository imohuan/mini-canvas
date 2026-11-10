/**
 * 「切换动作后同名参数串值」的回归（用户 2026-11-09 截图）。
 *
 * 场景：两个动作都声明了 `model`，但候选值不同 ——
 * 第一个是 v2/v2-pro/…，第二个是 a/b/c。
 * 从第一个切到第二个时，旧值 `v2` 既不在新候选里、又盖住了 default `a`，
 * 于是唯一那个下拉匹配不到任何选项，显示成空白占位符。
 *
 * 根因：`selectAction` 的「保留用户参数」只按 key 判断存在，不看值是否还合法。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const src = readFileSync(resolve(__dirname, '../node-bottom-bar/useBottomBarActions.ts'), 'utf8')

describe('换动作时参数的合法性校验', () => {
  it('保留参数时检查值是否还在新动作的候选里', () => {
    // 只按 key 判断的旧写法：if (p.key in values.value) kept[p.key] = values.value[p.key]
    expect(src).not.toMatch(/if \(p\.key in values\.value\) kept\[p\.key\] = values\.value\[p\.key\]/)
    expect(src).toContain('valueFitsField')
  })

  it('空串不算合法（否则会盖掉新动作的 default）', () => {
    const fn = /function valueFitsField[\s\S]*?\n  \}/.exec(src)?.[0] ?? ''
    expect(fn).not.toBe('')
    expect(fn).toMatch(/v === ''/)
  })

  it('没有候选值的参数（数值 / 文本 / 开关）一律算合法', () => {
    const fn = /function valueFitsField[\s\S]*?\n  \}/.exec(src)?.[0] ?? ''
    expect(fn).toMatch(/if \(!hasOptions\) return true/)
  })

  /**
   * 账号选择不是动作参数，`fields` 循环看不到它 —— 必须单独保留，
   * 否则换个模型就把「用哪个号」忘了（用户 2026-11-10）。
   */
  it('换动作时保留已选账号（新动作同平台且确实有这个号）', () => {
    expect(src).toContain('__accountId')
    const block = /const pickedAccount[\s\S]*?kept\.__accountId = pickedAccount/.exec(src)?.[0] ?? ''
    expect(block).not.toBe('')
    expect(block).toMatch(/nextAccounts\?\.some/)
  })
})

