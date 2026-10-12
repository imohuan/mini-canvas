/**
 * 内联标签的**长名字收口**（用户口径 2026-10-11：名字很长时把输入框撑破了）。
 *
 * 为什么单测：这条只能靠 CSS 收住，而 CSS 塌掉时是**静默**的 —— 页面照常跑、
 * 单测全绿，只有眼尖才看得出标签戳出了输入框。所以把两个要点钉在源码上：
 *   ① 标签自己有限宽（不然一行就是「输入框多宽它多宽」，长名字直接把行撑爆）；
 *   ② 文字那一格有 `min-width: 0` —— flex 子项默认 `min-width: auto`（= 内容宽），
 *      只写 `max-width` 时 min-width 会赢，省略号根本不出现（这条最容易漏）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const read = (rel: string): string => readFileSync(path.resolve(HERE, rel), 'utf8')
const conversation = read('../components/AgentConversation.vue')
const resources = read('../agentResources.ts')

/** 取一条样式规则的正文（从 `选择器 {` 到它自己的 `}`） */
function ruleBody(source: string, selector: string): string {
  const at = source.indexOf(selector + ' {')
  expect(at, '找不到样式规则：' + selector).toBeGreaterThan(-1)
  return source.slice(at, source.indexOf('}', at))
}

describe('输入框内联标签（.ac-tag）', () => {
  it('标签自身限宽（不能撑破输入框）', () => {
    const body = ruleBody(conversation, '.prose-mirror-editor .ac-tag')
    expect(body).toMatch(/max-width:\s*[^;]+;/)
  })

  it('名字那一格会截断：min-width:0 + overflow:hidden + ellipsis', () => {
    const body = ruleBody(conversation, '.prose-mirror-editor .ac-tag .ac-tag-label')
    expect(body).toMatch(/min-width:\s*0/)
    expect(body).toMatch(/overflow:\s*hidden/)
    expect(body).toMatch(/text-overflow:\s*ellipsis/)
    expect(body).toMatch(/white-space:\s*nowrap/)
  })
})

describe('已发送的标签（.ac-sent-tag，与输入框那颗同款外观）', () => {
  it('同样限宽', () => {
    expect(ruleBody(conversation, '.ac-sent-tag')).toMatch(/max-width:\s*[^;]+;/)
  })

  it('名字那一格同样截断', () => {
    const body = ruleBody(conversation, '.ac-sent-tag-label')
    expect(body).toMatch(/min-width:\s*0/)
    expect(body).toMatch(/overflow:\s*hidden/)
    expect(body).toMatch(/text-overflow:\s*ellipsis/)
  })
})

describe('@ 菜单里的行（.ac-mrow-name）', () => {
  it('长名字单行省略，不把行拉成两行', () => {
    const body = ruleBody(conversation, '.mention-menu .ac-mrow-name')
    expect(body).toMatch(/white-space:\s*nowrap/)
    expect(body).toMatch(/overflow:\s*hidden/)
    expect(body).toMatch(/text-overflow:\s*ellipsis/)
  })
})

describe('截断之后还读得到全名', () => {
  it('标签带 title（鼠标停上去看全名）', () => {
    expect(resources).toMatch(/el\.title\s*=/)
  })
})
