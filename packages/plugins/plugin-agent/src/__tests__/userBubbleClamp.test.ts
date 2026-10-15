/**
 * 用户气泡「默认只显示前 8 行 + 左下角展开」（用户口径 2026-10-15）：
 * 长消息会把对话列表的滚动区占掉一大块（实测一条长输入占了大半屏）。
 *
 * 这层契约钉两头（包内测试跑在 node 环境，挂不了真 DOM —— 高度测量本身在浏览器里由
 * ResizeObserver 兜，这里钉「有没有这条路」与「按钮长不长这样」）：
 *   ① 源码级：正文套了可测量壳（ref 回调）、有夹高样式、按钮由"超出"驱动并带图标；
 *   ② 行为级：切回渲染层测不了，但状态机（openUserBubbles / overflowingUser）
 *      的接线用源码守卫锁死，防止以后重构把按钮删掉或改成永远显示。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const host = readFileSync(path.resolve(HERE, '../components/AgentConversation.vue'), 'utf8')

describe('用户气泡高度夹层与展开按钮', () => {
  it('正文有测量壳：ref 回调按消息 id 注册，夹层类由「超出且未展开」驱动', () => {
    expect(host).toContain(':ref="setUserBubbleBody(t.id)"')
    expect(host).toContain("'is-clamped': overflowingUser[t.id] && !openUserBubbles[t.id]")
  })

  it('夹高 = 8 行 × 24px 行高（192px），写死在样式里并有注释说明来源', () => {
    expect(host).toMatch(/.ac-user-line.is-clamped {[^}]*max-height: 192px;/)
    expect(host).toContain('行高 24px × 8 = 192px')
  })

  it('按钮只在「超出」时出现，带展开/收起图标，位于气泡左下角', () => {
    expect(host).toContain('<button v-if="overflowingUser[t.id]" class="ac-user-toggle"')
    expect(host).toContain(':aria-expanded="!!openUserBubbles[t.id]"')
    // 图标：收起态朝下（还有内容），展开态朝上
    expect(host).toContain('<ChevronDown v-if="!openUserBubbles[t.id]" :size="13" />')
    expect(host).toContain('<ChevronUp v-else :size="13" />')
    // 左下角：align-self 拉到气泡左侧（气泡本体是右对齐的）
    expect(host).toMatch(/.ac-user-toggle {[^}]*align-self: flex-start;/)
  })

  it('测量用 ResizeObserver 兜底（内容变化 / 面板拖宽换行都会重测），卸载时清干净', () => {
    // 回调走 scheduleMeasureUserBubbles（nextTick 合并），防渲染帧内写响应式状态自触发
    expect(host).toContain('new ResizeObserver(() => scheduleMeasureUserBubbles())')
    expect(host).toContain('bubbleRO?.disconnect()')
    expect(host).toContain('userBubbleBodies.clear()')
  })
})
