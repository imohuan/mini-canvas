/**
 * 下栏槽位宿主的压制条件 —— 锁用户可见的显隐语义（与 BaseNode 的 hideSlotBars 逐条对齐）。
 *
 * 背景（用户带截图报过）：「拖拽的时候底部状态栏还在」。底栏住在画布级浮层（不在节点里），
 * BaseNode 那份压制管不到它，所以在宿主这一层补同一条规则。
 */
import { describe, it, expect } from 'vitest'
import { resolveBottomSlotSuppressed } from '../nodeBottomSlot'

const base = {
  selecting: false,
  selectedCount: 1,
  selectedId: 'n1',
  resizingId: null as string | null,
  nodeDragging: false,
  handTool: false,
}

describe('下栏槽位宿主的压制条件', () => {
  it('常态（单选一个节点、没人在拖）→ 不压制', () => {
    expect(resolveBottomSlotSuppressed(base)).toBe(false)
  })

  it('画布上有节点正在被拖 → 压制（用户要求的那一条）', () => {
    expect(resolveBottomSlotSuppressed({ ...base, nodeDragging: true })).toBe(true)
  })

  it('拖动是画布级的：拖别的节点，本节点的下栏也收起', () => {
    expect(resolveBottomSlotSuppressed({ ...base, selectedId: 'n2', nodeDragging: true })).toBe(true)
  })

  it('框选进行中 → 压制', () => {
    expect(resolveBottomSlotSuppressed({ ...base, selecting: true })).toBe(true)
  })

  it('多选（>=2）→ 压制（下栏语义是恰好选中一个）', () => {
    expect(resolveBottomSlotSuppressed({ ...base, selectedCount: 2 })).toBe(true)
  })

  it('被 resize 的就是本节点 → 压制', () => {
    expect(resolveBottomSlotSuppressed({ ...base, resizingId: 'n1' })).toBe(true)
  })

  it('被 resize 的是别人 → 不压制（不做全局压制）', () => {
    expect(resolveBottomSlotSuppressed({ ...base, resizingId: 'other' })).toBe(false)
  })

  it('抓手工具 → 压制（节点上下状态栏都不显示）', () => {
    expect(resolveBottomSlotSuppressed({ ...base, handTool: true })).toBe(true)
  })

  it('切回移动工具 → 不压制', () => {
    expect(resolveBottomSlotSuppressed({ ...base, handTool: false })).toBe(false)
  })
})
