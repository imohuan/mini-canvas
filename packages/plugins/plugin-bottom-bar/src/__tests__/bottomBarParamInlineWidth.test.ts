/**
 * 底栏两个下拉必须**一样宽**（用户 2026-11-09，带截图：「你管这个叫 340」之后的一轮）。
 *
 * 场景：动作的唯一参数是下拉，铺到底栏那一行，左边是模型下拉。
 * 用户口径：「这个下拉的宽度跟我这边的下拉不匹配」。
 *
 * 走过的弯路（别再回去）：
 * 1. 只给内联那格撑到 148px —— 模型那格按内容到了 183px，还是一大一小；
 * 2. 给两格各写死一个宽度 —— 模型名长短一变就溢出或留白。
 *
 * 现在的做法：两格同一条规则 `flex: 1 1 0` + 相同的 min/max，
 * 由这一行的富余空间平分，量出来永远相等（实测 220 = 220）。
 * 只在内联形态生效：参数是摘要按钮（tpg-root）时仍按内容收缩，
 * 否则「16:9」那种短摘要会被拉成一条长按钮（2026-10-14 用户明确否掉过）。
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

describe('参数区内联下拉：与模型下拉等宽', () => {
  it('两格共用同一条平分规则，且只在内联形态生效', () => {
    const at = CSS.indexOf('.nb-field--params:has(.tpg-inline)')
    expect(at, '找不到同时管两格的规则').toBeGreaterThan(-1)
    const head = CSS.slice(CSS.lastIndexOf('}', at) + 1, CSS.indexOf('{', at))
    expect(head).toContain('.nb-field--action')
    expect(head).toContain('.nb-field--params:has(.tpg-inline)')

    const body = blockOf('.nb-field--params:has(.tpg-inline)')
    expect(body).toMatch(/flex:\s*1 1 0/)
    expect(body).toMatch(/min-width:\s*148px/)
    expect(body).toMatch(/max-width:\s*220px/)
  })

  it('触发器铺满那一格（否则内部还是按内容 w-fit）', () => {
    expect(blockOf(".nb-field--params .tpg-inline [data-slot='select-trigger']")).toMatch(/width:\s*100%/)
  })

  it('摘要按钮那一格不受影响（仍按内容收缩）', () => {
    expect(blockOf('.nb-field--params')).toMatch(/flex:\s*0 1 auto/)
  })
})
