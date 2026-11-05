/**
 * 发布前必须先弹项目确认框（用户口径 2026-11-06）。
 *
 * 以前发布会直接写节点；这里锁两件事：
 * 1. 两种发布入口都有确认文案，标题能区分；
 * 2. 文案里给出会新增多少内容，用户能判断这次动作的规模。
 */
import { describe, expect, it } from 'vitest'
import { publishConfirmText } from '../publishConfirm'

describe('publishConfirmText', () => {
  it('发送到画布：标题、按钮、数量都对', () => {
    const opts = publishConfirmText('canvas', 9)
    expect(opts.title).toBe('发送到画布')
    expect(opts.confirmText).toBe('发送')
    expect(opts.cancelText).toBe('取消')
    expect(opts.description).toContain('9 个内容')
    expect(opts.description).toContain('分组')
  })

  it('创建分镜组：标题与说明不同，仍然带数量', () => {
    const opts = publishConfirmText('storyboard', 4)
    expect(opts.title).toBe('创建分镜组')
    expect(opts.confirmText).toBe('创建')
    expect(opts.description).toContain('4 个内容')
    expect(opts.description).toContain('拖拽排序')
  })
})
