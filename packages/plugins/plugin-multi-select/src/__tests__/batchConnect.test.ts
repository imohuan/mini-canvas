/**
 * 批量连线的纯逻辑（用户要求：多选后左右两个端口，拖到节点上把选中的节点一起连过去，参考 v1）。
 *
 * 这块唯一有分支的地方就是"往哪个方向连、连哪些节点"，所以单测全压在 planBatchEdges 上：
 * 方向（左右对称）、排除自己、空选中/空目标。
 */
import { describe, it, expect } from 'vitest'
import {
  planBatchEdges,
  planBatchApply,
  summarizeBatchApply,
  tempEdgeHandles,
  shouldFrameFollowDrag,
  isHitOwnBatchPort,
  buildBatchGuideLines,
  markGuideLines,
  toNodeRects,
} from '../batchConnect'
import { resolveFeedback, DEFAULT_SNAP_ZONE_CONFIG } from '@mini-canvas/canvas-render'

describe('buildBatchGuideLines —— 每个选中节点各一条临时线（用户明确要的效果）', () => {
  const rects = [
    { id: 'a', x: 0, y: 0, w: 100, h: 80 },
    { id: 'b', x: 200, y: 100, w: 100, h: 80 },
  ]

  it('右侧(source)拖出：每节点一条、起点=该节点右缘中点、方向=right', () => {
    const lines = buildBatchGuideLines('source', ['a', 'b'], rects, { x: 500, y: 300 })
    expect(lines).toHaveLength(2)
    expect(lines[0]).toEqual({
      nodeId: 'a',
      from: { x: 100, y: 40 },
      to: { x: 500, y: 300 },
      fromPosition: 'right',
    })
    expect(lines[1].from).toEqual({ x: 300, y: 140 })
    expect(lines[1].fromPosition).toBe('right')
  })

  it('左侧(target)拖出：起点=该节点左缘中点、方向=left', () => {
    const lines = buildBatchGuideLines('target', ['a'], rects, { x: 500, y: 300 })
    expect(lines[0].from).toEqual({ x: 0, y: 40 })
    expect(lines[0].fromPosition).toBe('left')
  })

  it('吸附到目标端口 → 所有线的终点都指向该锚点（而不是各自指向鼠标）', () => {
    const snap = { x: 220, y: 140 }
    const lines = buildBatchGuideLines('source', ['a', 'b'], rects, { x: 500, y: 300 }, snap)
    expect(lines.every((l) => l.to === snap)).toBe(true)
  })

  it('选中集里有拿不到矩形的节点 → 跳过它（不瞎猜位置）', () => {
    const lines = buildBatchGuideLines('source', ['a', 'ghost'], rects, { x: 1, y: 1 })
    expect(lines).toHaveLength(1)
    expect(lines[0].nodeId).toBe('a')
  })

  it('空选中集 → 无线', () => {
    expect(buildBatchGuideLines('source', [], rects, { x: 1, y: 1 })).toEqual([])
  })
})

describe('shouldFrameFollowDrag —— 拖未选中的节点时框不能跟着动（用户报的 bug）', () => {
  it('拖的节点在选中集里 → 框跟随（整组拖动/拖选中成员）', () => {
    expect(shouldFrameFollowDrag('a', new Set(['a', 'b']))).toBe(true)
  })

  it('拖的节点不在选中集里 → 框不动（这就是"拖未选中节点选框也在移动"的修复）', () => {
    expect(shouldFrameFollowDrag('c', new Set(['a', 'b']))).toBe(false)
  })

  it('没有选中集 → 不跟随', () => {
    expect(shouldFrameFollowDrag('a', new Set())).toBe(false)
  })
})

describe('isHitOwnBatchPort —— 端口的按下不能被"整组平移"抢走（用户报的 bug）', () => {
  it('命中本插件端口槽 / 端口本身 → 让给端口', () => {
    expect(isHitOwnBatchPort({ batchSlot: true, movingHandle: false })).toBe(true)
    expect(isHitOwnBatchPort({ batchSlot: false, movingHandle: true })).toBe(true)
    expect(isHitOwnBatchPort({ batchSlot: true, movingHandle: true })).toBe(true)
  })

  it('没命中端口 → 交给整组平移（框内空白拖动照旧）', () => {
    expect(isHitOwnBatchPort({ batchSlot: false, movingHandle: false })).toBe(false)
  })
})

