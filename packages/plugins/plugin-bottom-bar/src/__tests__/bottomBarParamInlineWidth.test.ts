/**
 * 参数区内联下拉：**按内容宽，最小 80、最大 220**。
 *
 * 用户 2026-11-09 定稿口径：「我这边只需要它满足最小宽度，最大宽度限制一下，
 * 而不是这种固定的宽度」。场景是动作的唯一参数是下拉，会铺到底栏那一行。
 *
 * 走过的弯路（别再回去）：
 * 1. 只给内联那格撑到 148px —— 模型那格按内容到了 183px，还是一大一小；
 * 2. 两格 flex: 1 1 0 平分 —— 确实等宽，但两个下拉都撑到 220px，
 *    值很短时右边空一大片（用户截图：「扩展到全屏干啥」）。
 *
 * 现在的做法：这一格 flex: none（不抢剩余空间，值短就窄）+ 下限 80 + 上限 220。
 * 模型下拉那格（.nb-field--action）的 148～220 是它自己的口径，这次不动。
 */
import { describe, expect, it } from 'vitest'
import { readBottomBarCss } from './readBottomBarCss'

const CSS = readBottomBarCss().replace(/\/\*[\s\S]*?\*\//g, '')

function blockOf(selector: string): string {
  const at = CSS.indexOf(selector + ' {')
  if (at < 0) throw new Error('找不到样式块：' + selector)
  const open = CSS.indexOf('{', at)
  const close = CSS.indexOf('}', open)
  return CSS.slice(open + 1, close)
}

describe('参数区内联下拉：按内容宽而不是固定宽', () => {
  it('这一格不参与 flex 分配（值短就该窄）', () => {
    const body = blockOf('.nb-field--params:has(.tpg-inline)')
    expect(body).toMatch(/flex:\s*none/)
    expect(body, '不该再写 flex: 1 1 0（那会把两格拉满）').not.toMatch(/flex:\s*1 1 0/)
  })

  it('下限 80、上限 220', () => {
    const body = blockOf('.nb-field--params:has(.tpg-inline)')
    expect(body).toMatch(/min-width:\s*80px/)
    expect(body).toMatch(/max-width:\s*220px/)
  })

  it('模型下拉那格的口径不受影响', () => {
    const body = blockOf('.nb-field--action')
    expect(body).toMatch(/min-width:\s*148px/)
    expect(body).toMatch(/max-width:\s*220px/)
  })

  /* 触发器填满那一格：格子宽度已由 max-content + 80/220 定死，触发器缩会窄出一圈 */
  it('触发器填满那一格', () => {
    const body = blockOf(".nb-field--params .tpg-inline [data-slot='select-trigger']")
    expect(body).toMatch(/width:\s*100%/)
  })

  it('.tpg-inline 自己的下限也是 80（与这一格对齐）', () => {
    expect(blockOf('.nb-field--params .tpg-inline')).toMatch(/min-width:\s*80px/)
  })

  it('摘要按钮那一格不受影响（仍按内容收缩）', () => {
    expect(blockOf('.nb-field--params')).toMatch(/flex:\s*0 1 auto/)
  })
})

