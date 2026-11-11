/**
 * 设置面板的三类一致性（用户口径 2026-11-11）：
 *   1. 三种提示词共用同一个「正文 + 变量」组件，禁止各画一套；
 *   2. MCP 列表必须直接渲染（不能套隐形模板），自带项只读、空列表有空状态；
 *   3. 页签条自动撑高，不允许再用一条几像素的小滚动条。
 *
 * 这里只钉住结构；外观仍以 Chrome 实测为准。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf-8')

describe('三种提示词共用同一个编辑器', () => {
  const pages = ['AgentPromptPage.vue', 'PromptPage.vue', 'TemplatePage.vue']

  for (const page of pages) {
    it(page + ' 使用 PromptEditor（正文框 + 变量面板）', () => {
      const src = read('../ui/settings/' + page)
      expect(src).toContain("import PromptEditor from './components/PromptEditor.vue'")
      expect(src).toMatch(/<PromptEditor\b/)
      // 页面里不再自己拼 textarea + 变量 details
      expect(src).not.toMatch(/<textarea\b/)
      expect(src).not.toContain('pp-ph')
    })
  }

  it('变量面板只有一份实现，并且可搜索、分组一致', () => {
    const src = read('../ui/settings/components/PromptVariables.vue')
    expect(src).toContain('可用变量')
    expect(src).toContain('本站运行环境')
    expect(src).toContain('运行时提供')
    expect(src).toContain('筛选提示词变量')
    // 三种页面都用「插入」这一种交互（模板页也不例外）
    expect(src).not.toContain('复制变量')
  })

  it('模板可编辑但必须守住 {{AGENTS_MD}}（前后端两道闸）', () => {
    const page = read('../ui/settings/TemplatePage.vue')
    expect(page).toContain("agent.saveTemplate")
    expect(page).toContain('missingAgentsMd')
    expect(page).toMatch(/:disabled="busy \|\| !dirty \|\| missingAgentsMd"/)
    const server = read('../server/agent/configShared.ts')
    expect(server).toContain('模板里必须有 {{AGENTS_MD}}')
  })

  it('模板页的变量面板也能插到光标处（不再只是复制）', () => {
    const editor = read('../ui/settings/components/PromptEditor.vue')
    // PromptEditor 把变量点击统一变成 insertToken，三种页面都只 v-model 正文
    expect(editor).toContain('function insertToken')
    expect(editor).toContain('@insert="insertToken"')
    // 截图里那种「一个可插、一个只复制」的差异不能回来：变量按钮只发 insert
    const vars = read('../ui/settings/components/PromptVariables.vue')
    expect(vars).toContain("emit('insert', p.token)")
    expect(vars).not.toContain('clipboard.writeText')
  })
})

describe('MCP 页', () => {
  const src = read('../ui/settings/McpPage.vue')

  it('列表直接渲染，不套隐形 template（否则整行量成 0 高）', () => {
    expect(src).not.toMatch(/<template>\s*<ShadcnSettingsRow/)
    expect(src).toContain('v-for="m in s.mcpServers"')
  })

  it('自带项只读：没有删除按钮，并写清楚原因', () => {
    expect(src).toContain('v-if="!m.builtin"')
    expect(src).toContain('不能修改，也不能删除')
    expect(src).toContain('m.builtin')
  })

  it('空列表有专门的空状态，添加是二级页', () => {
    expect(src).toContain('ap-empty-card')
    expect(src).toContain('还没有 MCP 服务')
    expect(src).toContain('SettingsDetailHeader')
    expect(src).toContain('返回 MCP 列表')
  })
})

describe('Agent 设置页签', () => {
  it('页签条自动撑高，不再用 overflow 滚动', () => {
    const src = read('../ui/settings/AgentSettingsPage.vue')
    const rule = /\.asp-tab-list\s*\{([^}]*)\}/.exec(src)?.[1] ?? ''
    expect(rule).toContain('height: auto')
    expect(rule).toMatch(/overflow:\s*visible/)
    expect(rule).not.toMatch(/overflow-x:\s*auto/)
    const tab = /\.asp-tab\s*\{([^}]*)\}/.exec(src)?.[1] ?? ''
    expect(tab).toContain('height: auto')
  })
})