describe('planBatchEdges —— 从选中集展开成一批边', () => {
  it('右侧(source)：选中节点当源，连到落点目标的输入口', () => {
    const specs = planBatchEdges('source', ['a', 'b'], 'target1')
    expect(specs).toEqual([
      { source: 'a', target: 'target1', sourceHandle: 'source', targetHandle: 'target' },
      { source: 'b', target: 'target1', sourceHandle: 'source', targetHandle: 'target' },
    ])
  })

  it('左侧(target)：选中节点当目标，从落点节点的输出口连进来（方向与右侧相反）', () => {
    const specs = planBatchEdges('target', ['a', 'b'], 'src1')
    expect(specs).toEqual([
      { source: 'src1', target: 'a', sourceHandle: 'source', targetHandle: 'target' },
      { source: 'src1', target: 'b', sourceHandle: 'source', targetHandle: 'target' },
    ])
  })

  it('左右两侧都产出 canonical 边（source 端恒为输出口）', () => {
    for (const side of ['source', 'target'] as const) {
      for (const s of planBatchEdges(side, ['a'], 'x')) {
        expect(s.sourceHandle).toBe('source')
        expect(s.targetHandle).toBe('target')
      }
    }
  })

  it('目标本身在选中集里 → 跳过它（不自连）', () => {
    const specs = planBatchEdges('source', ['a', 'b'], 'b')
    expect(specs.map((s) => s.source)).toEqual(['a'])
  })

  it('落空白（没目标）→ 什么都不建', () => {
    expect(planBatchEdges('source', ['a', 'b'], null)).toEqual([])
    expect(planBatchEdges('source', ['a', 'b'], undefined)).toEqual([])
    expect(planBatchEdges('target', ['a'], '')).toEqual([])
  })

  it('选中集为空 → 什么都不建', () => {
    expect(planBatchEdges('source', [], 'x')).toEqual([])
  })

  it('选中的每个节点各出一条（含只有一个的场景）', () => {
    expect(planBatchEdges('source', ['only'], 'x')).toHaveLength(1)
    expect(planBatchEdges('source', ['a', 'b', 'c'], 'x')).toHaveLength(3)
  })
})

describe('summarizeBatchApply —— 批量落边的分类计数', () => {
  const spec = (source: string): { source: string; target: string; sourceHandle: 'source'; targetHandle: 'target' } => ({
    source,
    target: 't',
    sourceHandle: 'source',
    targetHandle: 'target',
  })

  it('三类分别计数：新建 / 已存在（幂等跳过）/ 被拒', () => {
    const r = summarizeBatchApply(
      [spec('a'), spec('b'), spec('c')],
      (s) => s.source === 'b',
      (s) => s.source !== 'c',
    )
    expect(r).toEqual({ created: 1, idempotent: 1, rejected: 1 })
  })

  it('已存在的优先算幂等（不再去校验）', () => {
    let validated = 0
    const r = summarizeBatchApply([spec('a')], () => true, () => {
      validated += 1
      return true
    })
    expect(r.idempotent).toBe(1)
    expect(validated).toBe(0)
  })

  it('空输入 → 全零', () => {
    expect(summarizeBatchApply([], () => false, () => true)).toEqual({ created: 0, idempotent: 0, rejected: 0 })
  })
})

describe('tempEdgeHandles —— 拖线临时端点侧', () => {
  it('右侧拖出：源口连出、目标口接收', () => {
    expect(tempEdgeHandles('source')).toEqual({ sourceHandle: 'source', targetHandle: 'target' })
  })

  it('左侧拖出：方向相反（从对方输入口反向拖）', () => {
    expect(tempEdgeHandles('target')).toEqual({ sourceHandle: 'target', targetHandle: 'source' })
  })
})

