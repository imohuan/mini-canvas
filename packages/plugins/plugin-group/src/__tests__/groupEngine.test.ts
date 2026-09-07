import { describe, expect, it } from 'vitest'
import {
  computeGroupBounds,
  toRelativePosition,
  toAbsolutePosition,
  rectIntersectsGroup,
  resolveGroupChanges,
  createGroupId,
  selectDownloadableGroupChildren,
} from '../groupEngine'

describe('computeGroupBounds 包围盒', () => {
  it('两个节点求最小包围盒 + padding', () => {
    const b = computeGroupBounds(
      [
        { id: 'a', x: 100, y: 100, w: 100, h: 80 },
        { id: 'b', x: 300, y: 200, w: 120, h: 60 },
      ],
      { padding: 30, paddingTop: 10, minW: 200, minH: 150 },
    )
    expect(b).toEqual({ x: 70, y: 60, w: 380, h: 230 })
  })

  it('过小内容受最小尺寸约束', () => {
    const b = computeGroupBounds([{ id: 'a', x: 0, y: 0, w: 20, h: 20 }], { padding: 30, paddingTop: 10, minW: 200, minH: 150 })
    expect(b!.w).toBe(200)
    expect(b!.h).toBe(150)
  })

  it('空输入返回 null', () => {
    expect(computeGroupBounds([])).toBeNull()
  })
})

describe('相对/绝对坐标换算', () => {
  const bounds = { x: 70, y: 60, w: 380, h: 230 }
  it('绝对→相对', () => {
    expect(toRelativePosition(100, 100, bounds)).toEqual({ x: 30, y: 40 })
  })
  it('相对→绝对', () => {
    expect(toAbsolutePosition(30, 40, bounds)).toEqual({ x: 100, y: 100 })
  })
})

describe('rectIntersectsGroup 重叠判定', () => {
  const group = { id: 'g', x: 0, y: 0, w: 200, h: 150 }
  it('完全在内相交', () => {
    expect(rectIntersectsGroup({ id: 'n', x: 20, y: 20, w: 40, h: 40 }, group)).toBe(true)
  })
  it('边缘相切不算', () => {
    expect(rectIntersectsGroup({ id: 'n', x: 200, y: 0, w: 40, h: 40 }, group)).toBe(false)
  })
  it('完全不搭不算', () => {
    expect(rectIntersectsGroup({ id: 'n', x: 300, y: 300, w: 40, h: 40 }, group)).toBe(false)
  })
  it('仅小部分重叠（ratio=0 仍算）', () => {
    expect(rectIntersectsGroup({ id: 'n', x: 190, y: 140, w: 100, h: 100 }, group)).toBe(true)
  })
})

describe('resolveGroupChanges 拖拽归组决策', () => {
  const groups = [{ id: 'g1', x: 0, y: 0, w: 200, h: 150 }]
  it('顶层节点拖入组内 → join', () => {
    const changes = resolveGroupChanges(
      [{ id: 'n1', rect: { id: 'n1', x: 50, y: 50, w: 40, h: 40 } }],
      groups,
    )
    expect(changes).toEqual([{ nodeId: 'n1', joinGroupId: 'g1' }])
  })
  it('组内节点完全离开 → leave', () => {
    const changes = resolveGroupChanges(
      [{ id: 'n1', rect: { id: 'n1', x: 500, y: 500, w: 40, h: 40 }, currentParentId: 'g1' }],
      groups,
    )
    expect(changes).toEqual([{ nodeId: 'n1', leaveGroupId: 'g1' }])
  })
  it('无分组时无动作', () => {
    expect(resolveGroupChanges([{ id: 'n1', rect: { id: 'n1', x: 0, y: 0, w: 10, h: 10 } }], [])).toEqual([])
  })
})

describe('createGroupId', () => {
  it('前缀 group- + 时间戳', () => {
    expect(createGroupId(1234)).toBe('group-1234')
  })
})

describe('selectDownloadableGroupChildren', () => {
  it('只保留组内有下载命令的子节点', () => {
    const nodes = [
      { id: 'g', type: 'group' },
      { id: 'i', type: 'image', parentId: 'g' },
      { id: 't', type: 'text', parentId: 'g' },
      { id: 'o', type: 'image' },
    ]
    const has = (id: string) => id === 'image.download'
    const out = selectDownloadableGroupChildren(nodes, 'g', has)
    expect(out).toEqual([{ node: nodes[1], commandId: 'image.download' }])
  })
})
