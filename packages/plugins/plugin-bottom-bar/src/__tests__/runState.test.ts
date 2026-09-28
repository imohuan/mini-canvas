import { describe, it, expect } from 'vitest'
import { readRunState, runningState, progressState, doneState, errorState } from '../runState'

describe('data.runState 的读写口径', () => {
  it('缺省 = idle', () => {
    expect(readRunState({}).status).toBe('idle')
    expect(readRunState(undefined).status).toBe('idle')
  })

  it('读回时收敛非法值：进度夹到 0-100，未知 status 当 idle', () => {
    expect(readRunState({ runState: { status: 'running', progress: 250 } }).progress).toBe(100)
    expect(readRunState({ runState: { status: 'running', progress: -3 } }).progress).toBe(0)
    expect(readRunState({ runState: { status: 'weird' } }).status).toBe('idle')
  })

  it('running：带上提交者（actionId）与排队文案', () => {
    const s = runningState('image.generate:x')
    expect(s).toMatchObject({ status: 'running', progress: 0, actionId: 'image.generate:x' })
    expect(s.message).toBeTruthy()
  })

  it('progressState：进度/文案/taskId 覆盖进上一帧，actionId 不丢', () => {
    const next = progressState(runningState('a'), { progress: 40, message: '跑着', taskId: 't1' })
    expect(next).toMatchObject({ status: 'running', progress: 40, message: '跑着', taskId: 't1', actionId: 'a' })
  })

  it('done / error：终态写进 actionId（刷新后知道是谁提交的）', () => {
    expect(doneState('a', 'task-1')).toMatchObject({ status: 'done', progress: 100, actionId: 'a', taskId: 'task-1' })
    expect(errorState('a', '炸了')).toMatchObject({ status: 'error', message: '炸了', actionId: 'a' })
  })
})

