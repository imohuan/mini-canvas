/**
 * [user_steering] 标记块的识别 / 剥离 / 指纹（用户口径 2026-10-15）。
 *
 * 两处消费方都靠它：气泡渲染（剥标记只显示内文）与队列联动
 * （块出现 = sending 条目已真实投递 ⇒ 从队列删掉）。
 */
import { describe, it, expect } from 'vitest'
import { parseUserSteeringBlock, stripUserSteering, steeringFingerprint, matchSendingQueueItem } from '../userSteering'

describe('user_steering 块', () => {
  it('标准形状（SDK 的 markerBlock：tag 换行内文 换行闭tag）⇒ 解析出内文', () => {
    const text = '[user_steering]\n啊收到回复啊还是\n[/user_steering]'
    expect(parseUserSteeringBlock(text)).toBe('啊收到回复啊还是')
    expect(stripUserSteering(text)).toBe('啊收到回复啊还是')
  })

  it('内文含多行 / 标点 ⇒ 原样保留', () => {
    const text = '[user_steering]\n第一行\n第二行，带标点。\n[/user_steering]'
    expect(parseUserSteeringBlock(text)).toBe('第一行\n第二行，带标点。')
  })

  it('尖括号变体也认（SDK marker 家族两种都认）', () => {
    const text = '<user_steering>你好</user_steering>'
    expect(parseUserSteeringBlock(text)).toBe('你好')
  })

  it('不是块 ⇒ null / 原样', () => {
    expect(parseUserSteeringBlock('普通消息')).toBeNull()
    expect(stripUserSteering('普通消息')).toBe('普通消息')
    // 半个块（只有开标记）不算 —— 不能把正文误吞
    expect(parseUserSteeringBlock('[user_steering]没闭合')).toBeNull()
    // 内文出现别的标记不算块
    expect(parseUserSteeringBlock('看看 [other_tag] 这个')).toBeNull()
  })

  it('指纹：剥块 + 折空白 —— 队列条目与对话消息两边都能对上', () => {
    expect(steeringFingerprint('[user_steering]\n你好  世界\n[/user_steering]')).toBe(
      steeringFingerprint('你好 世界'),
    )
    expect(steeringFingerprint('  多\n行   文本 ')).toBe('多 行 文本')
  })

  it('matchSendingQueueItem：sending + 指纹一致 + 图片一致 ⇒ 命中；其它状态 / 文本不符 ⇒ null', () => {
    const items = [
      { id: 'q1', text: '[user_steering]\n你好  世界\n[/user_steering]', state: 'sending' },
      { id: 'q2', text: '别的消息', state: 'sending' },
      { id: 'q3', text: '你好 世界', state: 'queued' },
    ]
    expect(matchSendingQueueItem(items, '你好 世界')).toBe('q1')
    // 图片清单也要一致
    const withImg = [{ id: 'q4', text: '带图', images: ['a.png'], state: 'sending' }]
    expect(matchSendingQueueItem(withImg, '带图', ['a.png'])).toBe('q4')
    expect(matchSendingQueueItem(withImg, '带图', ['b.png'])).toBeNull()
    // queued 不算（还没发）
    expect(matchSendingQueueItem([{ id: 'q5', text: '你好 世界', state: 'queued' }], '你好 世界')).toBeNull()
    // 空文本不比（防误删）
    expect(matchSendingQueueItem(items, '')).toBeNull()
  })
})