/**
 * 批量落边的「部分支持」语义（用户提出的问题）。
 *
 * 用户原话：多个节点拖拽一条连接线，目标节点该如何判断是否可以连接？
 * 比如只要部分连接线支持就可以连接（连接时也只允许支持的连接线进行连接），
 * 不能一股脑地直接建立连接线。
 *
 * 对「目标能不能连」这件事，批量连线有两种极端做法，都不对：
 * - **全都要**：只要有一个源不合法就整批不连 → 用户明明拖了 3 个、其中 2 个合法，却一条都建不出来；
 * - **全不管**：一股脑全建 → 非法边绕过内核规则进图。
 *
 * 正确语义（本文件的断言）：
 * 1. **目标可连** = 至少一个源能连得上（部分支持就该亮「可连」，而不是因为个别连不上就整体判死）；
 * 2. **落边只落合法的**（逐条校验），不合法的静默跳过；
 * 3. **目标输入口容量必须在这一批内部一起算** —— 这是最容易错的地方：容量 1 的目标口，
 *    3 个合法源去连只能落 1 条，不能因为「每条单独校验都合法」就落 3 条。
 */
describe('planBatchApply —— 部分支持：只落合法边 + 容量在批内累计', () => {
  const spec = (source: string) => ({
    source,
    target: 't',
    sourceHandle: 'source' as const,
    targetHandle: 'target' as const,
  })

  it('全部合法 → 全部落', () => {
    const specs = [spec('a'), spec('b')]
    const r = planBatchApply(specs, { isDuplicate: () => false, canConnect: () => true })
    expect(r.build.map((s) => s.source)).toEqual(['a', 'b'])
    expect(r.rejected).toEqual([])
    expect(r.duplicated).toEqual([])
  })

  it('部分合法 → 只落合法的那几条（不合法的被拒，不是整批作废）', () => {
    const specs = [spec('a'), spec('b'), spec('c')]
    const r = planBatchApply(specs, {
      isDuplicate: () => false,
      canConnect: (s) => s.source !== 'b',
    })
    expect(r.build.map((s) => s.source)).toEqual(['a', 'c'])
    expect(r.rejected.map((s) => s.source)).toEqual(['b'])
  })

  it('已存在的边算 duplicate、直接从待建里摘掉（不占容量）', () => {
    const specs = [spec('a'), spec('b')]
    const r = planBatchApply(specs, { isDuplicate: (s) => s.source === 'a', canConnect: () => true })
    expect(r.build.map((s) => s.source)).toEqual(['b'])
    expect(r.duplicated.map((s) => s.source)).toEqual(['a'])
  })

  it('全部不合法 → 一条都不落（目标该显示不可连）', () => {
    const r = planBatchApply([spec('a'), spec('b')], { isDuplicate: () => false, canConnect: () => false })
    expect(r.build).toEqual([])
    expect(r.rejected).toHaveLength(2)
  })

  it('回归（最容易错的一条）：目标口容量 1、两个源各自都合法 → 只落第一条', () => {
    // canConnect 的第二个入参是「这一批里已经决定要落的边」——调用方据此把容量算进批内。
    // 这正是修前的漏洞：每条边各查一次已有边（都为空），于是两条都判合法、一起落进容量只有 1 的口。
    const specs = [spec('a'), spec('b')]
    const r = planBatchApply(specs, {
      isDuplicate: () => false,
      canConnect: (_s, alreadyPlanned) => alreadyPlanned.length < 1,
    })
    expect(r.build.map((s) => s.source)).toEqual(['a'])
    expect(r.rejected.map((s) => s.source)).toEqual(['b'])
  })

  it('空输入 → 全空', () => {
    expect(planBatchApply([], { isDuplicate: () => false, canConnect: () => true })).toEqual({
      build: [],
      rejected: [],
      duplicated: [],
    })
  })
})

/**
 * 临时线要能看出「哪几条会真的连上」。
 *
 * 用户的要求是「只允许支持的连接线进行连接」，那么拖拽过程中就该看得见：
 * 选中 3 个节点拖过去，其中 2 个连得上、1 个连不上（类型不符 / 目标口已占），
 * 这 3 条线现在是长得一模一样的 —— 用户无从判断松手会发生什么。
 */
