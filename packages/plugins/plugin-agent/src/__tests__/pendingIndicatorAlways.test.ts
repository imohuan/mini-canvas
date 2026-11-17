/**
 * 「正在思考」要稳定显示（用户 2026-11-17 报「时灵时不灵」）。
 *
 * 旧条件 `showPendingOn(t) && !thinkingLive(t)`：
 *   thinkingLive = 在跑 + 还没出正文。
 * 于是：没思考块时条件恒假（加载行被藏），出了正文后条件变真（加载行才冒出来）。
 * 正确语义是「已经有一条在跑的思考行时才不重复画」。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const list = readFileSync(path.resolve(HERE, '../ui/conversation/AgentMessageList.vue'), 'utf8')
const views = readFileSync(path.resolve(HERE, '../ui/conversation/useAgentMessageViews.ts'), 'utf8')

describe('正在思考的显示条件', () => {
  it('加载行不再用 thinkingLive 做去重条件', () => {
    expect(list).not.toContain('showPendingOn(t) && !thinkingLive(t)')
    expect(list).toContain('showPendingOn(t) && !liveThinkingRow(t)')
  })

  it('去重只看「已有一条在跑的思考行」，与是否已出正文无关', () => {
    const at = views.indexOf('function liveThinkingRow')
    expect(at).toBeGreaterThanOrEqual(0)
    const body = views.slice(at, views.indexOf('\n}', at))
    expect(body).toContain('thinkingLive(t)')
    expect(body).toContain("last.type === 'thinking'")
  })
})
