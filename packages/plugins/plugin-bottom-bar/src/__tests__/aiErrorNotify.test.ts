/**
 * AI 按钮失败的提示通道（用户 2026-11-20）。
 *
 * 用户口径：失败要弹全局 notify，不要在底栏里排一行错误小字 ——
 * 那行字会把右侧按钮区撑宽、把底栏挤成两行，而且错误消失后布局还回不去。
 * 这里钉住源码契约（运行时的 notify 由 ctx 提供，单测不装主题）。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (name: string): string =>
  readFileSync(fileURLToPath(new URL('../node-bottom-bar/' + name, import.meta.url)), 'utf8')

describe('AI 按钮失败的提示通道', () => {
  const logic = read('useBottomBarAiActions.ts')
  const actions = read('BottomBarActions.vue')
  const css = readFileSync(fileURLToPath(new URL('../node-bottom-bar/bottom-bar-cards.css', import.meta.url)), 'utf8')

  it('失败走 ctx 的 notify.error，不再只在底栏里显示', () => {
    expect(logic).toMatch(/tryGet<NotifyContract>\('notify'\)\?\.error\(/)
  })

  it('底栏里没有可见的错误小字（只留 sr-only 播报）', () => {
    expect(actions).not.toContain('class="nb-ai-error"')
    expect(actions).toMatch(/role="alert"/)
    expect(actions).toContain('sr-only')
    // 样式也删掉：留着会让后来又有人把可见元素挂回这个类
    expect(css).not.toMatch(/^\.nb-ai-error\s*\{/m)
  })
})
