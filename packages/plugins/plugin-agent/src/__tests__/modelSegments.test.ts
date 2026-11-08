/**
 * 模型分段 / 上下文统计行的纯逻辑（用户口径 2026-10-11）。
 *
 * 两条都锁"用户能看到的后果"：
 *  · 分割线只画在该显示的那条用户消息之前（数错位置 = 用户以为换了模型却没换）；
 *  · 上下文统计行在没有数据时**不画**（不显示 "已用 0"，那是假的）。
 */
import { describe, it, expect } from 'vitest'
import { segmentAnchors, type ModelSegment } from '../model/modelSegments'

const turns = [
  { id: 'u1', kind: 'user' },
  { id: 'a1', kind: 'assistant' },
  { id: 'u2', kind: 'user' },
  { id: 'u3', kind: 'user' },
]

const seg = (fromUser: number, modelId: string): ModelSegment => ({ fromUser, provider: 'p', modelId })

describe('模型分割线的定位', () => {
  it('没有分段时一个都不画（单模型会话照旧是"一条线到底"）', () => {
    expect(segmentAnchors(turns, []).size).toBe(0)
  })

  it('分段挂在该段的**第一条用户消息**上（第一条也算：用户要知道开头用的是什么）', () => {
    // 用户口径 2026-11-07：fromUser = 0 那一段是「开头用的模型」，不是切换，不画线。
    const map = segmentAnchors(turns, [seg(0, 'deepseek-auto'), seg(1, 'gpt-5')])
    expect([...map.keys()]).toEqual(['u2'])
    expect(map.get('u2')!.modelId).toBe('gpt-5')
  })

  it('只有一条消息 / 只有一个模型时**不画**分割线（用户口径 2026-11-07）', () => {
    expect(segmentAnchors(turns.slice(0, 2), [seg(0, 'only-model')]).size).toBe(0)
    // 同一个模型被重复写入两段（老数据）也不画
    expect(segmentAnchors(turns, [seg(0, 'm'), seg(1, 'm')]).size).toBe(0)
  })

  it('序号超出实际用户消息数的分段被丢掉（陈旧数据不画幽灵分割线）', () => {
    const map = segmentAnchors(turns, [seg(9, 'ghost')])
    expect(map.size).toBe(0)
  })

  it('只在 user 回合上数序号（助手 / 工具 / 审批回合不占号）', () => {
    // 第 3 条 user 是下标 2 —— 若把助手回合也数进去就会挂到错误的节点上
    const map = segmentAnchors(turns, [seg(2, 'third')])
    expect([...map.keys()]).toEqual(['u3'])
  })
})
