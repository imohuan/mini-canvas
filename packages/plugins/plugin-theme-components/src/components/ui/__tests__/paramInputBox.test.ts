/**
 * 参数面板左边缘的裁剪契约（用户 2026-11-09，两次截图）。
 *
 * 现象：输入框聚焦时，左侧那圈聚焦环被切成一条竖线，右侧却是完整圆弧。
 * 原因（12 倍放大 A/B 实测）：ScrollArea 的 viewport 是 `overflow: hidden`，
 * 按自己的边框盒裁剪；shadcn 的聚焦环是向外扩 3px 的 box-shadow，
 * 正好落在裁剪线外侧。未聚焦时边框完整，一聚焦就缺一角。
 *
 * 为什么不能靠改输入框：加 margin / padding 会让它比同列标题更窄，整块看着变形。
 * 为什么不能 `overflow-x: visible`：CSS 规定一轴 visible、另一轴不是时，
 * visible 被当成 auto；纵向要滚，横向就永远是 hidden。
 *
 * 采用的解法：把 4px 从外层 padding 挪到内容层 —— 总留白不变（16），
 * 内容位置不变，只是裁剪边界向右让出 4px（3px 环 + 1px 余量）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const group = readFileSync(resolve(__dirname, '../ToolParamGroup.vue'), 'utf8')

function blockOf(selector: string): string {
  const at = group.indexOf(selector)
  if (at < 0) return ''
  const open = group.indexOf('{', at)
  const close = group.indexOf('}', open)
  return open < 0 || close < 0 ? '' : group.slice(open + 1, close)
}

describe('滚动视口要给聚焦环留位置', () => {
  it('外层左侧留白是 12（不是 16），让出 4px 给裁剪边界', () => {
    const block = blockOf('.tpg-popover {')
    const pad = /padding:\s*([^;]+);/.exec(block)?.[1]?.trim() ?? ''
    expect(pad, '找不到 .tpg-popover 的 padding').not.toBe('')
    const parts = pad.split(/\s+/).filter(Boolean)
    // padding: top right bottom left
    expect(parts.length).toBe(4)
    expect(parts[3], '左侧应为 12px：' + pad).toBe('12px')
  })

  it('内容层补回那 4px，左右合计仍是 16', () => {
    const block = blockOf('.tpg-scroll .tpg-menu {')
    expect(block, '找不到 .tpg-scroll .tpg-menu 规则').not.toBe('')
    expect(block).toMatch(/padding-left:\s*4px/)
    expect(block).toMatch(/padding-right:\s*12px/)
  })

  it('输入框自己不加 margin / padding（那会让它比标题窄）', () => {
    const field = readFileSync(resolve(__dirname, '../ToolParamField.vue'), 'utf8')
    const at = field.indexOf('.tpf-input {')
    const open = field.indexOf('{', at)
    const close = field.indexOf('}', open)
    const block = field.slice(open + 1, close)
    expect(block).not.toMatch(/\bmargin/)
    expect(block).not.toMatch(/\bpadding/)
  })
})

