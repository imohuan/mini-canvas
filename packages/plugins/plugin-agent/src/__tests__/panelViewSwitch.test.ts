/**
 * 卡片 / 分栏切换与面板细节（用户口径 2026-11-06）。
 *
 * 用户报的四件事逐条钉住：
 *   1. 切换要顺滑：两套视图常驻 DOM，只切显示，不再 v-if 拆装；
 *   2. 页签值必须跟视图一致：不能出现「界面在分栏、页签还亮着卡片」；
 *   3. 分栏右侧不能叠两条滚动条，选中项上方要有留白；
 *   4. 审核模式的「推荐 / 谨慎」跟在标题右侧，描述单独换行。
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
const MENUS = readFileSync(path.resolve(HERE, '../ui/conversation/useAgentMenus.ts'), 'utf8')

/** 取一条样式规则的正文 */
function ruleBody(source: string, selector: string): string {
  const at = source.indexOf(selector + ' {')
  expect(at, '找不到样式规则：' + selector).toBeGreaterThan(-1)
  return source.slice(at, source.indexOf('}', at))
}

describe('卡片 / 分栏切换', () => {
  it('两套视图常驻 DOM，靠 is-active 切显示', () => {
    const panes = SRC.match(/ac-view-pane/g) ?? []
    expect(panes.length).toBeGreaterThanOrEqual(4)
    expect(SRC).toMatch(/:class="\{ 'is-active': modelView === 'card' \}"/)
    expect(SRC).toMatch(/:class="\{ 'is-active': modelView === 'split' \}"/)
    expect(SRC).toMatch(/:class="\{ 'is-active': skillView === 'card' \}"/)
    expect(SRC).toMatch(/:class="\{ 'is-active': skillView === 'split' \}"/)
  })

  /** 隐藏的视图按内容高度参与布局时，外层滚动区会被一起撑高（真机表现就是右边叠两条滚动条） */
  it('每个视图都裁在自己的格子里，不让内容决定行高', () => {
    const body = ruleBody(CSS, '.ac-view-pane')
    expect(body).toMatch(/min-height:\s*0/)
    expect(body).toMatch(/max-height:\s*100%/)
    expect(body).toMatch(/overflow:\s*hidden/)
  })

  /** 页签只认两档；收到其它值不能回落成 card（那正是「页签与界面不一致」的来源） */
  it('切换函数只认 card / split，其它值保持原样', () => {
    const start = MENUS.indexOf('function setModelView')
    expect(start).toBeGreaterThan(-1)
    const block = MENUS.slice(start, MENUS.indexOf('\n}', start))
    expect(block).toContain("value === 'split'")
    expect(block).toContain("value === 'card'")
    expect(block).not.toContain("value === 'split' ? 'split' : 'card'")
  })
})

describe('分栏布局', () => {
  it('右侧结果区首行有上留白（选中底色不贴面板上沿）', () => {
    const at = CSS.indexOf('.ac-split-scroll .ac-model-row-list')
    expect(at).toBeGreaterThan(-1)
    const block = CSS.slice(at, CSS.indexOf('\n}', at))
    expect(block).toMatch(/padding-top:\s*[1-9]/)
  })

  /** 双滚动条的根因是隐藏视图把外层撑高，不是原生滚动条 —— 改法必须留在 .ac-view-pane 上 */
  it('双滚动条靠「视图不撑高外层」解决，不靠藏滚动条', () => {
    const body = ruleBody(CSS, '.ac-view-pane')
    expect(body).toMatch(/overflow:\s*hidden/)
    expect(CSS).not.toMatch(/::-webkit-scrollbar\s*\{/)
  })
})

describe('审核模式选项', () => {
  it('标题与徽章同一行（徽章紧跟标题右侧，不换行）', () => {
    // 用行首锚定：part3 里还有一条 `.ac-review-item .ac-option-title` 的覆盖规则
    const body = ruleBody(CSS, '\n.ac-option-title')
    expect(body).toMatch(/flex-wrap:\s*nowrap/)
  })

  it('描述单独一行且允许换行', () => {
    const body = ruleBody(CSS, '.ac-option-desc')
    expect(body).toMatch(/display:\s*block/)
    expect(body).toMatch(/white-space:\s*normal/)
  })

  it('选项是上下两行，不是组件库默认的横向排布', () => {
    const body = ruleBody(CSS, '.ac-review-item')
    expect(body).toMatch(/flex-direction:\s*column/)
  })
})

describe('MCP 工具块', () => {
  it('每个工具左侧是单选框，可多选', () => {
    expect(SRC).toContain('class="ac-tool-radio"')
    expect(SRC).toContain('role="checkbox"')
    expect(SRC).toContain('toggleMcpTool(item.name, t.name)')
  })

  it('整块有外框，左侧带一条竖线', () => {
    const tools = ruleBody(CSS, '.ac-mcp-tools')
    expect(tools).toMatch(/border:\s*1px solid/)
    const list = ruleBody(CSS, '.ac-tool-list')
    expect(list).toMatch(/border-left:\s*1px solid/)
  })

  it('不再单独画「工具」标题（标题放进块内，写服务名）', () => {
    expect(SRC).toContain('class="ac-tools-title"')
    expect(SRC).not.toContain('<span>工具</span>')
  })
})

