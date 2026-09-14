/**
 * panoramaSession —— 交互模式会话（按节点隔离的开关）。
 *
 * 为什么值得单独测：这份状态刻意**不写进节点 data**（写进去就会落盘，刷新后一开画布
 * 就停在"转视角"模式，连拖节点都拖不动；v1 正是靠 sanitizeForSave 手动抠掉 _editing 才没踩坑）。
 * 测试锁住"按节点隔离 + 可开可关 + 幂等"，也顺带证明它与内核数据无关。
 */
import { describe, it, expect } from 'vitest'
import {
  beginInteract,
  endInteract,
  enterFullscreen,
  exitFullscreen,
  fullscreenIds,
  interactingIds,
  isInteracting,
  isFullscreen,
  resetInteractSessions,
  toggleFullscreen,
} from '../panoramaSession'

describe('panoramaSession：交互模式会话', () => {
  it('默认不在交互；begin 后可查', () => {
    resetInteractSessions()
    expect(isInteracting('n1')).toBe(false)
    beginInteract('n1')
    expect(isInteracting('n1')).toBe(true)
    endInteract('n1')
    expect(isInteracting('n1')).toBe(false)
  })

  it('按节点隔离：一个进交互不影响另一个', () => {
    resetInteractSessions()
    beginInteract('a')
    expect(isInteracting('a')).toBe(true)
    expect(isInteracting('b')).toBe(false)
  })

  it('重复 begin / 重复 end 都幂等，不会残留', () => {
    resetInteractSessions()
    beginInteract('x')
    beginInteract('x')
    expect(interactingIds().filter((id) => id === 'x')).toHaveLength(1)
    endInteract('x')
    endInteract('x')
    expect(isInteracting('x')).toBe(false)
  })

  it('空 id 不写入（防幽灵条目）', () => {
    resetInteractSessions()
    beginInteract('')
    expect(interactingIds()).not.toContain('')
  })
})

describe('panoramaSession：全屏会话（f 切换）', () => {
  it('默认不全屏；进入/退出后状态正确', () => {
    resetInteractSessions()
    expect(isFullscreen('n1')).toBe(false)
    enterFullscreen('n1')
    expect(isFullscreen('n1')).toBe(true)
    exitFullscreen('n1')
    expect(isFullscreen('n1')).toBe(false)
  })

  it('toggleFullscreen 来回切换并返回切换后的状态（命令 run 靠它拿结果）', () => {
    resetInteractSessions()
    expect(toggleFullscreen('a')).toBe(true)
    expect(isFullscreen('a')).toBe(true)
    expect(toggleFullscreen('a')).toBe(false)
    expect(isFullscreen('a')).toBe(false)
  })

  it('全屏与交互是两个独立集合：退出全屏不影响交互模式', () => {
    resetInteractSessions()
    beginInteract('b')
    enterFullscreen('b')
    exitFullscreen('b')
    expect(isInteracting('b')).toBe(true)
  })

  it('按节点隔离；空 id 不写入', () => {
    resetInteractSessions()
    enterFullscreen('a')
    expect(isFullscreen('b')).toBe(false)
    enterFullscreen('')
    expect(fullscreenIds()).not.toContain('')
    expect(toggleFullscreen('')).toBe(false)
  })

  it('resetInteractSessions 两个集合一起清（测试之间不串状态）', () => {
    beginInteract('x')
    enterFullscreen('x')
    resetInteractSessions()
    expect(interactingIds()).toEqual([])
    expect(fullscreenIds()).toEqual([])
  })
})
