/**
 * 节点三态契约（用户 2026-11-09：「节点有三个状态：错误 / 加载中 / 加载成功」，且要是全局性的）。
 *
 * 这条判定的重要性：壳（是否收起 resize 把手）、任务覆盖层（是否显示）、
 * 视频播放拦截（是否允许悬停播放）全都读它。判错一次会同时影响三处。
 */
import { describe, expect, it } from 'vitest'
import { isNodeCovered, readNodeVisualState } from '../nodeVisualState'

describe('readNodeVisualState：三态', () => {
  it('running → 加载中', () => {
    expect(readNodeVisualState({ data: { runState: { status: 'running', progress: 42 } } })).toBe('loading')
  })

  it('error → 错误', () => {
    expect(readNodeVisualState({ data: { runState: { status: 'error', message: 'ffmpeg 退出码 1' } } })).toBe(
      'error',
    )
  })

  it('done / idle / 没有 runState → 加载成功（可正常交互）', () => {
    expect(readNodeVisualState({ data: { runState: { status: 'done', progress: 100 } } })).toBe('ready')
    expect(readNodeVisualState({ data: { runState: { status: 'idle' } } })).toBe('ready')
    expect(readNodeVisualState({ data: {} })).toBe('ready')
    expect(readNodeVisualState({})).toBe('ready')
    expect(readNodeVisualState(undefined)).toBe('ready')
    expect(readNodeVisualState(null)).toBe('ready')
  })

  it('脏数据（runState 是字符串/数字/缺 status）→ 加载成功，不抛', () => {
    expect(readNodeVisualState({ data: { runState: 'running' } })).toBe('ready')
    expect(readNodeVisualState({ data: { runState: 1 } })).toBe('ready')
    expect(readNodeVisualState({ data: { runState: null } })).toBe('ready')
    expect(readNodeVisualState({ data: { runState: {} } })).toBe('ready')
    expect(readNodeVisualState({ data: { runState: { status: 'weird' } } })).toBe('ready')
  })
})

describe('isNodeCovered：卡上有没有覆盖层挡着', () => {
  it('加载中 / 错误都算盖住（两者都是整卡覆盖）', () => {
    expect(isNodeCovered({ data: { runState: { status: 'running' } } })).toBe(true)
    expect(isNodeCovered({ data: { runState: { status: 'error' } } })).toBe(true)
  })

  it('加载成功不算盖住（照常显示 resize 把手与悬停播放）', () => {
    expect(isNodeCovered({ data: { runState: { status: 'done' } } })).toBe(false)
    expect(isNodeCovered({ data: {} })).toBe(false)
    expect(isNodeCovered(undefined)).toBe(false)
  })
})
