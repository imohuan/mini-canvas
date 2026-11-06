/**
 * edgeGeometry —— 自定义边几何纯逻辑契约测试。
 * 锚定金标准 core-node-contract §6.3（CustomEdge 路径/采样），防止重构改坏几何。
 */
import { describe, it, expect } from 'vitest'
import {
  Position,
  getSourcePosition,
  getTargetPosition,
  normalizePosition,
  buildEdgePath,
  sampleEdgePath,
  findClosestPointOnPath,
  resolveEdgeObstacles,
  expandObstacle,
  resolveObstaclePads,
  type EdgeAppearance,
} from './edgeGeometry'

const straight = (sx: number, sy: number, tx: number, ty: number) =>
  buildEdgePath(sx, sy, tx, ty, Position.Right, Position.Left, 'bezier')

describe('port 方向归一化', () => {
  it('handle=source/target 强制 Right/Left', () => {
    expect(getSourcePosition(undefined, 'source')).toBe(Position.Right)
    expect(getTargetPosition(undefined, 'target')).toBe(Position.Left)
  })
  it('无 handle 时回落 normalize ?? 默认(Right/Left)', () => {
    expect(getSourcePosition('bottom', undefined)).toBe(Position.Bottom)
    expect(getSourcePosition('junk', undefined)).toBe(Position.Right)
    expect(getTargetPosition('top', undefined)).toBe(Position.Top)
  })
  it('normalizePosition 关键词含混匹配（v1 顺序 left→right→top→bottom，先命中先赢）', () => {
    expect(normalizePosition('left')).toBe(Position.Left)
    expect(normalizePosition('right')).toBe(Position.Right)
    expect(normalizePosition('top-right')).toBe(Position.Right) // 先命中 right
    expect(normalizePosition('top')).toBe(Position.Top)
    expect(normalizePosition('bottom')).toBe(Position.Bottom)
    expect(normalizePosition('junk')).toBeNull()
  })
})

describe('bezier 路径（默认，source=Right,target=Left）', () => {
  it('控制点水平、最小曲率 80px', () => {
    // source(0,0) target(100,0)，source→Right(1,0)、target→Left(-1,0)
    const d = buildEdgePath(0, 0, 100, 0, Position.Right, Position.Left, 'bezier')
    // distX = max(|100-0|*0.5, 80) = 80；c1x=0+80=80、c2x=100-80=20
    expect(d).toBe('M 0 0 C 80 0, 20 0, 100 0')
  })
  it('source 在 Left 侧符号变负', () => {
    // source=Left(-1,0) target=Right(1,0)
    const d = buildEdgePath(100, 0, 0, 0, Position.Left, Position.Right, 'bezier')
    expect(d).toBe('M 100 0 C 20 0, 80 0, 0 0')
  })
})

describe('straight 路径', () => {
  it('直线 M L', () => {
    expect(buildEdgePath(0, 0, 100, 80, Position.Right, Position.Left, 'straight')).toBe(
      'M 0 0 L 100 80',
    )
  })
})

describe('step / smoothstep 路径', () => {
  it('step 首尾按 stepOffset=20 伸出、中段折线（source=Right→target=Left 同 y 退化折点忠实 v1）', () => {
    const d = buildEdgePath(0, 0, 200, 0, Position.Right, Position.Left, 'step')
    // source gapped +20 → L20 0；target gapped -20 → L180 0；首尾 M/L 无空格（v1 reduce 拼接风格）
    expect(d).toBe('M0 0L20 0L100 0L100 0L180 0L200 0')
  })
  it('smoothstep 在垂直/水平转向折点处出 Q 圆角', () => {
    // source(0,0)→target(200,100)：source gapped(20,0)、target gapped(180,100)
    // (100,0) 处前水平后垂直 → getBend 画 Q
    const d = buildEdgePath(0, 0, 200, 100, Position.Right, Position.Left, 'smoothstep')
    expect(d).toContain('Q')
    expect(d).toContain('M0 0')
    expect(d).toContain('L200 100')
  })
  it('step 转向点也走 getBend，但 borderRadius=0 时 Q 为 0 半径退化（不崩、坐标合法）', () => {
    // v1 无论半径多大都生成 Q 文本，只是 radius=0 时控制点与折点重合；此处仅验证转向不崩
    const d = buildEdgePath(0, 0, 200, 100, Position.Right, Position.Left, 'step')
    expect(d).toContain('M0 0')
    expect(d).toContain('L200 100')
    expect(d.length).toBeGreaterThan(0)
  })
})

