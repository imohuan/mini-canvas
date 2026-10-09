/**
 * 队列自动发的消息必须长出**用户气泡**（用户实测报的 bug）。
 *
 * 背景：用户自己点发送时，前端在本地就造好了用户气泡；但**队列自动发的**那一条
 * 前端完全没参与 —— 后端不推事件的话，界面上只有 AI 的回答，看起来"消息跑到 AI 那侧"
 * 或"AI 对着空气说话"。
 *
 * 修法：后端每轮开跑前推一条 `user_message` 事件；前端 acceptUserMessage() 补气泡 +
 * 助手占位。这层钉住 acceptUserMessage 的语义（含去重与助手占位）。
 */
import { describe, it, expect } from 'vitest'
import { ChatModel } from '../sessionModel.js'

describe('acceptUserMessage：从流里补用户气泡', () => {
  it('队列自动发的那条（前端没参与）⇒ 补出用户气泡 + 助手占位', () => {
    const m = new ChatModel()
    m.acceptUserMessage('队列里的第一句')
    expect(m.turns).toHaveLength(2)
    expect(m.turns[0]).toMatchObject({ kind: 'user', text: '队列里的第一句' })
    expect(m.turns[1]).toMatchObject({ kind: 'assistant', text: '', streaming: true })
  })

  it('用户自己发送的那条（本地已造过）⇒ 不重复造气泡，但仍补助手占位', () => {
    const m = new ChatModel()
    m.send('我自己发的') // 本地：用户气泡 + 助手占位（模拟 submit 的路径）
    expect(m.turns).toHaveLength(2)
    // 后端这一轮也会推同一条 —— 不该再长出第三个 turn
    m.acceptUserMessage('我自己发的')
    expect(m.turns).toHaveLength(2)
    expect(m.turns[0]).toMatchObject({ kind: 'user', text: '我自己发的' })
    expect(m.turns[1].kind).toBe('assistant')
  })

  it('上一条助手已结束（上一轮跑完）⇒ 补用户气泡 + 新的助手占位', () => {
    const m = new ChatModel()
    m.send('第一句')
    m.apply({ type: 'text', text: '第一条回答', final: true })
    // 队列自动发的第二条
    m.acceptUserMessage('第二句')
    expect(m.turns.map((t) => t.kind)).toEqual(['user', 'assistant', 'user', 'assistant'])
    expect(m.turns[2]).toMatchObject({ kind: 'user', text: '第二句' })
    expect(m.turns[3]).toMatchObject({ kind: 'assistant', text: '', streaming: true })
  })

  it('随后的 text 事件落到**新**的助手占位上（不飘进上一条回答）', () => {
    const m = new ChatModel()
    m.send('第一句')
    m.apply({ type: 'text', text: '第一条回答', final: true })
    m.acceptUserMessage('第二句')
    m.apply({ type: 'text', text: '第二条回答', final: true })
    expect(m.turns[1].text).toBe('第一条回答') // 上一条没被污染
    expect(m.turns[3].text).toBe('第二条回答')
  })

  it('带图 / 引导标记的条目也照样补气泡', () => {
    const m = new ChatModel()
    m.acceptUserMessage('带图的一句', ['data:image/png;base64,AAA'])
    expect(m.turns[0]).toMatchObject({ kind: 'user', text: '带图的一句' })
    expect(m.turns[0].images).toEqual(['data:image/png;base64,AAA'])

    const m2 = new ChatModel()
    m2.acceptUserMessage('插队的一句', undefined, true)
    expect(m2.turns[0]).toMatchObject({ kind: 'user', text: '插队的一句', steered: true })
  })

  it('同样的文本、但本地那条不是最后一条（历史里）⇒ 仍然补新气泡（不误判为重复）', () => {
    const m = new ChatModel()
    m.send('重复的一句话')
    m.apply({ type: 'text', text: '回答', final: true })
    // 队列里又发了一条一模一样的（用户可能真的发两遍）
    m.acceptUserMessage('重复的一句话')
    expect(m.turns.filter((t) => t.kind === 'user')).toHaveLength(2)
  })
})
