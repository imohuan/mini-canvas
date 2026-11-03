/**
 * 技能面板卡片布局契约（用户口径 2026-11-02：「技能卡片被改成一条细线」）。
 *
 * 踩过的坑：卡片外壳用 shadcn Button size="sm" 时，组件库的尺寸规则会强制
 * 32px 高 + 左右内边距，把 54px 封面压成 0 宽、整卡压成一条细线。
 * 卡片必须是普通 div 外壳，并自己给回最小高度与内边距。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const HERE = path.dirname(fileURLToPath(import.meta.url))
import { readSfcWithStyles } from './readSfcWithStyles'
const SRC = readSfcWithStyles(path.resolve(HERE, '../components/agent-conversation/AgentComposer.vue'))
describe('技能面板卡片', () => {
  it('卡片外壳不是 shadcn Button（避免被按钮尺寸规则压扁）', () => {
    expect(SRC).not.toMatch(/<Button[^>]*class="ac-skill-card"/)
    expect(SRC).not.toMatch(/<Button[^>]*class="ac-skill-tile"/)
    expect(SRC).toMatch(/<div[^>]*class="ac-skill-card"/)
    expect(SRC).toMatch(/<div[^>]*class="ac-skill-tile"/)
  })

  it('卡片自己声明最小高度与内边距，封面保持 54×54', () => {
    expect(SRC).toMatch(/\.ac-skill-card \{[^}]*min-height: 72px/)
    expect(SRC).toMatch(/\.ac-skill-card \{[^}]*padding: 8px/)
    expect(SRC).toMatch(/\.ac-skill-thumb \{[^}]*width: 54px[^}]*height: 54px/)
  })

  it('卡片可键盘操作（Enter / Space 与点击同一动作）', () => {
    expect(SRC).toMatch(/ac-skill-card[\s\S]{0,400}@keydown\.enter\.prevent/)
    expect(SRC).toMatch(/ac-skill-card[\s\S]{0,600}@keydown\.space\.prevent/)
  })
})
