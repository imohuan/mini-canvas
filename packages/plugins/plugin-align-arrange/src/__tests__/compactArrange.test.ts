import { describe, expect, it } from 'vitest'
import { computeCompactArrange, type CompactRect, type CompactSpacing } from '../compactArrange'

const R = (id: string, x: number, y: number, w = 100, h = 50): CompactRect => ({ id, x, y, w, h })
const GAP = 20
/** 两轴同值：老用例（单值 gap）语义等价迁移 */
const SAME: CompactSpacing = { x: GAP, y: GAP }

describe('computeCompactArrange（老版核心算法搬迁）', () => {
  it('少于等于 1 个节点返回空 Map', () => {
    expect(computeCompactArrange([], 'ArrowLeft', SAME).size).toBe(0)
    expect(computeCompactArrange([R('a', 0, 0)], 'ArrowLeft', SAME).size).toBe(0)
  })

  it('ArrowLeft：重叠节点向左收拢并保持 gap，首个保持', () => {
    // a(0,0,100) 在最左保持；b 与 a y 重叠 → 收到 a 右 + gap
    const nodes = [R('a', 0, 0), R('b', 300, 0)]
    const out = computeCompactArrange(nodes, 'ArrowLeft', SAME)
    expect(out.get('a')).toEqual({ x: 0, y: 0 })
    expect(out.get('b')).toEqual({ x: 100 + GAP, y: 0 })
  })

  it('ArrowLeft：y 不重叠的节点收到最左边缘 minX', () => {
    // a 占 (0,0)；c 在 (300,200) y 不重叠 → 无横向障碍 → 收到 minX=0
    const nodes = [R('a', 0, 0), R('c', 300, 200)]
    const out = computeCompactArrange(nodes, 'ArrowLeft', SAME)
    expect(out.get('a')).toEqual({ x: 0, y: 0 })
    expect(out.get('c')).toEqual({ x: 0, y: 200 })
  })

  it('ArrowRight：重叠节点向右收拢，右边缘对齐的最右节点保持', () => {
    // a(0,0,100) 右缘 100；b(200,0,100) 右缘 300 → b 在前保持；a 收到 b 左 - gap
    const nodes = [R('a', 0, 0), R('b', 200, 0)]
    const out = computeCompactArrange(nodes, 'ArrowRight', SAME)
    expect(out.get('b')).toEqual({ x: 200, y: 0 })
    expect(out.get('a')).toEqual({ x: 200 - 100 - GAP, y: 0 })
  })

  it('ArrowUp：纵向收拢，最上节点保持，下方重叠节点贴上来保持 gap', () => {
    // a 在下方 (0,200)，b 在上方 (0,0,50x100) → b 保持 0；a x 重叠 → 收到 b 下 + gap
    const nodes = [R('a', 0, 200, 50, 100), R('b', 0, 0, 50, 100)]
    const out = computeCompactArrange(nodes, 'ArrowUp', SAME)
    expect(out.get('b')).toEqual({ x: 0, y: 0 })
    expect(out.get('a')).toEqual({ x: 0, y: 100 + GAP })
  })

  it('ArrowDown：纵向收拢，最下节点保持，上方节点贴下来保持 gap', () => {
    // b 在下方 (0,300)，a 在上方 (0,0) → b 保持；a x 重叠 → 收到 b 上 - gap
    const nodes = [R('a', 0, 0, 50, 100), R('b', 0, 300, 50, 100)]
    const out = computeCompactArrange(nodes, 'ArrowDown', SAME)
    expect(out.get('b')).toEqual({ x: 0, y: 300 })
    expect(out.get('a')).toEqual({ x: 0, y: 300 - 100 - GAP })
  })

  it('多节点链式避让：结果 Map 覆盖全部节点（含保持原位的首个）', () => {
    // 三个 y 重叠的节点全向左收拢
    const nodes = [R('a', 0, 0), R('b', 200, 0), R('c', 500, 0)]
    const out = computeCompactArrange(nodes, 'ArrowLeft', SAME)
    expect(out.size).toBe(3)
    expect(out.get('a')).toEqual({ x: 0, y: 0 })
    expect(out.get('b')).toEqual({ x: 100 + GAP, y: 0 }) // 收到 a 右
    expect(out.get('c')).toEqual({ x: 100 + GAP + 100 + GAP, y: 0 }) // 收到 b(新位置) 右
  })
})

describe('紧凑排列间距分 X / Y 两轴', () => {
  it('左右排列只用 X 轴间距，Y 轴间距不参与', () => {
    const nodes = [R('a', 0, 0), R('b', 300, 0)]
    // x=10, y=999：左右排列应只吃 x
    const out = computeCompactArrange(nodes, 'ArrowLeft', { x: 10, y: 999 })
    expect(out.get('b')).toEqual({ x: 100 + 10, y: 0 })
  })

  it('上下排列只用 Y 轴间距，X 轴间距不参与', () => {
    const nodes = [R('a', 0, 200, 50, 100), R('b', 0, 0, 50, 100)]
    // x=999, y=10：上下排列应只吃 y
    const out = computeCompactArrange(nodes, 'ArrowUp', { x: 999, y: 10 })
    expect(out.get('a')).toEqual({ x: 0, y: 100 + 10 })
  })

  it('ArrowRight 用 X、ArrowDown 用 Y（另一半方向同样分轴）', () => {
    const right = computeCompactArrange([R('a', 0, 0), R('b', 200, 0)], 'ArrowRight', { x: 5, y: 999 })
    expect(right.get('a')!.x).toBe(200 - 100 - 5)

    const down = computeCompactArrange([R('a', 0, 0, 50, 100), R('b', 0, 300, 50, 100)], 'ArrowDown', {
      x: 999,
      y: 5,
    })
    expect(down.get('a')!.y).toBe(300 - 100 - 5)
  })
})
