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
