/**
 * 流输出自动吸底 —— 判定逻辑单测。
 *
 * 用户口径（2026-10-02）：
 *   「流输出的时候，如果距离底部合适，就吸附底部（自动滚到底）。
 *     但是我如果向上滚动，超过这个吸附距离的话，就不用吸附。」
 *
 * 这里钉的是**判定**（纯函数）；监听/滚动那部分靠浏览器 e2e 验收。
 */
import { describe, it, expect } from 'vitest'
import { distanceToBottom, isNearBottom } from '../stickToBottomCore'

/** 造一份滚动状态：内容总高 scrollHeight、视口 clientHeight、当前 scrollTop */
const at = (scrollTop: number, scrollHeight: number, clientHeight: number) => ({ scrollTop, scrollHeight, clientHeight })

describe('distanceToBottom：离底还有多远', () => {
  it('精确到底 → 0', () => {
    expect(distanceToBottom(at(400, 1000, 600))).toBe(0)
  })
  it('还没到底 → 剩余距离', () => {
    expect(distanceToBottom(at(100, 1000, 600))).toBe(300)
  })
  it('滚过头（弹性滚动/小数）→ 不返回负数', () => {
    expect(distanceToBottom(at(450, 1000, 600))).toBe(0)
  })
  it('内容不足以滚动 → 0（本来就"在底部"）', () => {
    expect(distanceToBottom(at(0, 300, 600))).toBe(0)
  })
  it('浮点滚动位置照常算（浏览器 scrollTop 常是小数）', () => {
    expect(distanceToBottom(at(399.5, 1000, 600))).toBe(0.5)
  })
})

describe('isNearBottom：吸附判定', () => {
  const THRESHOLD = 48

  it('正好贴底 → 吸附', () => {
    expect(isNearBottom(at(400, 1000, 600), THRESHOLD)).toBe(true)
  })
  it('离底在阈值内（差 20px）→ 吸附', () => {
    expect(isNearBottom(at(380, 1000, 600), THRESHOLD)).toBe(true)
  })
  it('离底正好等于阈值 → 吸附（边界含等号）', () => {
    expect(isNearBottom(at(352, 1000, 600), THRESHOLD)).toBe(true)
  })
  it('离底超过阈值 1px → 不吸附（用户往上滚了就不该被拽回去）', () => {
    expect(isNearBottom(at(351, 1000, 600), THRESHOLD)).toBe(false)
  })
  it('用户翻到中间看历史 → 不吸附', () => {
    expect(isNearBottom(at(0, 1000, 600), THRESHOLD)).toBe(false)
  })
  it('内容不足以滚动 → 吸附（否则永远不跟随）', () => {
    expect(isNearBottom(at(0, 300, 600), THRESHOLD)).toBe(true)
  })
  it('阈值可调：0 表示只认精确贴底', () => {
    expect(isNearBottom(at(352, 1000, 600), 0)).toBe(false)
    expect(isNearBottom(at(400, 1000, 600), 0)).toBe(true)
  })
  it('负阈值按 0 处理（不因配置错误把判定放宽）', () => {
    expect(isNearBottom(at(352, 1000, 600), -100)).toBe(false)
  })
})

