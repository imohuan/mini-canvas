/**
 * nodeRunState —— "节点是否在跑任务"这条判定的契约。
 *
 * 为什么要单独钉：渲染层（卡片尺寸 / VueFlow 包裹尺寸）要在**每个节点**上读它，
 * 而 runState 是插件/后台写的。判定一旦把非法值当成 true，整画布节点都会在跑任务时
 * 抖成默认尺寸；反过来漏判，图片/视频重新生成又会停在旧比例。所以边界要钉死。
 */
import { describe, it, expect } from 'vitest'
import { isNodeRunning, NODE_RUNNING_STATUS } from '../nodeRunState'

describe('isNodeRunning', () => {
  it("status === 'running' 才算在跑", () => {
    expect(isNodeRunning({ data: { runState: { status: 'running' } } })).toBe(true)
    expect(NODE_RUNNING_STATUS).toBe('running')
  })

  it('done / error / idle / 缺 status 一律不算在跑', () => {
    for (const status of ['done', 'error', 'idle', undefined]) {
      expect(isNodeRunning({ data: { runState: { status } } })).toBe(false)
    }
  })

  it('缺 data / 缺 runState / runState 非法（字符串/数字/null）一律 false，不抛', () => {
    expect(isNodeRunning(undefined)).toBe(false)
    expect(isNodeRunning(null)).toBe(false)
    expect(isNodeRunning({})).toBe(false)
    expect(isNodeRunning({ data: undefined })).toBe(false)
    expect(isNodeRunning({ data: {} })).toBe(false)
    expect(isNodeRunning({ data: { runState: 'running' } })).toBe(false)
    expect(isNodeRunning({ data: { runState: 1 } })).toBe(false)
    expect(isNodeRunning({ data: { runState: null } })).toBe(false)
  })
})
