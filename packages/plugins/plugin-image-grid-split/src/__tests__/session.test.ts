import { describe, expect, it } from 'vitest'
import { closeGridSession, gridSession, openGridSession, setGridSelection, toggleGridCell } from '../session'

describe('宫格会话', () => {
  it('打开时默认全选，关闭后清空', () => {
    openGridSession({ nodeId: 'n1', imageUrl: 'blob:x', width: 300, height: 200, size: { rows: 2, cols: 3 } })
    expect(gridSession.value?.selected.size).toBe(6)
    expect([...gridSession.value!.selected].sort()).toEqual(['0:0', '0:1', '0:2', '1:0', '1:1', '1:2'])
    closeGridSession()
    expect(gridSession.value).toBeNull()
  })

  it('切换格子只改新会话对象，不原地改动共享 Set', () => {
    openGridSession({ nodeId: 'n1', imageUrl: 'blob:x', width: 300, height: 200, size: { rows: 2, cols: 2 } })
    const before = gridSession.value!
    toggleGridCell('0:0')
    expect(before.selected.has('0:0')).toBe(true)
    expect(gridSession.value!.selected.has('0:0')).toBe(false)
    expect(gridSession.value!.selected.size).toBe(3)
    setGridSelection(['1:1'])
    expect([...gridSession.value!.selected]).toEqual(['1:1'])
    closeGridSession()
  })
})
