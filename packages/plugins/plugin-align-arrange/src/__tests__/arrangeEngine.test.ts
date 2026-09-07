import { describe, expect, it } from 'vitest'
import { alignNodes, distributeNodes, type ArrangeRect } from '../arrangeEngine'

const R = (id: string, x: number, y: number, w = 100, h = 50): ArrangeRect => ({ id, x, y, w, h })

/**
 * 语义：alignNodes/distributeNodes 只返回"真正需要移动的节点"（Map 里没有 = 位置不动）。
 * 这样命令层 updateNodes 只写动的节点，history 只记一次、redo 不会因写同值产生多余快照。
 */
describe('alignNodes', () => {
  it('少于 2 个节点返回空 Map', () => {
    expect(alignNodes([R('a', 0, 0)], 'left').size).toBe(0)
  })

  it('左对齐：x 归一到最左边缘；已贴最左的节点不出现', () => {
    const nodes = [R('a', 100, 0), R('b', 260, 20), R('c', 40, 80)]
    const out = alignNodes(nodes, 'left') // minX = 40
    expect(out.size).toBe(2)
    expect(out.get('a')).toEqual({ x: 40, y: 0 })
    expect(out.get('b')).toEqual({ x: 40, y: 20 })
    expect(out.has('c')).toBe(false) // 已在 x=40
  })

  it('右对齐：右缘对齐最右缘（x = maxRight - w）', () => {
    // a 右缘 100；b 右缘 320；c 右缘 120 → maxRight=320
    const nodes = [R('a', 0, 0, 100, 50), R('b', 120, 20, 200, 50), R('c', 40, 80, 80, 50)]
    const out = alignNodes(nodes, 'right')
    expect(out.size).toBe(2)
    expect(out.get('a')).toEqual({ x: 220, y: 0 }) // 320-100
    expect(out.get('c')).toEqual({ x: 240, y: 80 }) // 320-80
    expect(out.has('b')).toBe(false) // 右缘已 320
  })

  it('顶对齐：y 归一到最顶边缘', () => {
    const nodes = [R('a', 0, 30), R('b', 200, 0), R('c', 50, 90)]
    const out = alignNodes(nodes, 'top') // minY = 0
    expect(out.size).toBe(2)
    expect(out.get('a')).toEqual({ x: 0, y: 0 })
    expect(out.get('c')).toEqual({ x: 50, y: 0 })
    expect(out.has('b')).toBe(false)
  })

  it('底对齐：下缘对齐最下缘（y = maxBottom - h）', () => {
    // a 下缘 60；b 下缘 180；c 下缘 40 → maxBottom=180
    const nodes = [R('a', 0, 10, 100, 50), R('b', 200, 100, 100, 80), R('c', 50, 0, 100, 40)]
    const out = alignNodes(nodes, 'bottom')
    expect(out.size).toBe(2)
    expect(out.get('a')).toEqual({ x: 0, y: 130 }) // 180-50
    expect(out.get('c')).toEqual({ x: 50, y: 140 }) // 180-40
    expect(out.has('b')).toBe(false)
  })
})

describe('distributeNodes', () => {
  it('少于 3 个节点返回空 Map', () => {
    expect(distributeNodes([R('a', 0, 0), R('b', 200, 0)], 'h').size).toBe(0)
  })

  it('水平：首尾中心不动，中间节点按等距重排', () => {
    // 首 a 中心 50，尾 c 中心 450；b 原中心 270 → 目标 250（等距）
    const nodes = [R('a', 0, 0, 100, 50), R('b', 220, 20, 100, 50), R('c', 400, 40, 100, 50)]
    const out = distributeNodes(nodes, 'h')
    expect(out.size).toBe(1)
    expect(out.get('b')).toEqual({ x: 200, y: 20 })
    expect(out.has('a')).toBe(false)
    expect(out.has('c')).toBe(false)
  })

  it('垂直：首尾中心不动，中间按等距重排', () => {
    // 首 a 中心 50，尾 c 中心 450；b 原中心 270 → 250
    const nodes = [R('a', 0, 0, 50, 100), R('b', 20, 220, 50, 100), R('c', 40, 400, 50, 100)]
    const out = distributeNodes(nodes, 'v')
    expect(out.size).toBe(1)
    expect(out.get('b')).toEqual({ x: 20, y: 200 })
  })

  it('混合尺寸按中心等距（不受宽度影响）', () => {
    // a 中心 50，c 中心 700；b(w200) 原中心 300 → 目标 375
    const nodes = [R('a', 0, 0, 100, 50), R('b', 200, 0, 200, 50), R('c', 650, 0, 100, 50)]
    const out = distributeNodes(nodes, 'h')
    expect(out.size).toBe(1)
    expect(out.get('b')).toEqual({ x: 275, y: 0 }) // 375 - 100
  })
})