describe('markGuideLines —— 每条临时线带上「会不会连上」', () => {
  const rects = [
    { id: 'a', x: 0, y: 0, w: 100, h: 80 },
    { id: 'b', x: 200, y: 0, w: 100, h: 80 },
  ]
  const lines = () => buildBatchGuideLines('source', ['a', 'b'], rects, { x: 900, y: 40 })
  const spec = (source: string) => ({
    source,
    target: 't',
    sourceHandle: 'source' as const,
    targetHandle: 'target' as const,
  })

  it('source 侧：nodeId 落在 build 里 → 会连上；落在 rejected 里 → 不会', () => {
    const plan = planBatchApply([spec('a'), spec('b')], {
      isDuplicate: () => false,
      canConnect: (s) => s.source !== 'b',
    })
    const marked = markGuideLines(lines(), plan, 'source')
    expect(marked[0].willConnect).toBe(true)
    expect(marked[1].willConnect).toBe(false)
  })

  it('target 侧：选中节点是边的 target，同样能对上号', () => {
    const tLines = buildBatchGuideLines('target', ['a', 'b'], rects, { x: -100, y: 40 })
    // 左侧拖出时选中节点是边的 **target**（源是那个落点节点）—— 用 planBatchEdges 真实构造，
    // 免得手写 specs 时把方向写反、测试反而"证明"了一个错的语义。
    const tSpecs = planBatchEdges('target', ['a', 'b'], 'src')
    const plan = planBatchApply(tSpecs, {
      isDuplicate: () => false,
      canConnect: (s) => s.target !== 'b',
    })
    const marked = markGuideLines(tLines, plan, 'target')
    expect(marked[0].willConnect).toBe(true)
    expect(marked[1].willConnect).toBe(false)
  })

  it('已存在（duplicate）的边也算「会连上」——它本来就在，用户看到的是"这条已经有了"', () => {
    const plan = planBatchApply([spec('a')], { isDuplicate: () => true, canConnect: () => true })
    const marked = markGuideLines([lines()[0]], plan, 'source')
    expect(marked[0].willConnect).toBe(true)
  })

  it('不改动入参行的其它字段（起点/终点/方向原样）', () => {
    const before = lines()
    const marked = markGuideLines(before, { build: [], rejected: [], duplicated: [] }, 'source')
    expect(marked.map((l) => l.from)).toEqual(before.map((l) => l.from))
    expect(marked.map((l) => l.fromPosition)).toEqual(before.map((l) => l.fromPosition))
  })
})

/**
 * 批量连线的**反馈几何**（用户报的缺陷：拖到目标节点上时没有 3D 动效）。
 *
 * 真因不是反馈开关没开，而是喂给渲染层的矩形**字段名写错**：nodeLayout 给的是 { x, y, w, h }，
 * 而 resolveFeedback 要的是 { x, y, width, height }。少了转换后 width/height 恒为 undefined，
 * 吸附带 / body 命中算出来全是 NaN → hover 永远是 null → connectionState.hoverNode 永远写不进去
 * → BaseNode 的 3D 倾斜（showConnectFeedback 依赖 isConnectionValidTarget）永远不亮。
 *
 * 这一条直接拿**真实 resolveFeedback** 断言转换后的矩形确实能命中目标，
 * 而不是只断言某个字段名 —— 只断言字段名的话，转换函数写反也算过。
 */
describe('toNodeRects —— 反馈几何的矩形必须能被 resolveFeedback 命中（3D 反馈的前提）', () => {
  const target = { id: 't', x: 600, y: 200, w: 200, h: 120 }

  it('把 nodeLayout 的 w/h 转成 NodeRect 的 width/height', () => {
    expect(toNodeRects([target])).toEqual([
      { id: 't', x: 600, y: 200, width: 200, height: 120 },
    ])
  })

  it('转换后的矩形落在目标卡片上 → hover 命中且 valid（这正是 3D 反馈的触发条件）', () => {
    const r = resolveFeedback({
      sourceId: 'src',
      sourceHandle: 'source',
      nodeRects: toNodeRects([target]),
      flowPoint: { x: 700, y: 260 }, // 目标卡片正中心
      handleRadius: 10,
      config: DEFAULT_SNAP_ZONE_CONFIG,
      validate: () => '',
    })
    expect(r.hover).not.toBeNull()
    expect(r.hover?.nodeId).toBe('t')
    expect(r.hover?.status).toBe('valid')
  })

  it('回归对照：直接喂 { w, h }（字段名不对）→ 永远命中不了，hover 恒为 null', () => {
    const r = resolveFeedback({
      sourceId: 'src',
      sourceHandle: 'source',
      // 故意不转换：模拟修前的写法
      nodeRects: [target] as unknown as ReturnType<typeof toNodeRects>,
      flowPoint: { x: 700, y: 260 },
      handleRadius: 10,
      config: DEFAULT_SNAP_ZONE_CONFIG,
      validate: () => '',
    })
    expect(r.hover).toBeNull()
  })
})