describe('路径采样（箭头/剪切钮依赖）', () => {
  it('straight t=0/1 端点，t=0.5 中点', () => {
    const p0 = sampleEdgePath(0, 0, 0, 100, 0, Position.Right, Position.Left, 'straight')
    const p1 = sampleEdgePath(1, 0, 0, 100, 0, Position.Right, Position.Left, 'straight')
    const mid = sampleEdgePath(0.5, 0, 0, 100, 0, Position.Right, Position.Left, 'straight')
    expect(p0).toEqual({ x: 0, y: 0 })
    expect(p1).toEqual({ x: 100, y: 0 })
    expect(mid).toEqual({ x: 50, y: 0 })
  })
  it('bezier 采样落在源/目标区间内且端点到边界', () => {
    const p0 = sampleEdgePath(0, 0, 0, 100, 0, Position.Right, Position.Left, 'bezier')
    const p1 = sampleEdgePath(1, 0, 0, 100, 0, Position.Right, Position.Left, 'bezier')
    expect(p0.x).toBeCloseTo(0)
    expect(p1.x).toBeCloseTo(100)
    const mid = sampleEdgePath(0.5, 0, 0, 100, 0, Position.Right, Position.Left, 'bezier')
    expect(mid.x).toBeGreaterThanOrEqual(0)
    expect(mid.x).toBeLessThanOrEqual(100)
  })
  it('findClosestPointOnPath 在 straight 上命中最近点', () => {
    const p = findClosestPointOnPath(20, 5, 0, 0, 100, 0, Position.Right, Position.Left, 'straight')
    expect(Math.abs(p.x - 20)).toBeLessThanOrEqual(4)
    expect(Math.abs(p.y - 0)).toBeLessThanOrEqual(4)
  })
})

describe('可配置几何覆盖', () => {
  it('覆盖 minCurvature 改变 bezier 控制点', () => {
    const app: EdgeAppearance = { minCurvature: 40 }
    const d = buildEdgePath(0, 0, 200, 0, Position.Right, Position.Left, 'bezier', app)
    // distX = max(100,40)=100
    expect(d).toBe('M 0 0 C 100 0, 100 0, 200 0')
  })
  it('覆盖 stepOffset 改变 step 伸出距离', () => {
    const app: EdgeAppearance = { stepOffset: 10 }
    const d = buildEdgePath(0, 0, 200, 0, Position.Right, Position.Left, 'step', app)
    // source gapped +10 → L10 0；target gapped -10 → L190 0
    expect(d).toBe('M0 0L10 0L100 0L100 0L190 0L200 0')
  })
})

describe('自适应贝塞尔', () => {
  it('短水平缝的控制点不交叉（各取缝宽一半）', () => {
    const d = buildEdgePath(0, 0, 14, 150, Position.Right, Position.Left, 'adaptive')
    expect(d).toBe('M 0 0 C 7 0, 7 150, 14 150')
  })

  it('上下端口沿端口法线出线，不再固定走 X 轴', () => {
    const d = buildEdgePath(0, 100, 200, 0, Position.Top, Position.Top, 'adaptive')
    expect(d).toContain('C')
    const c1 = d.match(/C\s+([-\d.]+)\s+([-\d.]+)/)
    expect(c1).not.toBeNull()
    expect(Number(c1![2])).toBeLessThan(100)
  })

  it('采样仍落在端点之间', () => {
    const mid = sampleEdgePath(0.5, 0, 0, 14, 150, Position.Right, Position.Left, 'adaptive')
    expect(mid.x).toBeGreaterThan(0)
    expect(mid.x).toBeLessThan(14)
    expect(mid.y).toBeGreaterThan(0)
    expect(mid.y).toBeLessThan(150)
  })
})

