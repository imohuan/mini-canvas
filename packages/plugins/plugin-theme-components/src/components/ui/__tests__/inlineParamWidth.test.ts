/**
 * 内联参数下拉的宽度契约（用户 2026-11-09：「这个下拉宽度太窄，跟左边模型下拉不匹配」）。
 *
 * 形态 2：动作只有一个下拉参数时，ToolParamGroup 直接把它铺到底栏那一行，
 * 和左边的模型下拉并排。它默认只有 74px（SelectTrigger 自带 `w-fit`），
 * 模型下拉 183px 起，一大一小很明显。
 *
 * 两层一起管住：
 * 1. 组件自己：`.tpg-inline` 给定下限，并要求带 `!important`
 *    （用户明确要求：SelectTrigger 自带的 min-width 会压住这一层）。
 * 2. 组件自己：触发器铺满外层那一格。必须写在**全局**样式里 ——
 *    Trigger 是调用方通过 slot 传进来的，DOM 上没有本组件的 scoped 属性。
 *
 * 真正「两格等宽」由底栏那份样式给出（flex: 1 1 0 + 相同上下限），
 * 契约在 plugin-bottom-bar 的 bottomBarParamInlineWidth.test.ts 里。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const group = readFileSync(resolve(__dirname, '../ToolParamGroup.vue'), 'utf8')

function blockOf(selector: string): { body: string; scoped: boolean } {
  const at = group.indexOf(selector + ' {')
  if (at < 0) throw new Error('找不到样式块：' + selector)
  const open = group.indexOf('{', at)
  const close = group.indexOf('}', open)
  // 找在这个块之前、最近的一个 <style 标签，判断是不是 scoped
  const before = group.slice(0, at)
  const lastStyle = before.lastIndexOf('<style')
  const scoped = before.slice(lastStyle, lastStyle + 40).includes('scoped')
  return { body: group.slice(open + 1, close), scoped }
}

describe('内联下拉：宽度对齐模型下拉', () => {
  it('.tpg-inline 有下限，且带 !important（用户点名要求）', () => {
    const { body } = blockOf('.tpg-inline')
    const min = /min-width\s*:\s*([^;]+);/.exec(body)?.[1]?.trim() ?? ''
    expect(min, '找不到 min-width').not.toBe('')
    expect(min).toMatch(/\d+px/)
    expect(min).toContain('!important')
  })

  it('触发器铺满外层那一格，且规则写在全局样式里（slot 传进来的 DOM 没有 scoped 属性）', () => {
    const { body, scoped } = blockOf(".tpg-inline [data-slot='select-trigger']")
    expect(body).toMatch(/width:\s*100%/)
    expect(scoped, '必须写在非 scoped 的全局 style 块里').toBe(false)
  })
})
