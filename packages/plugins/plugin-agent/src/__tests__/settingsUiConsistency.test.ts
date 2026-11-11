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

describe('审批规则：能编辑、能恢复默认（用户 2026-11-11）', () => {
  const src = read('../ui/settings/RulesPage.vue')

  it('每条规则有编辑入口，进入的是二级页而不是塞在列表里', () => {
    expect(src).toContain('openEdit(r)')
    expect(src).toContain('返回规则列表')
    expect(src).toContain('保存')
  })

  it('列表能整份恢复，走的是一键接口', () => {
    expect(src).toContain('agent.restorePolicy()')
    expect(src).toContain('恢复全部审批规则')
  })

  it('内置单条也能恢复，自建规则不给假按钮', () => {
    expect(src).toContain('restoreOne')
    expect(src).toContain('defaultOf')
    expect(src).toContain('v-if="defaultOf(editing)"')
  })
})

describe('提示词编辑里能恢复默认', () => {
  it('模式提示词：只有内置项出现恢复，并且先改本地草稿', () => {
    const src = read('../ui/settings/PromptPage.vue')
    expect(src).toContain('defaultText')
    expect(src).toContain('defaultName')
    expect(src).toContain('v-if="active.builtin"')
    expect(src).toContain('恢复默认')
  })

  it('Agent 提示词：有恢复默认，且说明要再点保存', () => {
    const src = read('../ui/settings/AgentPromptPage.vue')
    expect(src).toContain('restoreDefault')
    expect(src).toContain('恢复默认')
    expect(src).toContain('点保存后才写回')
  })

  it('系统提示词：编辑页底部常驻恢复默认，模板坏了也能回', () => {
    const src = read('../ui/settings/TemplatePage.vue')
    expect(src).toContain('agent.restoreTemplate()')
    expect(src).toContain('恢复默认')
    // 不能只在体检失败的分支里出现
    expect(src).not.toContain('恢复出厂模板')
  })
})

describe('模型 / MCP 的检测与自定义模型（用户 2026-11-11 续）', () => {
  const models = read('../ui/settings/ModelsPage.vue')
  const mcp = read('../ui/settings/McpPage.vue')

  it('模型页有真实请求检测、自定义模型和“测选中模型”', () => {
    expect(models).toContain('agent.probeModel')
    expect(models).toContain('自定义模型 ID')
    expect(models).toContain('测试选中')
    expect(models).toContain('testSelectedModels')
  })

  it('两个多选是分开的：编辑时多选保留哪些，保存后多选测哪些', () => {
    expect(models).toContain('modelEditing')
    expect(models).toContain('完成编辑')
    expect(models).toContain('编辑模型')
    expect(models).toContain('testSelected')
    // 两套选中态各自一个字段，不能再用「当前模型」叠第三层描边
    expect(models).not.toContain('is-active-model')
  })

  it('协议写清楚通用 / 专属，不确定时默认自动检测', () => {
    expect(models).toContain("'auto'")
    expect(models).toContain('自动检测（推荐）')
    expect(models).toContain('OpenAI Chat（通用）')
    expect(models).toContain('Anthropic Messages（通用）')
  })

  it('MCP 添加页有“检测配置”，并且不会保存', () => {
    expect(mcp).toContain('agent.probeMcpDraft')
    expect(mcp).toContain('检测配置')
    expect(mcp).toContain('不会保存')
  })

  it('MCP 检测结果挂在对应服务行下面，可折叠，不再堆在页面最底部', () => {
    expect(mcp).toContain('serverResult(m.name)')
    expect(mcp).toContain('toggleExpanded(m.name)')
    expect(mcp).toContain('ap-server-detail')
    expect(mcp).not.toContain('toolsByServer')
  })

  it('测试信息卡片：默认灰、成功绿、失败红；描述在第二行', () => {
    const models = read('../ui/settings/ModelsPage.vue')
    expect(models).toContain('#16a34a')
    expect(models).toContain('#dc2626')
    expect(models).toContain('ap-probe-desc')
    // 结果卡片不再用主题强调色当边框：边框读私有状态色变量（亮色块里就是 #16a34a）
    const resultRule = /\.ap-probe-result\.is-ok\s*\{([^}]*)\}/.exec(models)?.[1] ?? ''
    expect(resultRule).toContain('--ap-state-ok')
    expect(resultRule).not.toContain('--ui-accent')
  })

  it('多模型测试是并发的，并且按钮显示 完成数/总数', () => {
    expect(models).toContain('probeModelsConcurrently')
    expect(models).toContain('probeProgress')
    expect(models).not.toMatch(/for\s*\(const modelId of ids\)\s*\{\s*await/)
  })
})
