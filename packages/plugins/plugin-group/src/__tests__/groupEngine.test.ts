import { describe, expect, it } from 'vitest'
import {
  computeGroupBounds,
  toRelativePosition,
  toAbsolutePosition,
  rectIntersectsGroup,
  resolveGroupChanges,
  createGroupId,
  selectDownloadableGroupChildren,
  type GroupPadding,
} from '../groupEngine'

/** 默认 padding（对齐实现常量；测试锁"改 padding 不能悄悄改视觉"） */
const DEFAULT_PADDING: GroupPadding = { left: 30, right: 30, top: 40, bottom: 30 }

describe('computeGroupBounds 包围盒', () => {
  it('两个节点求最小包围盒 + padding', () => {
    const b = computeGroupBounds(
      [
        { id: 'a', x: 100, y: 100, w: 100, h: 80 },
        { id: 'b', x: 300, y: 200, w: 120, h: 60 },
      ],
      { padding: DEFAULT_PADDING, minW: 200, minH: 150 },
    )
    expect(b).toEqual({ x: 70, y: 60, w: 380, h: 230 })
  })

  it('过小内容受最小尺寸约束', () => {
    const b = computeGroupBounds([{ id: 'a', x: 0, y: 0, w: 20, h: 20 }], { padding: DEFAULT_PADDING, minW: 200, minH: 150 })
    expect(b!.w).toBe(200)
    expect(b!.h).toBe(150)
  })

  it('非对称 padding：各边独立收放', () => {
    // 内容包围盒 = (100,100)-(420,260)。left 10 / top 5 → 组左上 (90,95)；
    // right 20 → 宽 = 内容宽 320 + 10 + 20 = 350；bottom 15 → 高 = 内容高 160 + 5 + 15 = 180。
    const b = computeGroupBounds(
      [
        { id: 'a', x: 100, y: 100, w: 100, h: 80 },
        { id: 'b', x: 300, y: 200, w: 120, h: 60 },
      ],
      { padding: { left: 10, right: 20, top: 5, bottom: 15 } },
    )
    expect(b).toEqual({ x: 90, y: 95, w: 350, h: 180 })
  })

  it('负数/非法 padding 逐边回落默认', () => {
    const b = computeGroupBounds(
      [{ id: 'a', x: 0, y: 0, w: 100, h: 100 }],
      { padding: { left: -5, right: NaN, top: Infinity, bottom: -3 } },
    )
    // left/right/top/bottom 全部非法 → 逐边回落默认 30/30/40/30。
    // 内容 100x100 + padding 60x70 = 160x170，但宽被 minW=200 抬底。
    expect(b).toEqual({ x: -30, y: -40, w: 200, h: 170 })
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

  it('嵌套命中：节点与外层组、内层组都相交 → 命中内层组（深度深 = 渲染 z 高），即使内层面积更大', () => {
    // 外层组 gOut（depth0，小面积）与 内层组 gIn（depth1，大面积）几何都含 n1
    const nested = [
      { id: 'gOut', x: 0, y: 0, w: 300, h: 300, depth: 0 },
      { id: 'gIn', x: -100, y: -100, w: 900, h: 900, depth: 1 },
    ]
    const changes = resolveGroupChanges(
      [{ id: 'n1', rect: { id: 'n1', x: 50, y: 50, w: 40, h: 40 } }],
      nested,
    )
    expect(changes).toEqual([{ nodeId: 'n1', joinGroupId: 'gIn' }])
  })

  it('转组：父内节点拖出父、落到另一顶层组 → leave 父 + join 新组', () => {
    const nested = [
      { id: 'parent', x: 0, y: 0, w: 400, h: 400, depth: 0 },
      { id: 'other', x: 500, y: 0, w: 300, h: 300, depth: 0 },
    ]
    const changes = resolveGroupChanges(
      [{ id: 'n1', rect: { id: 'n1', x: 550, y: 100, w: 40, h: 40 }, currentParentId: 'parent' }],
      nested,
    )
    expect(changes).toEqual([
      { nodeId: 'n1', leaveGroupId: 'parent' },
      { nodeId: 'n1', joinGroupId: 'other' },
    ])
  })

  it('转入子组：外层组成员拖到外层组内的第一层组（depth1）上 → 直接转入该组（不 leave 外层）', () => {
    // 用户实测场景：外层组 ⊃ 第一层组(depth1)，外层组的成员拖到第一层组上应加入它
    const nested = [
      { id: 'outer', x: 0, y: 0, w: 800, h: 600, depth: 0 },
      { id: 'inner', x: 300, y: 100, w: 400, h: 200, depth: 1 },
    ]
    const changes = resolveGroupChanges(
      [{ id: 'n1', rect: { id: 'n1', x: 400, y: 150, w: 60, h: 60 }, currentParentId: 'outer' }],
      nested,
    )
    // n1 仍在 outer 内（不 leave），但命中 depth1 的 inner（depth 1 > 父 0）→ 转入 inner
    expect(changes).toEqual([{ nodeId: 'n1', joinGroupId: 'inner' }])
  })

  it('外层组成员在外层组内移动（不碰任何子组）→ 无动作', () => {
    const nested = [
      { id: 'outer', x: 0, y: 0, w: 800, h: 600, depth: 0 },
      { id: 'inner', x: 300, y: 100, w: 400, h: 200, depth: 1 },
    ]
    const changes = resolveGroupChanges(
      [{ id: 'n1', rect: { id: 'n1', x: 50, y: 50, w: 60, h: 60 }, currentParentId: 'outer' }],
      nested,
    )
    expect(changes).toEqual([])
  })
})

describe('createGroupId', () => {
  it('前缀 group- + 时间戳 + 序号（同一毫秒连续打组不撞 id）', () => {
    const a = createGroupId(1234)
    const b = createGroupId(1234)
    expect(a).toMatch(/^group-1234-\d+$/)
    expect(b).not.toBe(a)
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
