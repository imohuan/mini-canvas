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
const conversation = readFileSync(path.resolve(here, '../ui/conversation/AgentMessageList.vue'), 'utf8')
describe('工具行分流：卡片只给自带卡片的画布 MCP 工具', () => {
  it('单工具分支不再以 tool.card 当卡片条件', () => {
    expect(conversation).not.toContain("row.tools[0].card ? 'ac-tool-card'")
    expect(conversation).not.toContain('row.tools[0].card"')
  })

  it('分组分支的分流只看 hasCardView（不再 || tool.card）', () => {
    // 2026-11-05 换 AI Elements Trace 结构后：卡片 = v-if hasCardView(tool)，折叠行 = v-else TraceCollapsible。
    // 分流只认 hasCardView 不变的契约不变，只是从三元 class 换成 v-if / v-else 分支。
    expect(conversation).toContain('v-if="hasCardView(tool)"')
    expect(conversation).not.toContain('tool.card || hasCardView(tool)')
  })

  it('单工具行：动作 + 内容合成一句放进 TraceTitle（不再用 TraceDescription 装长文本）', () => {
    expect(conversation).toContain('toolLineTitle(row.tools[0])')
    // Description 自带 shrink-0，装长命令会把标题挤成「执…」并横向溢出（用户截图）
    expect(conversation).not.toContain('<TraceDescription v-if="toolRowSummary(row.tools[0])')
  })

  it('卡片头上不再叠一行与卡片自身重复的摘要（+1 ~ 0 -0 那行）', () => {
    // 卡片分支里不该再出现 toolSummary 的摘要行
    const cardBranch = conversation.slice(conversation.indexOf('hasCardView(row.tools[0])'))
    const head = cardBranch.slice(0, cardBranch.indexOf('</div>'))
    expect(head).not.toContain('ac-tf-summary')
  })

  it('分组分支的授权条在折叠内容之外（用户口径 2026-11-17 方案 B）', () => {
    // 背景：授权条以前挂在 `v-for="tool in row.tools"` 每一项下面，而这一整段住在
    // `<TraceCollapsibleContent>` 里 —— 分组一收起，等待确认的调用就完全看不见。
    // 现在要求：分组内不再出现授权条，授权条排在分组折叠容器**之后**（与它同级）。
    const groupStart = conversation.indexOf('v-else-if="row.type === \'tools\'"')
    expect(groupStart).toBeGreaterThanOrEqual(0)
    const group = conversation.slice(groupStart)
    const approvalAt = group.indexOf('AgentConfirmation')
    // 排在最后一个折叠内容收尾之后 = 不在任何折叠层里
    const lastCollapseClose = group.lastIndexOf('</TraceCollapsibleContent>')
    expect(lastCollapseClose).toBeGreaterThanOrEqual(0)
    expect(approvalAt).toBeGreaterThan(lastCollapseClose)
    // 只渲染一次（不能既在组内留一份、又在外面来一份）
    expect(group.split('AgentConfirmation').length - 1).toBe(1)
  })
})
