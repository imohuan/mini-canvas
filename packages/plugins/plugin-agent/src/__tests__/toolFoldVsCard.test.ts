/**
 * 工具行分流的**唯一规则**（用户口径 2026-10-10）：
 *
 *   · 自带自定义卡片的画布 MCP 工具 → 卡片（直接展示）
 *   · 审批                              → 自己独立的审批卡（.ac-approval）
 *   · **其余一切工具**（exec_command / read_file 等默认工具）→ 折叠行
 *
 * 背景：早先给「命中审批的工具」打了 `card: true`，把 exec_command 这类默认工具
 * 从折叠行顶成了常驻展开的卡片 —— 折叠箭头没了、输入输出一直摊着（用户实测截图）。
 * 审批既然有自己的卡片 UI，就不该再动底层工具的样子。
 *
 * 这里在**源码层**钉住这条规则（组件是 .vue，纯逻辑测试覆盖不到模板）：
 * 分流只能看 hasCardView，不能再把 tool.card 算进去。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const conversation = readFileSync(path.resolve(here, '../components/AgentConversation.vue'), 'utf8')

describe('工具行分流：卡片只给自带卡片的画布 MCP 工具', () => {
  it('单工具分支不再以 tool.card 当卡片条件', () => {
    expect(conversation).not.toContain("row.tools[0].card ? 'ac-tool-card'")
    expect(conversation).not.toContain('row.tools[0].card"')
  })

  it('分组分支的分流只看 hasCardView（不再 || tool.card）', () => {
    expect(conversation).toContain(":class=\"hasCardView(tool) ? 'ac-tool-card' : 'ac-tool-fold'\"")
    expect(conversation).not.toContain('tool.card || hasCardView(tool)')
  })

  it('卡片头上不再叠一行与卡片自身重复的摘要（+1 ~ 0 -0 那行）', () => {
    // 卡片分支里不该再出现 toolSummary 的摘要行
    const cardBranch = conversation.slice(conversation.indexOf('hasCardView(row.tools[0])'))
    const head = cardBranch.slice(0, cardBranch.indexOf('</div>'))
    expect(head).not.toContain('ac-tf-summary')
  })
})
