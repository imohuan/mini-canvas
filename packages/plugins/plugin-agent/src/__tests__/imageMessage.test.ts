/**
 * 图片消息 —— 用户侧行为契约（2026-10-03 用户要求「Agent 暂时还不支持图片，请添加」）。
 *
 * 锁三件事：
 *   ① 带图的用户消息在界面上**留得下图**（kind=user + images），刷新回放也在；
 *   ② 只有图、没打字也算一条合法消息（用户常直接丢图问"这是什么"）；
 *   ③ 回放（load）时图片跟着回来 —— 不落这一点，切会话就只剩光秃秃的文字。
 */
import { describe, it, expect } from 'vitest'
import { ChatModel } from '../sessionModel'

const IMG = 'data:image/png;base64,iVBORw0KGgo='

describe('带图发送', () => {
  it('用户那条留着 images（助手那条不凭空长图）', () => {
    const m = new ChatModel()
    m.send('这是什么', [IMG])
    const user = m.turns.find((t) => t.kind === 'user')!
    const assistant = m.turns.find((t) => t.kind === 'assistant')!
    expect(user.images).toEqual([IMG])
    expect(user.text).toBe('这是什么')
    expect(assistant.images).toBeUndefined()
  })

  it('只有图、没有文字：用户那条照样建出来（text 为空但不报错）', () => {
    const m = new ChatModel()
    m.send('', [IMG])
    const user = m.turns.find((t) => t.kind === 'user')!
    expect(user.text).toBe('')
    expect(user.images).toEqual([IMG])
  })

  it('多张图按顺序留着', () => {
    const m = new ChatModel()
    m.send('两张', [IMG, IMG + 'x'])
    expect(m.turns.find((t) => t.kind === 'user')!.images).toEqual([IMG, IMG + 'x'])
  })

  it('不带图时不留一个空的 images 字段（界面据此判断要不要画图区）', () => {
    const m = new ChatModel()
    m.send('没图')
    expect(m.turns.find((t) => t.kind === 'user')!.images).toBeUndefined()
  })

  it('数组是拷贝：外面改它不会串到已存的消息里', () => {
    const m = new ChatModel()
    const src = [IMG]
    m.send('x', src)
    src.push(IMG + 'y')
    expect(m.turns.find((t) => t.kind === 'user')!.images).toEqual([IMG])
  })
})

describe('历史回放', () => {
  it('load 把图片一起还原', () => {
    const m = new ChatModel()
    m.load([
      { role: 'user', text: '看图', images: [IMG] },
      { role: 'assistant', text: '看到了' },
    ])
    const user = m.turns.find((t) => t.kind === 'user')!
    expect(user.images).toEqual([IMG])
    expect(m.turns.find((t) => t.kind === 'assistant')!.text).toContain('看到了')
  })

  it('老转录（没有 images 字段）照常加载，不冒出空数组', () => {
    const m = new ChatModel()
    m.load([{ role: 'user', text: '旧消息' }, { role: 'assistant', text: '好' }])
    expect(m.turns.find((t) => t.kind === 'user')!.images).toBeUndefined()
  })
})

