/**
 * 用户 2026-11-06 连提三次的三个面板细节。
 *
 * 1. MCP 面板标题被误删（我把「删掉工具区里的服务名小标题」做成了删面板标题）；
 * 2. 卡片 / 分栏页签值不同步：点「卡片」有时没反应、再点一次才好；
 * 3. 卡片右侧圆角被裁：卡片按内容宽撑到 327px，超出 288px 的滚动容器右边界。
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

function ruleBody(source: string, selector: string): string {
  const at = source.indexOf(selector + ' {')
  expect(at, '找不到样式规则：' + selector).toBeGreaterThan(-1)
  return source.slice(at, source.indexOf('}', at))
}

/** 取某个面板容器内部的片段（避免跨面板误判） */
function panel(name: string, size = 7000): string {
  const at = SRC.indexOf(name)
  expect(at, '找不到面板 ' + name).toBeGreaterThan(-1)
  return SRC.slice(at, at + size)
}

describe('MCP 面板标题', () => {
  it('标题与计数都在（用户截图：整块标题不见了）', () => {
    const mcp = panel('ac-mcp-panel')
    expect(mcp).toContain('ac-panel-title')
    expect(mcp).toContain('>MCP<')
    expect(mcp).toContain("{{ s.mcpServers.length }}")
  })

  it('工具区里仍然不重复显示服务名', () => {
    const tools = SRC.slice(SRC.indexOf('class="ac-mcp-tools"'), SRC.indexOf('class="ac-tool-list"'))
    expect(tools).not.toContain('{{ item.name }}')
  })
})

describe('卡片 / 分栏页签', () => {
  /**
   * reka 的 Tabs 内部用 useVModel 另存一份选中值，外层再经 useForwardPropsEmits 转发；
   * 两份状态偶发错位时，页签会停在上一次的值（点卡片没反应、再点一次才好）。
   * 现在选中态只看我们的 modelView / skillView，点击只走自己的 handler。
   */
  it('页签的选中态由我们的状态决定（data-state / aria-selected 都绑状态）', () => {
    expect(SRC).toContain(':data-state="modelView === \'card\' ? \'active\' : \'inactive\'"')
    expect(SRC).toContain(':data-state="modelView === \'split\' ? \'active\' : \'inactive\'"')
    expect(SRC).toContain(':data-state="skillView === \'card\' ? \'active\' : \'inactive\'"')
    expect(SRC).toContain(':data-state="skillView === \'split\' ? \'active\' : \'inactive\'"')
  })

  it('点击直接改我们的状态（不再依赖库组件回传 update）', () => {
    expect(SRC).toContain('@click="setModelView(\'card\')"')
    expect(SRC).toContain('@click="setModelView(\'split\')"')
    expect(SRC).toContain('@click="setSkillView(\'card\')"')
    expect(SRC).toContain('@click="setSkillView(\'split\')"')
  })

  it('切视图不会重建面板（两套视图常驻，页签也不带 key 强制重挂）', () => {
    expect(SRC).not.toContain(":key=\"'model-tabs-'")
    expect(SRC).not.toMatch(/<Tabs[^>]*:key=/)
  })
})

describe('卡片右侧圆角', () => {
  it('卡片允许被压窄（min-width: 0），否则长模型名会把卡片撑出容器', () => {
    // 这条规则是多行选择器（.ac-model-row-list button,\n.ac-model-grid button {）
    const at = CSS.indexOf('.ac-model-row-list button,')
    expect(at).toBeGreaterThan(-1)
    const body = CSS.slice(at, CSS.indexOf('\n}', at))
    expect(body).toMatch(/min-width:\s*0/)
  })

  /**
   * 右侧留白只保留**一层**（用户 2026-11-06：每一层都带右边距，右边空出太多）。
   * 最终只有内容层给 padding-right；外壳（.ac-scrollarea / ScrollArea 根节点）
   * 不允许再留，否则又会叠出 20px 以上的空白。
   */
  it('右侧留白只在内容层写一次', () => {
    const body = CSS.slice(CSS.indexOf('.ac-menu-scroll :deep(.ac-model-scroll-body)'))
    const block = body.slice(0, body.indexOf('\n}'))
    expect(block).toMatch(/padding:[^;]*12px/)

    const area = readFileSync(path.resolve(HERE, '../ui/conversation/AgentScrollArea.vue'), 'utf8')
    const scrollRule = area.slice(area.indexOf('.ac-scrollarea {'), area.indexOf('.ac-scrollarea {') + 400)
    expect(scrollRule).toMatch(/padding-right:\s*0/)
    expect(area).not.toMatch(/padding-right:\s*4px!important/)
    expect(area).not.toMatch(/\n  padding-right:\s*12px;/)
  })

  it('网格列宽被压住（不按内容固有宽度撑开轨道）', () => {
    const at = CSS.indexOf('.ac-model-grid {')
    const block = CSS.slice(at, CSS.indexOf('\n}', at))
    expect(block).toMatch(/grid-template-columns:[^;]*minmax\(0/)
  })
})

