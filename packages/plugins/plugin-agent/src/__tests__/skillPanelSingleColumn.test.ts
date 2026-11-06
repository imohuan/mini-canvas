/**
 * 技能面板：单列 + 与模型卡片同宽（用户 2026-11-06）。
 *
 * 之前技能面板按 588px 宽、卡片挤成两列；用户要求「默认只显示一列，
 * 宽度和模型卡片模式一样」。同宽之后分栏视图只剩 340px，
 * 左栏必须变成横向分类条，否则会把右侧内容整个挤掉。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readSfcWithStyles } from './readSfcWithStyles'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = readSfcWithStyles(path.resolve(HERE, '../ui/conversation/AgentComposer.vue'))
const CSS = ['part1.css', 'part2.css', 'part3.css', 'part4.css']
  .map((f) => readFileSync(path.resolve(HERE, '../ui/conversation/agent-composer', f), 'utf8'))
  .join('\n')

describe('技能面板宽度与卡片列数', () => {
  it('技能面板固定 340px，与模型卡片模式同宽', () => {
    // 技能面板的 DropdownMenuContent：定位到「选择技能」之后第一个 DropdownMenuContent
    const at = SRC.indexOf('aria-label="选择技能"')
    const tagStart = SRC.indexOf('<DropdownMenuContent', at)
    expect(tagStart).toBeGreaterThan(-1)
    const tag = SRC.slice(tagStart, SRC.indexOf('>', tagStart))
    expect(tag).toContain("width: '340px'")
    expect(tag).not.toContain('588')
  })

  it('技能卡片单列', () => {
    const at = CSS.indexOf('.ac-skill-grid {')
    expect(at).toBeGreaterThan(-1)
    const block = CSS.slice(at, CSS.indexOf('\n}', at))
    expect(block).toMatch(/grid-template-columns:\s*repeat\(1,/)
    // 只看真正的声明（注释里解释了为什么不用 auto-fill）
    expect(block).not.toMatch(/^\s*grid-template-columns:[^;]*auto-fill/m)
  })

  /** 340px 宽时分栏必须横排：左栏占 44px 高，右侧内容才有位置 */
  it('窄容器里分栏左栏改成横向分类条', () => {
    const at = CSS.indexOf('@container (max-width: 460px)')
    expect(at).toBeGreaterThan(-1)
    const block = CSS.slice(at)
    // 左栏：横向排 + 高度收到一行
    expect(block).toMatch(/\.ac-rail-scroll :deep\(\.ac-rail-scroll-body\) \{[^}]*flex-direction:\s*row/)
    expect(block).toMatch(/\.ac-split-rail \{[^}]*max-height:\s*44px/)
  })
})

