/**
 * 技能面板的底栏（用户 2026-11-06）。
 *
 * 「点击技能会直接插入标签」那句话占一整条 36px 的底栏、还把列表下方空出一块；
 * 用户要求删掉，并把底部呼吸改成面板容器的 padding-bottom。
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

/** 技能面板容器内部的片段 */
function skillPanel(): string {
  const at = SRC.indexOf('ac-skill-panel')
  expect(at).toBeGreaterThan(-1)
  return SRC.slice(at, at + 9000)
}

describe('技能面板底栏', () => {
  it('不再显示「点击技能会直接插入标签」', () => {
    expect(SRC).not.toContain('点击技能会直接插入标签')
  })

  it('技能面板里没有底栏（模型 / MCP 的底栏保留）', () => {
    const panel = skillPanel()
    expect(panel).not.toContain('ac-panel-foot')
    // 另外两个面板仍各有自己的底栏
    expect((SRC.match(/ac-panel-foot/g) || []).length).toBeGreaterThanOrEqual(2)
  })

  it('底部留白改由面板容器给（不再靠一条底栏撑）', () => {
    const at = CSS.indexOf('.ac-skill-panel {')
    expect(at).toBeGreaterThan(-1)
    const block = CSS.slice(at, CSS.indexOf('\n}', at))
    expect(block).toMatch(/padding-bottom:\s*[1-9]/)
  })
})

