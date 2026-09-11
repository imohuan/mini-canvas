/**
 * exportGeometry 单测：导出范围/裁剪计划/背景点阵/输出尺寸守卫等纯逻辑（无 DOM，Node 可跑）。
 * 期望值全部手算（独立来源），不复用被测代码的算法。
 */
import { describe, it, expect } from 'vitest'
import {
  unionRect,
  contentBounds,
  expandRect,
  intersects,
  roundRectOutward,
  planTiles,
  tileNodeIds,
  tileEdgeIds,
  fitScale,
  clampScaleForPane,
  keepExportElement,
  backgroundGridStep,
  MAX_BG_DOTS,
  normalizeScale,
  outputSize,
  exceedsMaxDimension,
  visibleRectInFlow,
  planExport,
  EXPORT_SCALE_DEFAULT,
  EXPORT_SCALE_MIN,
  EXPORT_SCALE_MAX,
  MAX_EXPORT_DIMENSION,
  NODE_TILE_MARGIN,
  EDGE_TILE_MARGIN,
  type Rect,
  type NodeRect,
} from '../exportGeometry'

describe('unionRect', () => {
  it('任一 null → 返回另一个；两个 null → null', () => {
    const a: Rect = { x: 1, y: 2, w: 3, h: 4 }
    expect(unionRect(a, null)).toEqual(a)
    expect(unionRect(null, a)).toEqual(a)
    expect(unionRect(null, null)).toBeNull()
  })
  it('两个矩形取外接包围盒', () => {
    expect(unionRect({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toEqual({ x: 0, y: 0, w: 15, h: 15 })
  })
  it('不相交矩形也取外接盒', () => {
    expect(unionRect({ x: 100, y: 200, w: 10, h: 10 }, { x: 0, y: 0, w: 20, h: 30 })).toEqual({ x: 0, y: 0, w: 110, h: 210 })
  })
})

describe('contentBounds', () => {
  it('空数组 → null', () => {
    expect(contentBounds([])).toBeNull()
  })
  it('单矩形 → 自身', () => {
    expect(contentBounds([{ x: 7, y: 8, w: 9, h: 10 }])).toEqual({ x: 7, y: 8, w: 9, h: 10 })
  })
  it('多矩形 → 外接包围盒', () => {
    expect(
      contentBounds([
        { x: 120, y: 40, w: 100, h: 60 },
        { x: 20, y: 200, w: 50, h: 50 },
        { x: 60, y: 30, w: 10, h: 10 },
      ]),
    ).toEqual({ x: 20, y: 30, w: 200, h: 220 })
  })
})

describe('expandRect', () => {
  it('四边同量外扩', () => {
    expect(expandRect({ x: 10, y: 20, w: 100, h: 50 }, 4)).toEqual({ x: 6, y: 16, w: 108, h: 58 })
  })
  it('pad=0 原样', () => {
    expect(expandRect({ x: 0, y: 0, w: 10, h: 10 }, 0)).toEqual({ x: 0, y: 0, w: 10, h: 10 })
  })
  it('负数 pad 视作 0（不收缩）', () => {
    expect(expandRect({ x: 0, y: 0, w: 10, h: 10 }, -5)).toEqual({ x: 0, y: 0, w: 10, h: 10 })
  })
  it('非有限数视作 0', () => {
    expect(expandRect({ x: 0, y: 0, w: 10, h: 10 }, Number.NaN)).toEqual({ x: 0, y: 0, w: 10, h: 10 })
  })
})

describe('visibleRectInFlow', () => {
  it('zoom=1 平移 0：可视区 = pane 尺寸，原点在 0,0', () => {
    expect(visibleRectInFlow({ x: 0, y: 0, zoom: 1 }, 800, 600)).toEqual({ x: 0, y: 0, w: 800, h: 600 })
  })
  it('平移后：可视区左上角 = -平移/缩放', () => {
    expect(visibleRectInFlow({ x: -200, y: -100, zoom: 2 }, 800, 600)).toEqual({ x: 100, y: 50, w: 400, h: 300 })
  })
  it('zoom 非法（0/负/NaN）按 1 处理，不产生 NaN', () => {
    expect(visibleRectInFlow({ x: -10, y: -20, zoom: 0 }, 100, 50)).toEqual({ x: 10, y: 20, w: 100, h: 50 })
    expect(visibleRectInFlow({ x: -10, y: -20, zoom: Number.NaN }, 100, 50)).toEqual({ x: 10, y: 20, w: 100, h: 50 })
  })
  it('pane 尺寸为 0 → 空矩形（调用方当"无内容"处理）', () => {
    expect(visibleRectInFlow({ x: 0, y: 0, zoom: 1 }, 0, 0)).toBeNull()
  })
})

describe('intersects', () => {
  const region: Rect = { x: 0, y: 0, w: 100, h: 100 }
  it('重叠 / 包含 → true', () => {
    expect(intersects({ x: 10, y: 10, w: 10, h: 10 }, region)).toBe(true)
    expect(intersects({ x: -50, y: 50, w: 80, h: 20 }, region)).toBe(true)
  })
  it('完全在外 → false', () => {
    expect(intersects({ x: 200, y: 200, w: 10, h: 10 }, region)).toBe(false)
  })
  it('仅贴边（不重叠）→ false', () => {
    expect(intersects({ x: 100, y: 0, w: 10, h: 10 }, region)).toBe(false)
  })
  it('margin 把边界外一小圈算进来', () => {
    expect(intersects({ x: 104, y: 0, w: 10, h: 10 }, region, 8)).toBe(true)
    expect(intersects({ x: 120, y: 0, w: 10, h: 10 }, region, 8)).toBe(false)
  })
})

describe('roundRectOutward', () => {
  it('左上 floor、右下 ceil（只向外长，不裁内容）', () => {
    expect(roundRectOutward({ x: 10.2, y: 20.7, w: 30.1, h: 40.1 })).toEqual({ x: 10, y: 20, w: 31, h: 41 })
  })
  it('已是整数 → 原样', () => {
    expect(roundRectOutward({ x: 1, y: 2, w: 3, h: 4 })).toEqual({ x: 1, y: 2, w: 3, h: 4 })
  })
  it('负坐标也向外取整', () => {
    expect(roundRectOutward({ x: -10.5, y: -0.2, w: 5, h: 5 })).toEqual({ x: -11, y: -1, w: 6, h: 6 })
  })
})

describe('planTiles', () => {
  it('范围小于块 → 单块 = 范围本身', () => {
    expect(planTiles({ x: 0, y: 0, w: 100, h: 80 }, 800, 600)).toEqual([{ x: 0, y: 0, w: 100, h: 80 }])
  })
  it('正好整除 → 不多出空行空列', () => {
    // 200×200 / 100×100 = 2×2 块；若少写一行就会漏掉半张图
    expect(planTiles({ x: 0, y: 0, w: 200, h: 200 }, 100, 100)).toEqual([
      { x: 0, y: 0, w: 100, h: 100 },
      { x: 100, y: 0, w: 100, h: 100 },
      { x: 0, y: 100, w: 100, h: 100 },
      { x: 100, y: 100, w: 100, h: 100 },
    ])
  })
  it('不整除 → 末行末列截断到范围边界（行优先，不重叠）', () => {
    expect(planTiles({ x: 10, y: 20, w: 150, h: 120 }, 100, 100)).toEqual([
      { x: 10, y: 20, w: 100, h: 100 },
      { x: 110, y: 20, w: 50, h: 100 },
      { x: 10, y: 120, w: 100, h: 20 },
      { x: 110, y: 120, w: 50, h: 20 },
    ])
  })
  it('空格子/非正块尺寸 → 不产生块', () => {
    expect(planTiles({ x: 0, y: 0, w: 0, h: 10 }, 100, 100)).toEqual([])
    expect(planTiles({ x: 0, y: 0, w: 10, h: 10 }, 0, 100)).toEqual([{ x: 0, y: 0, w: 10, h: 10 }])
  })
  it('块覆盖范围且总块面积 = 范围面积（无重叠无缺口）', () => {
    const rect = { x: -7, y: 3, w: 333, h: 217 }
    const tiles = planTiles(rect, 100, 100)
    const area = tiles.reduce((s, t) => s + t.w * t.h, 0)
    expect(area).toBe(rect.w * rect.h)
  })
})

describe('tileNodeIds（跨块节点必须两块都留）', () => {
  const nodes: NodeRect[] = [
    { id: 'A', x: 0, y: 0, w: 100, h: 100 },
    { id: 'B', x: 200, y: 0, w: 100, h: 100 },
    { id: '跨', x: 90, y: 0, w: 120, h: 100 }, // 横跨 x=100 的块边界
  ]
  const allowed = new Set(['A', 'B', '跨'])

  it('只保留与本块相交（含框外余量）的节点', () => {
    // 左块(0..100)：A 贴边、跨 压边界 → 都留；B(200..300) 离得远(>24) → 不留
    expect([...tileNodeIds(nodes, allowed, { x: 0, y: 0, w: 100, h: 100 })].sort()).toEqual(['A', '跨'])
    // 右块(100..200)：A 在边界左侧 0 距离内（阴影会溢进来）故也带上；B 与本块重叠 → 留
    expect([...tileNodeIds(nodes, allowed, { x: 100, y: 0, w: 100, h: 100 })].sort()).toEqual(['A', 'B', '跨'])
  })
  it('跨块节点在左右两块都保留（否则拼缝处会缺一半）', () => {
    const left = tileNodeIds(nodes, allowed, { x: 0, y: 0, w: 100, h: 100 })
    const right = tileNodeIds(nodes, allowed, { x: 100, y: 0, w: 100, h: 100 })
    expect(left.has('跨')).toBe(true)
    expect(right.has('跨')).toBe(true)
  })
  it('allowed 之外的节点一律不进（选中模式只导选中节点）', () => {
    expect([...tileNodeIds(nodes, new Set(['A']), { x: 0, y: 0, w: 100, h: 100 })].sort()).toEqual(['A'])
  })
  it('余量让"紧贴边界外侧"的节点也算进本块（阴影/光晕不被切）', () => {
    const justOutside: NodeRect[] = [{ id: 'X', x: 100 + NODE_TILE_MARGIN - 2, y: 0, w: 10, h: 10 }]
    expect(tileNodeIds(justOutside, new Set(['X']), { x: 0, y: 0, w: 100, h: 100 }).has('X')).toBe(true)
    const farOutside: NodeRect[] = [{ id: 'Y', x: 100 + NODE_TILE_MARGIN + 50, y: 0, w: 10, h: 10 }]
    expect(tileNodeIds(farOutside, new Set(['Y']), { x: 0, y: 0, w: 100, h: 100 }).has('Y')).toBe(false)
  })
})

describe('tileEdgeIds（长连线要在它经过的每块都保留）', () => {
  const rectById = new Map<string, NodeRect>([
    ['A', { id: 'A', x: 0, y: 0, w: 100, h: 100 }],
    ['C', { id: 'C', x: 900, y: 0, w: 100, h: 100 }],
  ])
  const edges = [
    { id: 'e-AC', source: 'A', target: 'C' }, // 横跨 A→C 的长线
    { id: 'e-AC2', source: 'A', target: 'C' },
  ]
  const allowed = new Set(['e-AC', 'e-AC2'])

  it('长线在它经过的每一块都保留（中间块不会缺线）', () => {
    expect(tileEdgeIds(edges, rectById, allowed, { x: 0, y: 0, w: 200, h: 200 }).has('e-AC')).toBe(true)
    expect(tileEdgeIds(edges, rectById, allowed, { x: 400, y: 0, w: 200, h: 200 }).has('e-AC')).toBe(true)
    expect(tileEdgeIds(edges, rectById, allowed, { x: 800, y: 0, w: 200, h: 200 }).has('e-AC')).toBe(true)
  })
  it('远在天边的块不保留（不做无谓的克隆，节点多也不卡）', () => {
    expect(tileEdgeIds(edges, rectById, allowed, { x: 0, y: 5000, w: 200, h: 200 }).has('e-AC')).toBe(false)
  })
  it('allowed 之外 / 端点缺失的边一律不进', () => {
    expect(tileEdgeIds(edges, rectById, new Set(['e-AC2']), { x: 0, y: 0, w: 200, h: 200 })).toEqual(new Set(['e-AC2']))
    const missing = [{ id: 'e-X', source: 'A', target: '幽灵' }]
    expect(tileEdgeIds(missing, rectById, new Set(['e-X']), { x: 0, y: 0, w: 200, h: 200 }).size).toBe(0)
  })
  it('余量让端点刚好在边界外的线也算进本块（曲线外扩不被切）', () => {
    const near = new Map<string, NodeRect>([
      ['A', { id: 'A', x: 0, y: 0, w: 100, h: 100 }],
      ['C', { id: 'C', x: 100 + EDGE_TILE_MARGIN - 2, y: 0, w: 100, h: 100 }],
    ])
    expect(tileEdgeIds(edges, near, allowed, { x: 0, y: 0, w: 200, h: 200 }).has('e-AC')).toBe(true)
  })
})

describe('fitScale（超大内容的倍数回退）', () => {
  it('常规范围 → 用期望倍数', () => {
    expect(fitScale({ x: 0, y: 0, w: 1000, h: 800 }, 3)).toBe(3)
  })
  it('期望倍数超限 → 自动降到能装下的最大整数倍数', () => {
    // 宽 10000：×2 = 20000 超 16384；×1 = 10000，可行 → 1
    expect(fitScale({ x: 0, y: 0, w: 10000, h: 100 }, 2)).toBe(1)
  })
  it('连 1 倍都超限 → null（调用方报错，不硬拍成糊图）', () => {
    expect(fitScale({ x: 0, y: 0, w: MAX_EXPORT_DIMENSION + 1, h: 10 }, 2)).toBeNull()
  })
})

describe('clampScaleForPane（单块截图尺寸也不能超上限）', () => {
  it('窗口不大 → 倍数照旧', () => {
    expect(clampScaleForPane(3, 1000, 800)).toBe(3)
  })
  it('窗口极大 → 倍数降到单块装得下的最大值', () => {
    // pane 长边 10000 → 16384/10000 = 1，故最多 1 倍
    expect(clampScaleForPane(4, 10000, 800)).toBe(1)
  })
  it('窗口大到 1 倍都装不下 → 返回 <1 的值（调用方据此拒绝导出）', () => {
    expect(clampScaleForPane(2, 20000, 800)).toBeLessThan(1)
  })
})

describe('backgroundGridStep（背景点阵在超大范围自动放宽）', () => {
  it('范围正常 → 用原网格间距', () => {
    expect(backgroundGridStep({ x: 0, y: 0, w: 480, h: 480 }, 24, MAX_BG_DOTS)).toBe(24)
  })
  it('范围极大 → 间距放宽成 24 的整数倍，使点数不超上限', () => {
    const step = backgroundGridStep({ x: 0, y: 0, w: 24000, h: 24000 }, 24, 1000)
    expect(step % 24).toBe(0)
    expect(step).toBeGreaterThan(24)
    // 实际会画的点数：从 0 起、每隔 step 一个、到不超过 w（含端点），即 floor(w/step)+1 个
    const perAxis = Math.floor(24000 / step) + 1
    expect(perAxis * perAxis).toBeLessThanOrEqual(1000)
  })
  it('网格间距非法 → 返回 0（调用方据此跳过点阵，只留底色）', () => {
    expect(backgroundGridStep({ x: 0, y: 0, w: 100, h: 100 }, 0, 100)).toBe(0)
  })
})

describe('keepExportElement（克隆阶段决定留谁）', () => {
  const DEBUG = ['v2-debug-overlay', 'moving-handle-debug']
  const base = (over: Partial<Parameters<typeof keepExportElement>[0]>) => ({
    classes: [] as string[],
    dataId: null as string | null,
    innerEdgeId: null as string | null,
    debugClasses: DEBUG,
    keepNodes: new Set(['A']),
    keepEdges: new Set(['e-AB']),
    ...over,
  })

  it('普通容器（画布/frame/背景）一律保留', () => {
    expect(keepExportElement(base({ classes: ['vue-flow', 'vue-flow__viewport'] }))).toBe(true)
    expect(keepExportElement(base({ classes: ['vue-flow__transformationpane'] }))).toBe(true)
  })
  it('节点按 data-id 取舍', () => {
    expect(keepExportElement(base({ classes: ['vue-flow__node'], dataId: 'A' }))).toBe(true)
    expect(keepExportElement(base({ classes: ['vue-flow__node'], dataId: 'B' }))).toBe(false)
    expect(keepExportElement(base({ classes: ['vue-flow__node'], dataId: null }))).toBe(false)
  })
  it('连线内层 <g> 按 data-id 取舍', () => {
    expect(keepExportElement(base({ classes: ['vue-flow__edge'], dataId: 'e-AB' }))).toBe(true)
    expect(keepExportElement(base({ classes: ['vue-flow__edge'], dataId: 'e-ZZ' }))).toBe(false)
  })
  it('连线外壳 <svg> 按内部 <g> 的 id 取舍（关键坑：html-to-image 不递归过滤 svg）', () => {
    expect(keepExportElement(base({ classes: ['vue-flow__edges'], innerEdgeId: 'e-AB' }))).toBe(true)
    expect(keepExportElement(base({ classes: ['vue-flow__edges'], innerEdgeId: 'e-ZZ' }))).toBe(false)
    expect(keepExportElement(base({ classes: ['vue-flow__edges'], innerEdgeId: null }))).toBe(false)
  })
  it('调试叠加一律剔除（不管它挂在哪）', () => {
    expect(keepExportElement(base({ classes: ['v2-debug-overlay'] }))).toBe(false)
    expect(keepExportElement(base({ classes: ['vue-flow__node', 'moving-handle-debug'], dataId: 'A' }))).toBe(false)
  })
})
describe('normalizeScale', () => {
  it('合法值原样（取整）', () => {
    expect(normalizeScale(2)).toBe(2)
    expect(normalizeScale('3')).toBe(3)
    expect(normalizeScale(2.4)).toBe(2)
  })
  it('越界夹到 [1,4]', () => {
    expect(normalizeScale(0)).toBe(EXPORT_SCALE_MIN)
    expect(normalizeScale(-3)).toBe(EXPORT_SCALE_MIN)
    expect(normalizeScale(99)).toBe(EXPORT_SCALE_MAX)
  })
  it('非法值回落默认', () => {
    expect(normalizeScale('abc')).toBe(EXPORT_SCALE_DEFAULT)
    expect(normalizeScale(undefined)).toBe(EXPORT_SCALE_DEFAULT)
    expect(normalizeScale(Number.NaN)).toBe(EXPORT_SCALE_DEFAULT)
  })
})

describe('outputSize / exceedsMaxDimension', () => {
  it('输出像素 = 尺寸 × 倍数', () => {
    expect(outputSize({ x: 10, y: 20, w: 100, h: 50 }, 2)).toEqual({ w: 200, h: 100 })
  })
  it('最小 1 像素（不返回 0/负）', () => {
    expect(outputSize({ x: 0, y: 0, w: 0.2, h: 0.2 }, 1)).toEqual({ w: 1, h: 1 })
  })
  it('超过画布上限 → true（含边界相等为 false）', () => {
    expect(exceedsMaxDimension({ w: MAX_EXPORT_DIMENSION, h: 10 })).toBe(false)
    expect(exceedsMaxDimension({ w: MAX_EXPORT_DIMENSION + 1, h: 10 })).toBe(true)
    expect(exceedsMaxDimension({ w: 10, h: MAX_EXPORT_DIMENSION + 1 })).toBe(true)
  })
})

describe('planExport', () => {
  const nodes = [
    { id: 'A', x: 0, y: 0, w: 100, h: 100 },
    { id: 'B', x: 200, y: 0, w: 100, h: 100 },
    { id: 'C', x: 500, y: 500, w: 50, h: 50 },
  ]
  const edges = [
    { id: 'e-AB', source: 'A', target: 'B' },
    { id: 'e-BC', source: 'B', target: 'C' },
    { id: 'e-AC', source: 'A', target: 'C' },
  ]

  it('全量：范围=全部节点包围盒，全部节点与连线都保留', () => {
    const plan = planExport({
      mode: 'full',
      nodes,
      edges,
      selectedNodeIds: new Set(),
      padding: 4,
    })
    // 包围盒 0,0,550,550 再四边外扩 4 → -4,-4,558,558（避免边缘的阴影/光晕被切）
    expect(plan?.rect).toEqual({ x: -4, y: -4, w: 558, h: 558 })
    expect([...(plan?.nodeIds ?? [])].sort()).toEqual(['A', 'B', 'C'])
    expect([...(plan?.edgeIds ?? [])].sort()).toEqual(['e-AB', 'e-AC', 'e-BC'])
  })

  it('全量：无节点 → 用当前可视区兜底', () => {
    const plan = planExport({
      mode: 'full',
      nodes: [],
      edges: [],
      selectedNodeIds: new Set(),
      padding: 4,
      fallbackRect: { x: -100, y: -50, w: 800, h: 600 },
    })
    expect(plan?.rect).toEqual({ x: -100, y: -50, w: 800, h: 600 })
    expect(plan?.nodeIds.size).toBe(0)
  })

  it('全量：无节点且无可视区 → null（调用方据此报"没有内容"）', () => {
    const plan = planExport({ mode: 'full', nodes: [], edges: [], selectedNodeIds: new Set(), padding: 4 })
    expect(plan).toBeNull()
  })

  it('选中：范围=选中节点包围盒 + padding，只留选中节点与两端都选中的连线', () => {
    const plan = planExport({
      mode: 'selected',
      nodes,
      edges,
      selectedNodeIds: new Set(['A', 'B']),
      padding: 4,
    })
    expect(plan?.rect).toEqual({ x: -4, y: -4, w: 308, h: 108 })
    expect([...(plan?.nodeIds ?? [])].sort()).toEqual(['A', 'B'])
    expect([...(plan?.edgeIds ?? [])]).toEqual(['e-AB'])
  })

  it('选中：跨到未选中节点的连线被丢掉（不留悬空线）', () => {
    const plan = planExport({
      mode: 'selected',
      nodes,
      edges,
      selectedNodeIds: new Set(['C']),
      padding: 0,
    })
    expect(plan?.rect).toEqual({ x: 500, y: 500, w: 50, h: 50 })
    expect(plan?.edgeIds.size).toBe(0)
  })

  it('选中：选中集里的未知 id 被忽略（不参与包围盒）', () => {
    const plan = planExport({
      mode: 'selected',
      nodes,
      edges,
      selectedNodeIds: new Set(['A', '幽灵节点']),
      padding: 0,
    })
    expect(plan?.rect).toEqual({ x: 0, y: 0, w: 100, h: 100 })
    expect([...(plan?.nodeIds ?? [])]).toEqual(['A'])
  })

  it('选中：全部是未知 id → null', () => {
    const plan = planExport({
      mode: 'selected',
      nodes,
      edges,
      selectedNodeIds: new Set(['幽灵节点']),
      padding: 4,
    })
    expect(plan).toBeNull()
  })
})
