/**
 * Agent 三个面板的滚动与空态契约（用户口径 2026-11-03）：
 * · 滚动统一交给 ScrollArea，标题 / 搜索 / 底栏固定；
 * · 分栏左右各是一条独立滚动链；
 * · 空状态在结果区居中，不贴左上角；
 * · MCP 展开区接在服务下面，不再套第二层滚动。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readSfcWithStyles } from './readSfcWithStyles'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = readSfcWithStyles(path.resolve(HERE, '../components/agent-conversation/AgentComposer.vue'))
const CSS = ['part1.css', 'part2.css', 'part3.css', 'part4.css']
  .map((f) => readFileSync(path.resolve(HERE, '../components/agent-conversation/agent-composer', f), 'utf8'))
  .join('\n')

describe('Agent 面板滚动层', () => {
  it('模型 / 技能 / MCP 都用 AgentScrollArea，并保留固定选择器', () => {
    expect(SRC).toMatch(/<AgentScrollArea[^>]*ref="modelScrollRef"[^>]*class="ac-menu-scroll/)
    expect(SRC).toMatch(/<AgentScrollArea[^>]*class="ac-rail-scroll"/)
    expect(SRC).toMatch(/<AgentScrollArea[^>]*class="ac-split-scroll"/)
    expect(SRC).toMatch(/<AgentScrollArea[^>]*class="ac-panel-scroll"[^>]*body-class="ac-panel-scroll-body ac-mcp-scroll-body"/)
  })

  it('ScrollArea 取件来自 useUiComponent，不直接 import 组件库', () => {
    const area = readFileSync(path.resolve(HERE, '../components/agent-conversation/AgentScrollArea.vue'), 'utf8')
    expect(area).toContain("useUiComponent('ScrollArea')")
    expect(area).not.toMatch(/from ['"]@mini-canvas\/ui-kit-shadcn/)
  })

  it('不再写手写滚动条规则 ::-webkit-scrollbar', () => {
    // 注释里会提到这条历史规则，只检查真正的选择器。
    expect(CSS).not.toMatch(/::-webkit-scrollbar\s*\{/)
  })

  it('MCP 工具区只由外层滚动，不叠第二层 overflow-y', () => {
    const at = CSS.indexOf('.ac-mcp-tools {')
    const block = CSS.slice(at, CSS.indexOf('\n}', at))
    expect(block).toContain('overflow: visible')
    expect(block).not.toContain('overflow-y: auto')
    expect(block).not.toContain('max-height')
  })

  it('MCP 展开工具后有可用高度，且仍只在外层 viewport 滚动', () => {
    expect(CSS).toMatch(/\.ac-mcp-panel:has\(\.ac-mcp-tools\)[\s\S]{0,120}min-height:/)
  })
})

describe('Agent 面板空态', () => {
  it('三处空态都在面板内用 flex 居中，且不依赖消息流 scoped 样式', () => {
    expect(SRC.match(/class="ac-empty-state"/g)?.length ?? 0).toBeGreaterThanOrEqual(4)
    const at = CSS.indexOf('.ac-panel .ac-empty-state {')
    expect(at).toBeGreaterThan(-1)
    const block = CSS.slice(at, CSS.indexOf('\n}', at))
    expect(block).toContain('display: flex')
    expect(block).toContain('justify-content: center')
    expect(block).toContain('align-items: center')
  })

  it('结果区空态拿满剩余高度', () => {
    expect(CSS).toMatch(/\.ac-panel-scroll-body > \.ac-empty-state,[\s\S]{0,200}flex: 1/)
    expect(CSS).toMatch(/\.ac-split-scroll \.ac-split-scroll-body \{[\s\S]{0,160}min-height: 100%/)
  })
})

describe('Agent 面板紧凑尺寸', () => {
  it('底排六个触发器与创作模式胶囊都挂 ac-toolbar-btn', () => {
    expect(SRC.match(/ac-toolbar-btn/g)?.length ?? 0).toBeGreaterThanOrEqual(6)
    expect(SRC).toMatch(/class="ac-pill ac-toolbar-btn"/)
  })

  it('没选主题尺寸档时也保持 32px（与顶部按钮同档，用户口径 2026-11-03）', () => {
    const at = CSS.indexOf("[data-slot].ac-toolbar-btn:not([data-slot='button'])")
    expect(at).toBeGreaterThan(-1)
    expect(CSS.slice(at, CSS.indexOf('\n}', at))).toContain('height: 32px !important')
  })

  it('MCP 行内勾选与文字按钮不依赖主题尺寸档', () => {
    for (const selector of [
      "[data-slot='button'].ac-detect-btn",
      "[data-slot='button'].ac-pick-box",
      ".ac-pick-box.is-sm {",
      "[data-slot='button'].ac-confirm-btn",
    ]) {
      expect(CSS).toContain(selector)
    }
    // 工具行可见框 14px、点击区 22px：基础 .is-sm 规则负责可见框。
    const at = CSS.indexOf('.ac-pick-box.is-sm {')
    const block = CSS.slice(at, CSS.indexOf('\n}', at))
    expect(block).toContain('height: 22px')
    expect(block).toContain('padding: 4px')
  })

  it('触发器不再用 pointerdown 开合，避免与 Reka click 双翻转', () => {
    expect(SRC).not.toContain('@pointerdown="switchComposerMenu')
  })
})
