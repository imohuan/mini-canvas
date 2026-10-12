/**
 * 「正在思考」只能有一个（真机实测 2026-10-12，用户截图）。
 *
 * 引导（steer）是**一轮还在跑的时候**插队：那一刻上一条助手消息的 streaming 仍是 true。
 * 若开新助手占位时不把它收掉，界面上就同时挂两个加载指示。
 * 队列自动发的下一条同理（acceptUserMessage 补占位那条路）。
 */
import { describe, it, expect } from 'vitest'
import { ChatModel } from '../sessionModel'

const assistants = (m: ChatModel) => m.turns.filter((t) => t.kind === 'assistant')

describe('加载指示唯一性', () => {
  it('引导插队（第二轮 send）时，上一条的 streaming 被收掉', () => {
    const m = new ChatModel()
    m.send('第一句')
    expect(assistants(m).filter((t) => t.streaming)).toHaveLength(1)
    // 一轮还在跑时，用户点引导插队 —— 就是这里产生第二个加载
    m.send('插队的一句')
    expect(assistants(m).filter((t) => t.streaming)).toHaveLength(1)
    // 历史那条的内容不动，只是不再显示加载
    expect(assistants(m)[0].text).toBe('')
  })

  it('队列自动发下一条（acceptUserMessage 补占位）时同样只留一个加载', () => {
    const m = new ChatModel()
    m.send('第一句')
    m.acceptUserMessage('队列里排的下一条')
    expect(assistants(m).filter((t) => t.streaming)).toHaveLength(1)
  })

  it('一轮真正结束时（done）全部收掉，不会留下多余的加载', () => {
    const m = new ChatModel()
    m.send('第一句')
    m.apply({ type: 'done' })
    expect(assistants(m).filter((t) => t.streaming)).toHaveLength(0)
  })
})

