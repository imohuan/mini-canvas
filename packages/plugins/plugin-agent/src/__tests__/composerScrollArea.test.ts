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
const SRC = readSfcWithStyles(path.resolve(HERE, '../ui/conversation/AgentComposer.vue'))
const CSS = ['part1.css', 'part2.css', 'part3.css', 'part4.css']
  .map((f) => readFileSync(path.resolve(HERE, '../ui/conversation/agent-composer', f), 'utf8'))
  .join('\n')

describe('Agent 面板滚动层', () => {
  it('模型 / 技能 / MCP 都用 AgentScrollArea，并保留固定选择器', () => {
    expect(SRC).toMatch(/<AgentScrollArea[^>]*ref="modelScrollRef"[^>]*class="ac-menu-scroll/)
    expect(SRC).toMatch(/<AgentScrollArea[^>]*class="ac-rail-scroll"/)
    expect(SRC).toMatch(/<AgentScrollArea[^>]*class="ac-split-scroll"/)
    expect(SRC).toMatch(/<AgentScrollArea[^>]*class="ac-panel-scroll"[^>]*body-class="ac-panel-scroll-body ac-mcp-scroll-body"/)
  })

  it('ScrollArea 取件来自 useUiComponent，不直接 import 组件库', () => {
    const area = readFileSync(path.resolve(HERE, '../ui/conversation/AgentScrollArea.vue'), 'utf8')
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
    // 2026-11-06 改成「整块带边框 + 左侧竖线」后不再用 visible，
    // 判断标准仍是一条：这里不能自己滚（不能出现 auto/scroll 的第二层）。
    expect(block).not.toContain('overflow-y: auto')
    expect(block).not.toContain('overflow-y: scroll')
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
  /**
   * 用户口径 2026-11-05：「我使用默认的组件样式就行，不需要你的 css 样式，请删除他们的 class」。
   * 底排触发器、胶囊、检测键、勾选框、确认键全部用组件库自己的尺寸与外观，
   * 这里反向钉住「不再给它们套自定义 class」。
   */
  it('底排的 shadcn 按钮不再挂自定义 class', () => {
    for (const cls of ['ac-toolbar-btn', 'ac-plus', 'ac-confirm-btn', 'ac-detect-btn']) {
      expect(SRC, '仍在使用自定义 class：' + cls).not.toContain(cls)
    }
  })

  it('触发器不再用 pointerdown 开合，避免与 Reka click 双翻转', () => {
    expect(SRC).not.toContain('@pointerdown="switchComposerMenu')
  })
})
