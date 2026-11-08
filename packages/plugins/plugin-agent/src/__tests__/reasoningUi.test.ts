/**
 * 思考行 = 照 ai-elements/reasoning 官方 Demo 原样搭（用户口径 2026-11-07）。
 *
 * 用户明确要求：不要在这套 UI 上叠自己的东西，直接按 Demo 的写法来。
 * Demo 的结构（ReasoningDemo.vue）：
 *   Trace > TraceCollapsible(open = 用户选择 ?? running) >
 *     Trigger > TraceLine(status=running) > TraceTitle >
 *     TraceCollapsibleContent(whitespace-pre-wrap)
 * 没有图标、没有自己算耗时、没有自动收起定时器。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const list = readFileSync(path.resolve(HERE, '../ui/conversation/AgentMessageList.vue'), 'utf8')

describe('思考行：照官方 Demo 的 Trace 结构', () => {
  it('用 Trace > TraceCollapsible > Trigger > TraceLine > TraceTitle', () => {
    expect(list).toContain('<TraceCollapsible')
    expect(list).toContain('<TraceCollapsibleTrigger>')
    expect(list).toContain('<TraceLine :status="thinkingLive(t)')
    expect(list).toContain('<TraceTitle>')
  })

  it('开合 = 用户选择 ?? 是否还在跑（Demo 的 openState 语义）', () => {
    expect(list).toContain("openThinking[t.id + ':' + row.key] ?? thinkingLive(t)")
    expect(list).toContain("@update:open=")
  })

  it('展开区只加 Demo 里的 whitespace-pre-wrap（不叠自己的高度/滚动样式）', () => {
    expect(list).toContain('class="whitespace-pre-wrap"')
    expect(list).not.toContain('max-h-[min(360px,50vh)]')
  })

  it('思考行不再挂图标（Demo 只写文字）', () => {
    const at = list.indexOf('row.type === \'thinking\'')
    const branch = list.slice(at, at + 1400)
    expect(branch).not.toContain('LoaderCircle')
    expect(branch).not.toContain('CircleCheck')
  })

  it('文案只说「正在思考 / 思考完成」（不自算耗时）', () => {
    expect(list).toContain("'正在思考' : '思考完成'")
    expect(list).not.toContain('思考了 ')
  })
})
