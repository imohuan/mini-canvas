/**
 * 底栏（画布级浮层）的压制条件 —— 纯判定，锁用户可见的显隐语义。
 *
 * 背景（用户要求，带截图）："拖拽的时候底部状态栏还在，请修改一下"。
 * 底栏早已从节点搬到画布 overlay 槽（它是**节点之外的浮层**，不在 BaseNode 的
 * out:bottom 之下），所以 BaseNode 那份"拖动中收起"的压制管不到它 —— 得在这里补一条。
 *
 * 规则与 BaseNode 一致：**画布上有节点正在被拖**，底栏就收起（松手立刻恢复）。
 * 与"多选 / 框选中 / 本节点 resize 中"并列，不是新的开关。
 */
import { describe, it, expect } from 'vitest'
import { resolveBottomBarSuppressed } from '../bottomBarOverlay'

const base = {
  selecting: false,
  selectedCount: 1,
  selectedId: 'n1',
  resizingId: null as string | null,
  nodeDragging: false,
  handTool: false,
}

describe('底栏压制条件（用户要求：拖拽时不显示）', () => {
  it('常态（单选一个节点、没人在拖）→ 不压制', () => {
    expect(resolveBottomBarSuppressed(base)).toBe(false)
  })

  it('画布上有节点正在被拖 → 压制（用户要求的那一条）', () => {
    expect(resolveBottomBarSuppressed({ ...base, nodeDragging: true })).toBe(true)
  })

  it('拖动是**画布级**的：拖的哪怕是别的节点，本节点的底栏也一起收起', () => {
    // 纯函数没有"被拖的是谁"的输入 —— 这正是要求：不比节点 id，只看"有没有节点在拖"
    expect(resolveBottomBarSuppressed({ ...base, selectedId: 'n2', nodeDragging: true })).toBe(true)
  })

  it('框选进行中 → 压制（既有语义，别被这次改动弄丢）', () => {
    expect(resolveBottomBarSuppressed({ ...base, selecting: true })).toBe(true)
  })

  it('多选（选中 >=2）→ 压制（底栏语义是"恰好选中一个"）', () => {
    expect(resolveBottomBarSuppressed({ ...base, selectedCount: 2 })).toBe(true)
  })

  it('被 resize 的就是本节点 → 压制（既有语义）', () => {
    expect(resolveBottomBarSuppressed({ ...base, resizingId: 'n1' })).toBe(true)
  })

  it('被 resize 的是别人 → 不压制（不做全局压制）', () => {
    expect(resolveBottomBarSuppressed({ ...base, resizingId: 'other' })).toBe(false)
  })

  it('抓手工具 → 压制（用户要求：抓手模式下节点上下状态栏都不显示）', () => {
    expect(resolveBottomBarSuppressed({ ...base, handTool: true })).toBe(true)
  })

  it('切回移动工具 → 不压制（抓手那条不是"永久收起"）', () => {
    expect(resolveBottomBarSuppressed({ ...base, handTool: false })).toBe(false)
  })
})
