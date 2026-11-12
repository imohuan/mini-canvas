/**
 * selection 能力（§4.5 capability）—— 多选框上的按钮要拿到"当前选中了哪些节点"。
 *
 * 用户要求：多选框区域栏的作者用 `needs: ['selection']` 就能拿到完整上下文
 * （选中 id + 节点对象），与节点上写 `needs: ['node']` **同一套规则**。
 */
import { describe, it, expect } from 'vitest'
import { createStandardCapabilities, type SelectionCapability } from '../standardCapabilities'

/** 最小 ctx：只给 selection / doc 两格（selection 能力真正读到的） */
function ctxOf(ids: string[], nodes: Array<{ id: string; type: string }>) {
  return {
    get: (name: string) => {
      if (name === 'selection') return { ids: new Set(ids) }
      if (name === 'doc') return { getNodes: () => nodes }
      return undefined
    },
  } as never
}

describe('selection 能力', () => {
  it('拿到当前选中 id 与对应节点对象（按需快照，读时取最新）', () => {
    const caps = createStandardCapabilities(ctxOf(['a', 'b'], [
      { id: 'a', type: 'image' },
      { id: 'b', type: 'text' },
      { id: 'c', type: 'text' },
    ]))
    const sel = caps.selection({} as never) as SelectionCapability
    expect(sel.ids()).toEqual(['a', 'b'])
    expect(sel.nodes().map((n) => n.id)).toEqual(['a', 'b'])
  })

  it('没选中任何节点时是空集（不抛错）', () => {
    const caps = createStandardCapabilities(ctxOf([], []))
    const sel = caps.selection({} as never) as SelectionCapability
    expect(sel.ids()).toEqual([])
    expect(sel.nodes()).toEqual([])
  })
})
