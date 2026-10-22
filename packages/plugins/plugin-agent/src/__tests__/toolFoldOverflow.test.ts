/**
 * 工具折叠行的长名字防护（与卡片同一轮极端长文本复查，2026-10-22）。
 *
 * 默认工具（exec_command / MCP 工具）收起时，工具名放在 <code> 里。
 * 早先它是 `flex: none` —— 工具名没有长度上限，长名字会把整行撑出气泡，
 * 旁边的摘要与折叠箭头反而被挤走。这里钉住：名字可缩、单行省略、最多占 60%。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const host = readFileSync(path.resolve(HERE, '../components/AgentConversation.vue'), 'utf8')

function rule(selector: string): string {
  const at = host.indexOf(selector + ' {')
  expect(at, '找不到样式块：' + selector).toBeGreaterThanOrEqual(0)
  const end = host.indexOf('}', at)
  return host.slice(at, end + 1)
}

describe('工具折叠行：极端长工具名不撑出气泡', () => {
  it('工具名限宽单行省略（flex 可缩 + max-width + 三件套）', () => {
    const name = rule('.ac-tf-toggle code')
    expect(name).toContain('flex: 0 1 auto')
    expect(name).toContain('min-width: 0')
    expect(name).toContain('max-width')
    expect(name).toContain('overflow: hidden')
    expect(name).toContain('text-overflow: ellipsis')
    expect(name).toContain('white-space: nowrap')
  })

  it('名字让位给摘要：摘要仍可缩、仍带省略号', () => {
    const summary = rule('.ac-tf-summary')
    expect(summary).toContain('min-width: 0')
    expect(summary).toContain('overflow: hidden')
    expect(summary).toContain('text-overflow: ellipsis')
    expect(summary).toContain('white-space: nowrap')
  })
})
