/**
 * Agent 对话面板的「极端长文字」复查（2026-10-22，与工具卡片同一轮）。
 *
 * 用户口径：比较特别的窄 UI、文字很多时也要显示得下，不能顶出卡片 / 输入框。
 * 这里锁住四处容易漏的单行文本：
 *   ① 审批确认条的标题（可能是整条命令，MCP 工具名也可能很长）；
 *   ② 输入区「创作模式」胶囊（提示词名是用户自建的，没有长度上限）；
 *   ③ 模型分割标签（模型 id 可能很长）；
 *   ④ 思考块（可能贴一整段无空格长串，不能横向撑破气泡）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readSfcWithStyles } from './readSfcWithStyles'

const HERE = path.dirname(fileURLToPath(import.meta.url))

const host = readSfcWithStyles(path.resolve(HERE, '../ui/conversation/AgentMessageList.vue'))
const confirmation = readSfcWithStyles(path.resolve(HERE, '../ui/conversation/AgentConfirmation.vue'))
const composer = readSfcWithStyles(path.resolve(HERE, '../ui/conversation/AgentComposer.vue'))

function rule(selector: string): string {
  // 调用方可传「.ac-pill」或「.ac-pill {」：统一成一个选择器再找规则块。
  const normalized = selector.replace(/\s*\{\s*$/, '')
  const at = host.indexOf(normalized + ' {')
  expect(at, '找不到样式块：' + selector).toBeGreaterThanOrEqual(0)
  const end = host.indexOf('}', at)
  return host.slice(at, end + 1)
}

/** 同一套「找规则块」用于审批确认条（它拆成了独立组件） */
function ruleOf(source: string, selector: string): string {
  const normalized = selector.replace(/\s*\{\s*$/, '')
  const at = source.indexOf(normalized + ' {')
  expect(at, '找不到样式块：' + selector).toBeGreaterThanOrEqual(0)
  const end = source.indexOf('}', at)
  return source.slice(at, end + 1)
}

function rule2(selector: string): string {
  const normalized = selector.replace(/\s*\{\s*$/, '')
  const at = composer.indexOf(normalized + ' {')
  expect(at, '找不到样式块：' + selector).toBeGreaterThanOrEqual(0)
  const end = composer.indexOf('}', at)
  return composer.slice(at, end + 1)
}

/** 模型分割线属于消息流（AgentMessageList），样式也在那边 */
function rule3(selector: string): string {
  const normalized = selector.replace(/\s*\{\s*$/, '')
  const at = host.indexOf(normalized + ' {')
  expect(at, '找不到样式块：' + selector).toBeGreaterThanOrEqual(0)
  const end = host.indexOf('}', at)
  return host.slice(at, end + 1)
}

describe('Agent 面板：极端长文字不撑破容器', () => {
  it('审批确认条：标题与说明可缩、能换行，不把条撑宽', () => {
    expect(confirmation).toContain('class="ac-approval-title"')
    expect(confirmation).toContain('class="ac-approval-desc"')
    // 标题与说明共用同一条收敛规则（选择器列表写在同一块里）
    const box = ruleOf(confirmation, '.ac-approval-desc')
    expect(box).toContain('min-width: 0')
    expect(box).toContain('word-break: break-word')
  })

  it('创作模式胶囊：长提示词名可缩、单行省略，不把工具条按钮挤走', () => {
    expect(composer).toContain('class="ac-pill-text"')
    // 胶囊（高度 / 圆角 / padding）全部用组件库 Button 默认样式（用户口径 2026-11-05），
    // 这里只要求文字本身可缩、单行省略。
    const text = rule2('.ac-pill-text')
    expect(text).toContain('min-width: 0')
    expect(text).toContain('overflow: hidden')
    expect(text).toContain('text-overflow: ellipsis')
    expect(text).toContain('white-space: nowrap')
  })

  it('模型分割标签：长模型 id 可缩，不越出面板', () => {
    const badge = rule3('.ac-model-split-badge')
    expect(badge).toContain('min-width: 0')
    expect(badge).toContain('max-width: 100%')
    expect(rule3('.ac-model-split-name')).toContain('min-width: 0')
  })

  it('思考块：无空格长串也能换行，不横向撑破气泡', () => {
    // 思考行照官方 Reasoning Demo：展开区就是 TraceCollapsibleContent +
    // whitespace-pre-wrap（Demo 原样），换行由组件自带的 wrap-break-word 负责。
    expect(host).toContain('class="whitespace-pre-wrap"')
  })
})
