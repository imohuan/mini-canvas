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
  type EdgeAppearance,
} from '../edgeGeometry'

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

  it('没有障碍矩形时回退自适应贝塞尔（不丢线）', () => {
    const d = buildEdgePath(0, 0, 14, 150, Position.Right, Position.Left, 'avoid')
    expect(d).toBe(buildEdgePath(0, 0, 14, 150, Position.Right, Position.Left, 'adaptive'))
  })
})

describe('正交避障：两端卡片也参与避障', () => {
  const source = { id: 's', x: 0, y: 0, w: 250, h: 210 }
  const target = { id: 't', x: 14, y: 150, w: 250, h: 210 }
  // 右端口 (250,105) → 左端口 (14,255)：与截图相同的上下错位布局
  const s = { x: 250, y: 105 }
  const t = { x: 14, y: 255 }

  function sampleAll() {
    const points: Array<{ x: number; y: number }> = []
    for (let i = 0; i <= 120; i++) {
      points.push(
        sampleEdgePath(
          i / 120,
          s.x, s.y, t.x, t.y,
          Position.Right, Position.Left,
          'avoid',
          undefined,
          [
            { ...source, inflate: 0 },
            { ...target, inflate: 0 },
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

  it('resolveEdgeObstacles 给两端卡片 inflate=0，其它节点保留默认边距', () => {
    const rects = [
      { id: 's', x: 0, y: 0, w: 10, h: 10 },
      { id: 't', x: 20, y: 0, w: 10, h: 10 },
      { id: 'o', x: 40, y: 0, w: 10, h: 10 },
    ]
    const out = resolveEdgeObstacles(rects, ['s', 't'], {
      liveOffsets: new Map([['o', { dx: 5, dy: 6 }]]),
    })
    expect(out.find((r) => r.id === 's')?.inflate).toBe(0)
    expect(out.find((r) => r.id === 't')?.inflate).toBe(0)
    expect(out.find((r) => r.id === 'o')?.inflate).toBeUndefined()
    expect(out.find((r) => r.id === 'o')).toMatchObject({ x: 45, y: 6 })
  })
})

describe('正交避障：连线留白', () => {
  const o = { id: 'o', x: 100, y: -40, w: 100, h: 80 }

  it('默认在安全区之外再退 6px（路线上沿从 -58 退到 -64）', () => {
    const d = buildEdgePath(0, 0, 300, 0, Position.Right, Position.Left, 'avoid', undefined, [o])
    expect(d).toContain(' L 34 -56')
    expect(d).toContain(' L 258 -64')
  })

  it('连线留白调大，路径继续外退', () => {
    const d = buildEdgePath(0, 0, 300, 0, Position.Right, Position.Left, 'avoid', { avoidClearance: 16 }, [o])
    expect(d).toContain(' L 248 -74')
  })

  it('留白为 0 时贴安全区边缘，但不会穿进去', () => {
    const d = buildEdgePath(0, 0, 300, 0, Position.Right, Position.Left, 'avoid', { avoidClearance: 0 }, [o])
    expect(d).toContain(' L 264 -58')
    expect(d).not.toContain(' L 100 0')
  })
})