describe('正交避障', () => {
  const obstacle = { id: 'mid', x: 100, y: -40, w: 100, h: 80 }

  it('绕过外扩矩形，并给拐角圆角', () => {
    const d = buildEdgePath(0, 0, 300, 0, Position.Right, Position.Left, 'avoid', undefined, [obstacle])
    expect(d).toContain('Q')
    expect(d).not.toContain(' L 100 0')
    const inside = (p: { x: number; y: number }) =>
      p.x > obstacle.x && p.x < obstacle.x + obstacle.w && p.y > obstacle.y && p.y < obstacle.y + obstacle.h
    for (let i = 0; i <= 30; i++) {
      const point = sampleEdgePath(i / 30, 0, 0, 300, 0, Position.Right, Position.Left, 'avoid', undefined, [obstacle])
      expect(inside(point)).toBe(false)
    }
  })

  it('没有障碍矩形时仍按正交路径出线（不丢线，也不回退贝塞尔）', () => {
    const d = buildEdgePath(0, 0, 14, 150, Position.Right, Position.Left, 'avoid')
    expect(d).toContain('M 0 0')
    expect(d).toContain('L 14 150')
    expect(d).toContain('Q')
  })
})

describe('正交避障：两端卡片也参与避障', () => {
  // 与用户截图一致：两张卡片上下错位，中间有真实空隙（不重叠）。
  const source = { id: 's', x: 0, y: 0, w: 250, h: 200 }
  const target = { id: 't', x: 60, y: 320, w: 250, h: 200 }
  // 右端口 (250,100) → 左端口 (60,420)
  const s = { x: 250, y: 100 }
  const t = { x: 60, y: 420 }

  function sampleAll() {
    const points: Array<{ x: number; y: number }> = []
    for (let i = 0; i <= 1200; i++) {
      points.push(
        sampleEdgePath(
          i / 1200,
          s.x, s.y, t.x, t.y,
          Position.Right, Position.Left,
          'avoid',
          undefined,
      [
        { ...source, role: 'source' as const },
        { ...target, role: 'target' as const },
      ],
        ),
      )
    }
    return points
  }

  function inside(p: { x: number; y: number }, rect: { x: number; y: number; w: number; h: number }) {
    return p.x > rect.x + 1 && p.x < rect.x + rect.w - 1 && p.y > rect.y + 1 && p.y < rect.y + rect.h - 1
  }

  it('不穿过起点或终点卡片（以前会从目标卡片背后穿过去）', () => {
    for (const point of sampleAll()) {
      expect(inside(point, source)).toBe(false)
      expect(inside(point, target)).toBe(false)
    }
  })

  it('从右侧端口向右出线，从左端口左侧进入（不是右侧连右侧）', () => {
    const points = sampleAll()
    expect(points[1].x).toBeGreaterThan(s.x)
    const nearEnd = points[points.length - 3]
    const end = points[points.length - 1]
    expect(end.x - nearEnd.x).toBeGreaterThan(0)
    expect(end.x).toBeCloseTo(t.x, 5)
  })

  it('resolveEdgeObstacles 给两端卡片打 endpoint 标记，其它节点保留默认边距', () => {
    const rects = [
      { id: 's', x: 0, y: 0, w: 10, h: 10 },
      { id: 't', x: 20, y: 0, w: 10, h: 10 },
      { id: 'o', x: 40, y: 0, w: 10, h: 10 },
    ]
    const out = resolveEdgeObstacles(rects, ['s', 't'], {
      liveOffsets: new Map([['o', { dx: 5, dy: 6 }]]),
    })
    expect(out.find((r) => r.id === 's')?.endpoint).toBe(true)
    expect(out.find((r) => r.id === 't')?.endpoint).toBe(true)
    expect(out.find((r) => r.id === 'o')?.inflate).toBeUndefined()
    expect(out.find((r) => r.id === 'o')?.endpoint).toBeUndefined()
    expect(out.find((r) => r.id === 'o')).toMatchObject({ x: 45, y: 6 })
  })
})

