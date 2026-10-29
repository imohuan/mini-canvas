/**
 * 底栏「本体是否渲染」的语义锁（快捷键门槛与模板 v-if 共用同一份判定）。
 *
 * 注：底栏浮层的压制条件（框选/多选/resize/拖动/抓手）已随 2026-10-29 重构搬到主题插件，
 * 对应测试见 plugin-theme-default 的 nodeBottomSlot 测试 —— 那里才是现在唯一的事实源。
 */
import { describe, it, expect } from 'vitest'
import { resolveBottomBarShown } from '../bottomBarOverlay'

describe('底栏本体是否渲染（快捷键门槛与模板共用同一份）', () => {
  const shown = { soleSelected: true, hasActions: true, submitted: false }

  it('单选 + 有动作 + 未提交 → 渲染（图片/视频节点常态）', () => {
    expect(resolveBottomBarShown(shown)).toBe(true)
  })

  it('可视化节点（没有底栏动作）→ 不渲染（本次快捷键误触的根因）', () => {
    expect(resolveBottomBarShown({ ...shown, hasActions: false })).toBe(false)
  })

  it('未单选 / 多选 → 不渲染（既有语义）', () => {
    expect(resolveBottomBarShown({ ...shown, soleSelected: false })).toBe(false)
  })

  it('已提交任务、栏暂时收起 → 不渲染', () => {
    expect(resolveBottomBarShown({ ...shown, submitted: true })).toBe(false)
  })
})
