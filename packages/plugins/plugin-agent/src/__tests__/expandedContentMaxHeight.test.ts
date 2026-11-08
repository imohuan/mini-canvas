/**
 * Agent 对话里「展开后的内容」必须有高度上限（用户口径 2026-10-25）。
 *
 * 现象：思考过程、工具输入 / 输出、卡片详情展开后按内容无限长高，
 * 一条长日志就能把整段对话撑出面板；用户只能一路向下滚。
 *
 * 契约：所有可展开的内容块都带一个有限 max-height，超出部分在块内滚动。
 * 早先只有内部 <pre> 各自限高；外层容器仍是自然高度，两层 pre 叠起来照样很长。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readSfcWithStyles } from './readSfcWithStyles'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const conversation = readSfcWithStyles(path.resolve(HERE, '../ui/conversation/AgentMessageList.vue'))
const toolBody = readFileSync(path.resolve(HERE, '../ui/render/ToolViewBody.vue'), 'utf8')

/** 取第一个以 selector 开头的样式块（本包样式都在同一个 <style scoped> 里） */
function rule(source: string, selector: string): string {
  const at = source.indexOf(selector + ' {')
  expect(at, '找不到样式块：' + selector).toBeGreaterThanOrEqual(0)
  const end = source.indexOf('}', at)
  return source.slice(at, end + 1)
}

/** 有限高度：排除 none / unset 这类“等于没限”的写法 */
function expectBounded(selector: string, source: string): void {
  const block = rule(source, selector)
  const max = /max-height:\s*([^;]+);/.exec(block)?.[1]?.trim() ?? ''
  expect(max, selector + ' 缺少 max-height').not.toBe('')
  expect(max, selector + ' 的 max-height 不是有限值').not.toMatch(/^(none|unset|initial|inherit)$/)
  expect(block, selector + ' 超出后要在块内滚动').toMatch(/overflow(-y)?:\s*auto;/)
}

describe('Agent 对话：展开内容不会无限长高', () => {
  it('思考行照官方 Demo：只加 whitespace-pre-wrap（不叠自己的高度上限）', () => {
    // 用户口径 2026-11-07：思考行照官方 Reasoning Demo 原样写，
    // 不再叠自己的高度上限 / 滚动（Demo 只有 whitespace-pre-wrap）。
    expect(conversation).toContain('class="whitespace-pre-wrap"')
    expect(conversation).not.toContain('max-h-[min(360px,50vh)]')
  })

  it('工具卡片详情：工具名 + 输入 + 输出合计高度受限', () => {
    expectBounded('.tvc-details', toolBody)
  })

  it('工具卡片详情的高度上限仍然走统一变量', () => {
    expect(rule(toolBody, '.tvc-details')).toContain('var(--ac-expand-max-height')
  })
})
