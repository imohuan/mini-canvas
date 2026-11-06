/**
 * 面板容器尺寸必须恒定（用户 2026-11-06：技能页签点「卡片」有时没反应）。
 *
 * 真机复现到的根因：
 *   菜单贴着触发按钮、按自身尺寸重新定位。切视图时容器宽 340↔588、高 312↔443
 *   一起变，菜单整体上移（页签从 y=463 跳到 y=332）。用户点下那一刻按钮已不在
 *   原处 —— 点击落空，还会被判成「点了外面」把菜单关掉。
 *
 * 所以：同一面板的卡片 / 分栏视图必须**同宽同高**，尺寸不随视图变。
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

describe('面板尺寸不随视图切换', () => {
  it('技能面板宽度不按视图分支（固定一档，窄到放不下时由 maxWidth 兜）', () => {
    const at = SRC.indexOf('aria-label="选择技能"')
    const openTag = SRC.slice(SRC.lastIndexOf('<DropdownMenuContent', at), at)
    expect(openTag).not.toMatch(/skillView === 'split'/)
  })

  it('模型面板宽度同样不按视图分支', () => {
    const at = SRC.indexOf('aria-label="选择模型"')
    const openTag = SRC.slice(SRC.lastIndexOf('<DropdownMenuContent', at), at)
    expect(openTag).not.toMatch(/modelView === 'split'/)
  })

  it('分栏视图不再单独抬高面板（高度必须与卡片一致）', () => {
    const at = CSS.indexOf('.ac-panel.is-split {')
    expect(at).toBeGreaterThan(-1)
    const block = CSS.slice(at, CSS.indexOf('\n}', at))
    // 允许与 .ac-panel 相同的 min-height，不允许更大的 clamp/vh 数值
    expect(block).not.toMatch(/clamp\(\s*3[5-9]\dpx/)
    expect(block).not.toMatch(/5[0-9]vh|56vh|58vh/)
  })
})

