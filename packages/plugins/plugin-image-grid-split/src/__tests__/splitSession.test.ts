import { describe, it, expect, vi } from 'vitest'
import {
  beginSplit, endSplit, isSplitting, splitState, toggleCell, onSplitChange, splitNodeIds,
  setHoverCell, beginPublish, endPublish,
} from '../splitSession'

describe('splitSession 会话', () => {
  it('进入/退出：默认全选；重进同节点幂等', () => {
    beginSplit('n1', 3, 3)
    expect(isSplitting('n1')).toBe(true)
    expect(splitState('n1')?.selected.size).toBe(9)
    beginSplit('n1', 3, 3)
    expect(splitState('n1')?.selected.size).toBe(9)
    endSplit('n1')
    expect(isSplitting('n1')).toBe(false)
    endSplit('n1') // 幂等
  })

  it('勾/取消一格：toggleCell 在勾选集里增减', () => {
    beginSplit('n2', 2, 2)
    toggleCell('n2', 1)
    expect(splitState('n2')?.selected.has(1)).toBe(false)
    toggleCell('n2', 1)
    expect(splitState('n2')?.selected.has(1)).toBe(true)
    // 越界安全 no-op
    toggleCell('n2', 99)
    expect(splitState('n2')?.selected.size).toBe(4)
    endSplit('n2')
  })

  it('会话变化通知：进入报 active=true、退出报 active=false（watch 下一拍触发）', async () => {
    const seen: Array<{ id: string; active: boolean }> = []
    const off = onSplitChange((id, active) => seen.push({ id, active }))
    beginSplit('n3', 2, 2)
    await Promise.resolve() // watch 的回调在微任务里 flush
    endSplit('n3')
    await Promise.resolve()
    expect(seen).toEqual([{ id: 'n3', active: true }, { id: 'n3', active: false }])
    off()
  })

  it('splitNodeIds：快照返回当前全部会话', () => {
    endSplit('n1')
    endSplit('n2')
    beginSplit('n4', 1, 2)
    beginSplit('n5', 2, 1)
    expect(splitNodeIds().sort()).toEqual(['n4', 'n5'])
    endSplit('n4')
    endSplit('n5')
    expect(splitNodeIds()).toEqual([])
  })

  it('setHoverCell：合法索引写入、越界清空、无会话 no-op', () => {
    beginSplit('n6', 2, 2)
    setHoverCell('n6', 3)
    expect(splitState('n6')?.hover).toBe(3)
    setHoverCell('n6', 99)
    expect(splitState('n6')?.hover).toBe(-1)
    setHoverCell('missing', 1)
    endSplit('n6')
  })

  it('beginPublish/endPublish：锁防重入', () => {
    beginSplit('n7', 2, 2)
    expect(beginPublish('n7')).toBe(true)
    expect(beginPublish('n7')).toBe(false)
    endPublish('n7')
    expect(beginPublish('n7')).toBe(true)
    endPublish('n7')
    endSplit('n7')
  })
})
