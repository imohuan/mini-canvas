/**
 * 底栏最左侧 @ 按钮（用户 2026-11-06）。
 *
 * 行为契约：点一下 = 在当前光标处插一个 @ 字符，编辑器自己弹 @ 菜单。
 * 这里钉住三件事：按钮存在、只插 @、调用编辑器的 insertText。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ACTIONS = readFileSync(fileURLToPath(new URL('../node-bottom-bar/BottomBarActions.vue', import.meta.url)), 'utf8')
const BAR = readFileSync(fileURLToPath(new URL('../NodeBottomBar.vue', import.meta.url)), 'utf8')

describe('底栏 @ 按钮', () => {
  it('按钮在底部行最左侧，带无障碍名', () => {
    const i = ACTIONS.indexOf('class="nb-icon-btn nb-at-btn"')
    expect(i).toBeGreaterThan(-1)
    // 在 .nb-selects（模型下拉）之前
    expect(i).toBeLessThan(ACTIONS.indexOf('class="nb-selects"'))
    expect(ACTIONS).toContain('aria-label="插入 @ 引用素材"')
  })

  it('点击只做一件事：通知父组件插入 @（不自己拼 DOM / 不自己开菜单）', () => {
    expect(ACTIONS).toContain("@click.stop=\"emit('insertAt')\"")
    expect(ACTIONS).not.toMatch(/insertAt[\s\S]{0,80}querySelector/)
  })

  it('父组件调用编辑器的 insertText 插一个 @', () => {
    expect(BAR).toContain('editorComponentRef.value?.insertText?.') 
    expect(BAR).toMatch(/insertText\?\.\('@'\)/)
  })
})
