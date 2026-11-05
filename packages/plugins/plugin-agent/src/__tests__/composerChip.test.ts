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
import { readSfcWithStyles } from './readSfcWithStyles'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const read = (rel: string): string => readFileSync(path.resolve(HERE, rel), 'utf8')
const conversation = readSfcWithStyles(path.resolve(HERE, '../ui/conversation/AgentComposer.vue'))
const resources = read('../ui/shared/agentResources.ts')
const msgList = readSfcWithStyles(path.resolve(HERE, '../ui/conversation/AgentMessageList.vue'))

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
    expect(ruleBody(msgList, '.ac-sent-tag')).toMatch(/max-width:\s*[^;]+;/)
  })

  it('名字那一格同样截断', () => {
    const body = ruleBody(msgList, '.ac-sent-tag-label')
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

/**
 * 标签的缩略图**不能**用 <img>（用户 2026-11-06 实测报的「图被隐藏」）。
 *
 * 编辑器会给标签里每个 <img> 套上自己的缩略加载器：按 item.url 重设 src，
 * 失败就 display:none —— 视频标签的 url 是 mp4，于是图被换成 mp4 再隐藏。
 * 用背景图层绕开那条路，这里钉住这一点，防止以后被"顺手改回 <img>"。
 */
describe('标签缩略图（.ac-tag-thumb）', () => {
  it('用背景图层，不插 <img>', () => {
    expect(resources).toMatch(/backgroundImage/)
    expect(resources).not.toMatch(/createElement\('img'\)/)
  })

  it('图层铺满图标格并裁切（不撑大标签）', () => {
    const body = ruleBody(conversation, '.prose-mirror-editor .ac-tag .ac-tag-thumb')
    expect(body).toMatch(/position:\s*absolute/)
    expect(body).toMatch(/background-size:\s*cover/)
  })

  it('图标格是固定方形（换图时标签宽度不跳）', () => {
    const body = ruleBody(conversation, '.prose-mirror-editor .ac-tag .ac-tag-icon')
    expect(body).toMatch(/width:\s*16px/)
    expect(body).toMatch(/height:\s*16px/)
    expect(body).toMatch(/overflow:\s*hidden/)
  })
})
