/**
 * UI 结构守卫（用户口径 2026-10-11）。四条都是"用户看得见的缺失"的回归锁：
 *
 * 1. 上下文统计行在**面板最下面**（不是在工具栏里）；
 * 2. 错误条是**常驻**的（不再只挂在最后一条助手消息上）；
 * 3. @ 菜单里有「压缩」动作项，且它走 agent.compact（不是往正文插标签）；
 * 4. 模型分割线的标记存在（换模型时能看见"从这里换了模型"）。
 *
 * 用文本断言而不是挂载 Vue：这一层最容易"改一处漏一处"（比如把某个类名删了、
 * 把某段模板移走了），结构断言能在一次 grep 成本内把它钉住。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { readSfcWithStyles } from './readSfcWithStyles'
import { readAgentConversationSource } from './readAgentConversationSource'

const host = readFileSync(path.join(__dirname, '../components/agent-conversation/AgentMessageList.vue'), 'utf8')
const controller = readAgentConversationSource()
const composer = readSfcWithStyles(path.join(__dirname, '../components/agent-conversation/AgentComposer.vue'))

describe('上下文统计行', () => {
  it('恢复到发送键左侧：在 .ac-toolbar 里、发送按钮之前（用户口径 2026-10-11 的截图反馈）', () => {
    const toolbar = composer.indexOf('class="ac-toolbar"')
    const wrap = composer.indexOf('class="ac-ctxwrap"')
    const send = composer.indexOf('class="ac-send"', toolbar)
    expect(wrap).toBeGreaterThan(toolbar)
    expect(wrap).toBeLessThan(send)
  })

  it('hover tooltip 保留（恢复之前的模式：环 + 悬停提示）', () => {
    // 截取到 .ac-send 的**首次**出现（它就在统计块之后）：环与 tooltip 都应在其前
    const toolbar = composer.slice(composer.indexOf('class="ac-toolbar"'), composer.indexOf('class="ac-send"'))
    // 组件已从主题目录取件改为直接用组件库的 Tooltip（全项目统一 shadcn），
    // 但「环 + 悬停提示」这个用户可见行为必须仍在。
    expect(toolbar).toContain('TooltipProvider')
    expect(toolbar).toContain('TooltipContent')
    expect(toolbar).toContain('上下文剩余 ')
  })

  it('只画环、不配文字（用户口径 2026-10-11：有环再写「已…」是重复信息，工具条也放不下）', () => {
    expect(composer).not.toContain('ac-ctx-text')
    expect(composer).not.toContain('contextStatText')
  })
})

describe('错误可见性（用户报的问题 2）', () => {
  it('有一条常驻错误条，读 s.lastError，且在消息流容器里', () => {
    const bar = host.indexOf('class="ac-error-bar"')
    expect(bar).toBeGreaterThan(0)
    expect(host.slice(bar, bar + 400)).toContain('s.lastError')
    // 放在消息流内（.ac-scroll-wrap 之后、输入区之前）—— 用户滚动对话时看得见
    expect(host.indexOf('class="ac-scroll-wrap"')).toBeGreaterThan(-1)
  })

  it('错误已经挂在消息上时不重复画（hasInlineError 去重）', () => {
    expect(host).toContain('hasInlineError')
    expect(host).toMatch(/v-if="s\.lastError && !hasInlineError"/)
  })
})

describe('压缩入口', () => {
  it('@ 菜单里命令组排在**最前**（用户口径 2026-10-11：命令不该在列表最底下）', () => {
    const res = controller.indexOf('const editorResources = computed')
    const compact = controller.indexOf('compactActionItems()', res)
    const nodes = controller.indexOf('...nodeResources(', res)
    expect(compact).toBeGreaterThan(res)
    expect(compact).toBeLessThan(nodes)
  })

  it('@ 菜单里有「压缩上下文」动作项，且走 onPick（不插标签）', () => {
    expect(controller).toContain('compactActionItems')
    expect(controller).toContain("id: 'command:compact'")
    expect(controller).toContain('onPick:')
    expect(controller).toContain('agent.compact()')
  })

  it('「+」菜单里也有入口，两个入口走同一条命令', () => {
    expect(controller).toContain('function compactNow')
    expect(controller).toContain('compactNow()')
  })
})

describe('模型分割线（用户口径 2026-10-11：切模型 = 换会话）', () => {
  it('消息流里有分割线标记，挂在该段第一条用户消息之前', () => {
    expect(host).toContain('class="ac-model-split"')
    expect(host).toContain('segmentByAnchor.get(t.id)')
    expect(controller).toContain('segmentAnchors(s.turns, s.segments)')
  })

  it('切模型调的是异步 switchModel（后端开新会话），不是改本地字段', () => {
    expect(controller).toMatch(/void agent\.setModel\(/)
  })
})

