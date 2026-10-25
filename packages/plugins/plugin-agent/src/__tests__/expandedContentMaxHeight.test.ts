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

const HERE = path.dirname(fileURLToPath(import.meta.url))
const conversation = readFileSync(path.resolve(HERE, '../components/AgentConversation.vue'), 'utf8')
const toolBody = readFileSync(path.resolve(HERE, '../components/ToolViewBody.vue'), 'utf8')

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
  it('思考过程：长段思考在块内滚动', () => {
    expectBounded('.ac-think', conversation)
  })

  it('默认工具展开区：输入 + 输出合计高度受限', () => {
    expectBounded('.ac-tf-body', conversation)
  })

  it('工具分组展开区：很多工具时也不会一路撑长', () => {
    expectBounded('.ac-tg-body', conversation)
  })

  it('工具卡片详情：工具名 + 输入 + 输出合计高度受限', () => {
    expectBounded('.tvc-details', toolBody)
  })

  it('各处共用同一个高度上限，调大调小只改一处', () => {
    expect(rule(conversation, '.ac-root')).toContain('--ac-expand-max-height:')
    expect(rule(conversation, '.ac-think')).toContain('var(--ac-expand-max-height')
    expect(rule(conversation, '.ac-tf-body')).toContain('var(--ac-expand-max-height')
    expect(rule(toolBody, '.tvc-details')).toContain('var(--ac-expand-max-height')
  })

  it('外层限高后不再套第二层滚动：输入 / 输出 pre 只跟随外层滚动', () => {
    expect(conversation).toMatch(/\.ac-tf-body :deep\(\.tvc-pre\),\s*\.ac-tf-body :deep\(\.tvb-pre\) \{\s*max-height: none;/)
    // 卡片详情里的 pre 同样不再固定 320px，而是跟随统一上限（给三块标题留出余量）
    expect(toolBody).toMatch(/\.tvc-details \.tvc-pre \{[^}]*max-height: max\(240px, calc\(var\(--ac-expand-max-height/)
  })
})