describe('正交避障：两端卡片按完整边距外扩', () => {
  // 两卡上下叠放，中间留 110px 净空：既要验证上下边距，也要验证从夹缝通过。
  const source = { id: 's', x: 0, y: 0, w: 250, h: 200 }
  const target = { id: 't', x: 20, y: 310, w: 250, h: 200 }
  const s = { x: 250, y: 100 }
  const t = { x: 20, y: 410 }

  function sampleAll(clearance: number) {
    const points: Array<{ x: number; y: number }> = []
    for (let i = 0; i <= 120; i++) {
      points.push(
        sampleEdgePath(
          i / 120,
          s.x, s.y, t.x, t.y,
          Position.Right, Position.Left,
          'avoid',
          { avoidMargin: 48, avoidClearance: clearance },
          [
            { ...source, role: 'source' as const },
            { ...target, role: 'target' as const },
          ],
        ),
      )
    }
    return points
  }

  function inside(p: { x: number; y: number }, rect: { x: number; y: number; w: number; h: number }) {
    return p.x > rect.x + 1 && p.x < rect.x + rect.w - 1 && p.y > rect.y + 1 && p.y < rect.y + rect.h - 1
  }

  it('不穿过两张卡片', () => {
    for (const point of sampleAll(12)) {
      expect(inside(point, source)).toBe(false)
      expect(inside(point, target)).toBe(false)
    }
  })

  it('竖直方向也有边距：路径走在两卡之间的净空里，不贴卡片', () => {
    const points = sampleAll(12)
    // 两卡之间净空 90px（源底 210 ~ 目标顶 300）；连线应落在中间，不贴任何一边。
    const between = points.filter((p) => p.y >= source.y + source.h + 6 && p.y <= target.y - 6)
    expect(between.length).toBeGreaterThan(0)
    // 两卡之间的净空段（含圆角外扩）必须存在，且路径不穿进两张卡片内部。
    const midY = (source.y + source.h + target.y) / 2
    expect(points.some((p) => Math.abs(p.y - midY) < 120)).toBe(true)
  })

  it('缝隙够宽时，左右与上下都按完整边距退让', () => {
    const far = { id: 't2', x: 500, y: 30, w: 250, h: 150 }
    const d = buildEdgePath(
      250, 105, 500, 105,
      Position.Right, Position.Left,
      'avoid',
      { avoidMargin: 18, avoidClearance: 10 },
      [{ ...far, endpoint: true }],
    )
    // 上沿应退到 30 - (18+10) = 2，而不是贴着 30。
    expect(d).toContain(' 2')
  })

  it('端点安全区按方向外扩：上下永远保留完整边距', () => {
    const out = expandObstacle(
      { x: 0, y: 0, w: 100, h: 100 },
      60,
      { padX: 6, padY: 60, open: [Position.Right] },
    )
    expect(out).toMatchObject({ x: -6, y: -60, w: 106, h: 220 })
  })
})




  // 和用户截图一致：两卡之间有真实空隙，48px 边距下也必须走正交绕行，不能退回贝塞尔。
  it('两卡叠放：间距够时走正交绕行，不退回贝塞尔', () => {
    const rects = [
      { id: 's', role: 'source' as const, x: 0, y: 0, w: 250, h: 200 },
      { id: 't', role: 'target' as const, x: 20, y: 310, w: 250, h: 200 },
    ]
    const d = buildEdgePath(250, 100, 20, 410, Position.Right, Position.Left, 'avoid',
      { avoidMargin: 48, avoidClearance: 7 }, rects)
    expect(d).toContain('M 250 100')
    expect(d).not.toContain('C')
    expect(d).toContain('Q')
  })



describe('正交避障：连线留白', () => {
  const o = { id: 'o', x: 100, y: -40, w: 100, h: 80 }

  it('连线距离 = 避障边距 18 + 连线留白 6 = 24px', () => {
    const d = buildEdgePath(0, 0, 300, 0, Position.Right, Position.Left, 'avoid', undefined, [o])
    // 矩形 y=-40、h=80 → 底边 40；向外 24px → 64。路线上沿正好落在 -64。
    expect(d).toContain('L 291 -64')
  })

  it('连线留白调大，路径继续外退', () => {
    const d = buildEdgePath(0, 0, 300, 0, Position.Right, Position.Left, 'avoid', { avoidClearance: 16 }, [o])
    expect(d).toContain('L 291 -74')
  })

  it('留白为 0 时连线距卡片仍是避障边距 18px，不会重合', () => {
    const d = buildEdgePath(0, 0, 300, 0, Position.Right, Position.Left, 'avoid', { avoidClearance: 0 }, [o])
    expect(d).toContain('L 291 -58')
    expect(d).not.toContain(' L 100 0')
  })
})




