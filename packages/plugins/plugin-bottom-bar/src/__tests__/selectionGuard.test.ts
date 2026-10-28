/**
 * 选择态「什么时候该收」的回归测试（用户 2026-10-28 真机复现）。
 *
 * 现象：底栏显示时按 Ctrl 完全没有变化。
 * 根因：宿主守卫每帧要求「恰好单选宿主」，而进拖拽/拖资源时选中集会短暂变化，
 * 于是刚进入的拖拽模式在同一帧内被自己关掉（退出栈落在 guardOwnerSelected）。
 */
import { describe, expect, it } from 'vitest'
import { shouldKeepSelection } from '../selectionMode'

describe('选择态宿主守卫：只认「宿主还在选中集里」', () => {
  it('单选宿主 → 保留', () => {
    expect(shouldKeepSelection({ selected: new Set(['n1']), owner: 'n1' })).toBe(true)
  })

  it('多选里包含宿主 → 保留（拖拽开始时会短暂多选，不能误判成掉选）', () => {
    expect(shouldKeepSelection({ selected: new Set(['n1', 'n2']), owner: 'n1' })).toBe(true)
  })

  it('选中集为空（点画布空白）→ 收', () => {
    expect(shouldKeepSelection({ selected: new Set(), owner: 'n1' })).toBe(false)
  })

  it('选中换成了别的节点 → 收', () => {
    expect(shouldKeepSelection({ selected: new Set(['n2']), owner: 'n1' })).toBe(false)
  })

  it('没有宿主 → 收（防呆）', () => {
    expect(shouldKeepSelection({ selected: new Set(['n1']), owner: '' })).toBe(false)
  })
})
