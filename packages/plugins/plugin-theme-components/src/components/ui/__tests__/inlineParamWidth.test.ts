/**
 * 内联参数下拉的宽度契约（用户 2026-11-09，两次纠正后定稿）。
 *
 * 形态 2：动作只有一个下拉参数时，ToolParamGroup 直接把它铺到底栏那一行。
 *
 * 定稿口径：「我这边只需要它满足最小宽度，最大宽度限制一下，而不是这种固定的宽度」。
 * 也就是**按内容宽**：值两个字就窄、名字长就宽，中间给上下限兜住。
 *
 * 走过的弯路（别再回去）：
 * 1. 什么都不给 —— 74px，和左边模型下拉并排像条缝；
 * 2. width: 100% 铺满那一格 —— 值很短时右边空一大片（用户：「扩展到全屏干啥」）。
 *
 * 三层各管一件：
 * 1. .tpg-inline：width: max-content + 下限 80（带 !important，SelectTrigger 自带的
 *    min-width 会压住这一层，这是用户明确要求的）+ 上限 100%（父格已经把上限限到 220）；
 * 2. 触发器：width: auto（按内容收窄），且规则必须写在全局 style 块里 ——
 *    Trigger 是调用方通过 slot 传进来的，DOM 上没有本组件的 scoped 属性。
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

describe('内联下拉：按内容宽 + 80 下限', () => {
  it('下限 80，且带 !important（用户点名要求）', () => {
    const { body } = blockOf('.tpg-inline')
    const min = /min-width\s*:\s*([^;]+);/.exec(body)?.[1]?.trim() ?? ''
    expect(min, '找不到 min-width').not.toBe('')
    expect(min).toBe('80px !important')
  })

  it('不写死 width: 100%（那会撑满父格、右边空一大片）', () => {
    const { body } = blockOf('.tpg-inline')
    // 只看裸的 width，不误伤 max-width / min-width（它们前面还带着 max- / min-）
    expect(body).not.toMatch(/(?:^|[;\s])width:\s*100%/)
    expect(body).toMatch(/width:\s*max-content/)
  })

  /*
   * 触发器只要**填满那一格**就行：格子宽度已经是 max-content + 80/100% 定的，
   * 触发器再按内容缩会窄出 7px（内容 73、格子 80，看着像按钮比格子小一圈）。
   */
  it('触发器填满那一格，且规则写在全局样式里（slot 传进来的 DOM 没有 scoped 属性）', () => {
    const { body, scoped } = blockOf(".tpg-inline [data-slot='select-trigger']")
    expect(body).toMatch(/width:\s*100%/)
    expect(scoped, '必须写在非 scoped 的全局 style 块里').toBe(false)
  })
})

