/**
 * ChatModel.loadEarlier —— 对话分页（用户口径 2026-10-15）：更早的历史插到头部，
 * 现有消息原样保留；批次结尾的空助手占位与现有头部重复时去掉一条。
 */
import { describe, it, expect } from 'vitest'
import { ChatModel } from '../sessionModel'

const turn = (role: string, text: string, ts = 0) => ({ role, text, ts })

describe('loadEarlier', () => {
  it('批次插到头部，现有内容原样保留在后面', () => {
    const m = new ChatModel()
    m.load([turn('user', '新消息'), turn('assistant', '新回答')])
    m.loadEarlier([turn('user', '旧消息'), turn('assistant', '旧回答')])
    const texts = m.turns.map((t) => t.text)
    expect(texts).toEqual(['旧消息', '旧回答', '新消息', '新回答'])
  })

  it('批次结尾的空助手占位与现有头部重复 ⇒ 只留一条', () => {
    const m = new ChatModel()
    m.load([turn('assistant', '新回答')]) // 现有头部是助手（接续页切点的占位）
    m.loadEarlier([turn('user', '旧消息'), turn('assistant', '')]) // 批次末尾是空占位
    const kinds = m.turns.map((t) => t.kind)
    expect(kinds.filter((k) => k === 'assistant').length).toBe(1)
    expect(m.turns.map((t) => t.text)).toEqual(['旧消息', '新回答'])
  })

  it('空批次不动现有内容', () => {
    const m = new ChatModel()
    m.load([turn('user', '唯一')])
    m.loadEarlier([])
    // load 的既有行为：user turn 后总跟着一条空助手占位（后续内容的落点）
    expect(m.turns.map((t) => t.text)).toEqual(['唯一', ''])
  })
})