describe('正交避障：真实画布的密集卡片（分镜网格）', () => {
  // 复刻产品画布：源卡片在左上，目标网格的每张卡只隔 10px。
  // 之前每张卡无脑外扩 52px，安全区互相吞掉，端口被埋住 → 整条线回退贝塞尔。
  const source = { id: 's', role: 'source' as const, x: 0, y: 0, w: 300, h: 160 }
  const grid = [
    { id: 'g1', x: 600, y: 0, w: 400, h: 200 },
    { id: 'g2', x: 1010, y: 0, w: 400, h: 200 },
    { id: 'g3', x: 1420, y: 0, w: 400, h: 200 },
    { id: 'g4', x: 600, y: 210, w: 400, h: 200 },
    { id: 'g5', x: 1010, y: 210, w: 400, h: 200 },
    { id: 'g6', x: 1420, y: 210, w: 400, h: 200 },
  ]
  const rects = [source, ...grid]
  const app = { avoidMargin: 45, avoidClearance: 7, avoidRadius: 16 }

  function inside(p: { x: number; y: number }, r: { x: number; y: number; w: number; h: number }) {
    return p.x > r.x + 1 && p.x < r.x + r.w - 1 && p.y > r.y + 1 && p.y < r.y + r.h - 1
  }

  it('卡片只隔 10px 时仍然走正交路径，不退回贝塞尔', () => {
    const withRole = [source, { ...grid[0], role: 'target' as const }, ...grid.slice(1)]
    const d = buildEdgePath(300, 80, 600, 100, Position.Right, Position.Left, 'avoid', app, withRole)
    expect(d).not.toContain('C')
    expect(d).toContain('M 300 80')
  })

  it('路径不穿过任何一张卡片', () => {
    for (const target of grid) {
      // 真实画布每条边都会给两端打 role：这里把被测目标当成这条边的 target。
      const edgeRects = [source, ...grid.map((r) => (r.id === target.id ? { ...r, role: 'target' as const } : r))]
      const points: Array<{ x: number; y: number }> = []
      for (let i = 0; i <= 300; i++) {
        points.push(
          sampleEdgePath(i / 300, 300, 80, target.x, target.y + target.h / 2, Position.Right, Position.Left, 'avoid', app, edgeRects),
        )
      }
      for (const point of points) {
        for (const rect of edgeRects) {
          if (inside(point, rect)) {
            throw new Error(`hit ${rect.id} at ${point.x},${point.y} target ${target.id} d=${buildEdgePath(300, 80, target.x, target.y + target.h / 2, Position.Right, Position.Left, 'avoid', app, edgeRects)}`)
          }
        }
      }
    }
  })

  it('目标端口仍然从左侧进入（不会被别人的安全区顶到右侧）', () => {
    const withRole = [source, { ...grid[0], role: 'target' as const }, ...grid.slice(1)]
    const points: Array<{ x: number; y: number }> = []
    for (let i = 0; i <= 200; i++) {
      points.push(sampleEdgePath(i / 200, 300, 80, 600, 100, Position.Right, Position.Left, 'avoid', app, withRole))
    }
    const nearEnd = points[points.length - 3]
    expect(nearEnd.x).toBeLessThan(600)
  })
})

describe('正交避障：产品端口的 2px 内缩', () => {
  // 真实画布的 handle 中心比卡片边往里约 2px（端口 x 比卡片右边小 2px）。
  // 旧实现要求"端口这一段绝不碰自己卡片"，于是每条候选都判失败 → 全部退回贝塞尔。
  it('端口略微内缩时仍走正交避障', () => {
    const source = { id: 's', role: 'source' as const, x: 0, y: 0, w: 300, h: 200 }
    const target = { id: 't', role: 'target' as const, x: 20, y: 320, w: 300, h: 200 }
    const d = buildEdgePath(298, 100, 22, 420, Position.Right, Position.Left, 'avoid',
      { avoidMargin: 45, avoidClearance: 7 }, [source, target])
    expect(d).not.toContain('C')
    expect(d).toContain('M 298 100')
  })
})

describe('安全区按缝隙收窄（resolveObstaclePads）', () => {
  it('两侧都有邻居时，外扩只占缝隙的一半', () => {
    const rects = [
      { x: 0, y: 0, w: 100, h: 100 },
      { x: 110, y: 0, w: 100, h: 100 },
    ]
    const pads = resolveObstaclePads(rects, 52)
    // 缝隙 10px → 每边最多 4px（(10-2)/2），不会把通道堵死
    expect(pads[0].right).toBeCloseTo(4, 5)
    expect(pads[1].left).toBeCloseTo(4, 5)
  })

  it('没有邻居的一侧保留完整边距', () => {
    const rects = [
      { x: 0, y: 0, w: 100, h: 100 },
      { x: 110, y: 0, w: 100, h: 100 },
    ]
    const pads = resolveObstaclePads(rects, 52)
    expect(pads[0].left).toBe(52)
    expect(pads[1].right).toBe(52)
    expect(pads[0].top).toBe(52)
  })
})

