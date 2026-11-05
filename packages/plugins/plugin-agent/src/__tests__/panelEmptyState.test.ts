/**
 * 输入区面板的空态与高度契约（用户口径 2026-11-05）：
 *
 * 截图里技能面板同时出现「还没有安装技能」和「没有找到技能」两块空态，
 * 分栏左栏（分类 / 全部）被顶到面板最底下、压在底栏上。
 * 根因：没有技能时，空态和卡片/分栏两种视图同时渲染（各自还带一个空态）。
 *
 * 同时钉住「面板高度不能超出视口」：窄窗口里分栏面板原本写死 440px，
 * 会把输入区整块盖住。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readSfcWithStyles } from './readSfcWithStyles'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = readSfcWithStyles(path.resolve(HERE, '../ui/conversation/AgentComposer.vue'))

function skillPanel(): string {
  const start = SRC.indexOf('ac-skill-panel')
  expect(start, '找不到技能面板').toBeGreaterThan(-1)
  return SRC.slice(start, start + 7000)
}

describe('技能面板：空态只出现一次', () => {
  it('视图容器在「没有技能」时整体不渲染（v-else-if，而不是另一个 v-if）', () => {
    const panel = skillPanel()
    expect(panel, '卡片视图仍是独立的 v-if，会和空态同时出现').not.toMatch(/v-if="skillView === 'card'"/)
    expect(panel).toMatch(/v-else-if="skillView === 'card'"/)
  })

  it('没有技能时视图开关不渲染（没有可切换的东西）', () => {
    expect(skillPanel()).toMatch(/<Tabs v-if="s\.skills\.length"/)
  })
})

describe('面板高度不越出视口', () => {
  it('模型 / 技能 / MCP 的最大高度都按视口收', () => {
    for (const name of ['模型', '技能', 'MCP']) {
      expect(SRC, name + ' 面板仍写死 440px').not.toMatch(/maxHeight: '440px' \}/)
    }
    expect(SRC.match(/maxHeight: 'min\(440px, calc\(100dvh - 120px\)\)'/g)?.length ?? 0).toBeGreaterThanOrEqual(3)
  })

  it('窄窗口里不再横向溢出', () => {
    expect(SRC).toMatch(/maxWidth: 'calc\(100vw - 24px\)'[^}]*maxHeight/)
  })
})
