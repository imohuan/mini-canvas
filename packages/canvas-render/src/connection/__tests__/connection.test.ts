/**
 * connection 纯模块单测：geometry(吸附带几何) / resolveFeedback(决策) / reasonText(文案)。
 * 全部 flow 坐标、零 Vue/DOM，Node 可测。
 */
import { describe, it, expect } from 'vitest'
import {
  computeSnapZones,
  computeBodyZones,
  hitTest,
  closestZone,
  zoneDirectionAnchor,
} from '../geometry'
import { resolveFeedback, isReverse } from '../resolveFeedback'
import { reasonText, DEFAULT_REASON_TEXT } from '../reasonText'
import type { NodeRect } from '../geometry'

const R = 86
// 两节点：A 在 (100,100)，尺寸 256×128；B 在 (500,200)
const A: NodeRect = { id: 'a', type: 't', x: 100, y: 100, width: 256, height: 128 }
const B: NodeRect = { id: 'b', type: 't', x: 500, y: 200, width: 256, height: 128 }

describe('geometry: zoneDirectionAnchor', () => {
  it('forward → 锚点在左缘中点(target 输入口)', () => {
    const a = zoneDirectionAnchor(A, 'forward')
    expect(a).toEqual({ anchorX: 100, anchorY: 164, side: 'target' })
  })
  it('reverse → 锚点在右缘中点(source 输出口)', () => {
    const a = zoneDirectionAnchor(A, 'reverse')
    expect(a).toEqual({ anchorX: 356, anchorY: 164, side: 'source' })
  })
})

describe('geometry: computeSnapZones (SnapZoneConfig)', () => {
  it('默认 config：forward 带以 target(左缘)为准，高=节点高×0.8、宽=handleRadius、offset=0', () => {
    const zones = computeSnapZones([A, B], 'forward', R)
    const za = zones.find((z) => z.id === 'a')!
    // A 高 128 → 带高 102.4；target 锚点左缘 x=100 → 带 x = 100 - (86-0) = 14
    expect(za.side).toBe('target')
    expect(za.x).toBeCloseTo(A.x - R)
    expect(za.width).toBeCloseTo(R)
    expect(za.height).toBeCloseTo(A.height * 0.8)
    expect(za.y).toBeCloseTo(A.y + A.height / 2 - (A.height * 0.8) / 2)
    expect(za.anchorX).toBe(A.x)
  })
  it('reverse 带以 source(右缘)为准，带从右缘向右侧伸出 width', () => {
    const zones = computeSnapZones([A, B], 'reverse', R)
    const za = zones.find((z) => z.id === 'a')!
    expect(za.side).toBe('source')
    expect(za.x).toBeCloseTo(A.x + A.width)
    expect(za.width).toBeCloseTo(R)
    expect(za.anchorX).toBe(A.x + A.width)
  })
  it('config 覆盖：heightRatio/width/offset 生效，shape 透传', () => {
    const zones = computeSnapZones([A], 'forward', R, {
      heightRatio: 1,
      width: 40,
      offset: 10,
      shape: 'arc',
    })
    const za = zones[0]
    // target 左缘 anchorX=100，offset=10>0 向节点内收 → x = 100 - (40-10) = 70
    expect(za.x).toBeCloseTo(A.x - (40 - 10))
    expect(za.width).toBeCloseTo(40)
    expect(za.height).toBeCloseTo(A.height) // heightRatio=1
    expect(za.shape).toBe('arc')
  })
})

describe('geometry: hitTest / closestZone', () => {
  it('body 区命中与边界', () => {
    const bodies = computeBodyZones([A, B])
    expect(hitTest(bodies[0], { x: 200, y: 150 })).toBe(true)
    expect(hitTest(bodies[0], { x: 50, y: 150 })).toBe(false) // 左外
    expect(hitTest(bodies[0], { x: 200, y: 400 })).toBe(false) // 下外
  })
  it('closestZone 取命中里距锚点最近者', () => {
    const zones = computeSnapZones([A, B], 'forward', R)
    // A 带 [14,100] 命中带内点 (90,164)
    const nearA = closestZone(zones, { x: 90, y: 164 })
    expect(nearA?.id).toBe('a')
    const nearB = closestZone(zones, { x: 420, y: 260 })
    expect(nearB?.id).toBe('b')
  })
})

describe('resolveFeedback', () => {
  const base = {
    sourceId: 'a',
    sourceHandle: 'source' as const,
    nodeRects: [A, B],
    handleRadius: R,
    validate: (_s: string, _t: string) => '',
  }

  it('isReverse: target 口拖 = reverse', () => {
    expect(isReverse('source')).toBe(false)
    expect(isReverse('target')).toBe(true)
  })

  it('悬空（远离所有带/卡）→ end 跟随鼠标、hover null', () => {
    const r = resolveFeedback({ ...base, flowPoint: { x: 900, y: 900 } })
    expect(r.end).toEqual({ x: 900, y: 900 })
    expect(r.snappedToId).toBeNull()
    expect(r.hover).toBeNull()
  })

  it('forward 命中 A 自己吸附带 → 忽略自身（候选排除含自身由调用方做）；悬在 B 合法口 → 吸附到 B 锚点', () => {
    // B forward 锚点 (500, 264)，吸附带左扩 outer
    const r = resolveFeedback({ ...base, flowPoint: { x: 470, y: 260 } })
    expect(r.snappedToId).toBe('b')
    expect(r.end).toEqual({ x: 500, y: 264 })
    expect(r.hover).toEqual({ nodeId: 'b', status: 'valid', zone: 'snap', reason: undefined })
  })

  it('forward 命中合法口吸附带 → valid snap', () => {
    const r = resolveFeedback({ ...base, flowPoint: { x: 470, y: 264 } })
    expect(r.hover?.status).toBe('valid')
    expect(r.hover?.zone).toBe('snap')
    expect(r.end).toEqual({ x: 500, y: 264 })
  })

  it('forward 悬在目标卡片 body（非端口精确区）→ body 反馈；非法校验 → invalid + reason 且不吸', () => {
    // B body 内偏上(端口吸附带 y 之外但在卡内)；非法 → 线终点仍跟随鼠标
    const r = resolveFeedback({
      ...base,
      flowPoint: { x: 560, y: 210 },
      validate: (s, t) => (s === 'a' && t === 'b' ? '不能连自己' : ''),
    })
    expect(r.snappedToId).toBeNull()
    expect(r.hover).toEqual({ nodeId: 'b', status: 'invalid', zone: 'body', reason: '不能连自己' })
    expect(r.end).toEqual({ x: 560, y: 210 }) // 非法不吸附
  })

  it('forward 悬在合法目标卡片 body → body valid 反馈，且 end 对齐 target(左缘)锚点(与 hover 判定落点一致)', () => {
    // B body 中部(远离 B 左缘吸附带)：hover valid(body)，线终点应吸到 B 左缘锚点 (500,264)
    const r = resolveFeedback({ ...base, flowPoint: { x: 620, y: 264 } })
    expect(r.snappedToId).toBeNull()
    expect(r.hover).toEqual({ nodeId: 'b', status: 'valid', zone: 'body', reason: undefined })
    expect(r.end).toEqual({ x: 500, y: 264 }) // 对齐 target 端口锚点
  })

  it('forward 悬在合法 body 但源自身(候选被调用方排除)外、悬空卡片外 → 不吸', () => {
    const r = resolveFeedback({ ...base, flowPoint: { x: 60, y: 60 } })
    expect(r.snappedToId).toBeNull()
    expect(r.hover).toBeNull()
    expect(r.end).toEqual({ x: 60, y: 60 })
  })

  it('reverse：悬在目标卡片 body 合法 → end 对齐 source(右缘)锚点', () => {
    const r = resolveFeedback({
      sourceId: 'c',
      sourceHandle: 'target',
      nodeRects: [A],
      handleRadius: R,
      flowPoint: { x: 200, y: 164 }, // A body 中部(远离右缘吸附带)
      validate: () => '',
    })
    expect(r.snappedToId).toBeNull()
    expect(r.hover).toEqual({ nodeId: 'a', status: 'valid', zone: 'body', reason: undefined })
    expect(r.end).toEqual({ x: A.x + A.width, y: 164 }) // 右缘(source)锚点
  })

  it('forward 命中合法吸附带但校验通过 → 即使 body 内也以 snap valid 优先', () => {
    const r = resolveFeedback({ ...base, flowPoint: { x: 480, y: 264 } })
    expect(r.snappedToId).toBe('b')
    expect(r.hover?.status).toBe('valid')
    expect(r.hover?.zone).toBe('snap')
  })

  it('reverse(target 拖 source)：悬在 A(目标源)右缘吸附带 → 吸附 A 右缘', () => {
    const r = resolveFeedback({
      sourceId: 'c', // 反向：c 的 target 口拖向 a 的 source
      sourceHandle: 'target',
      nodeRects: [A],
      handleRadius: R,
      flowPoint: { x: 360, y: 150 }, // A 右缘外
      validate: () => '',
    })
    expect(r.snappedToId).toBe('a')
    expect(r.end).toEqual({ x: A.x + A.width, y: 164 }) // 右缘锚点
    expect(r.hover?.status).toBe('valid')
    expect(r.hover?.zone).toBe('snap')
  })
})

describe('reasonText', () => {
  it('ok/undefined → 空串（合法）', () => {
    expect(reasonText('ok')).toBe('')
    expect(reasonText(undefined)).toBe('')
    expect(reasonText(null)).toBe('')
  })
  it('各 reason → 中文文案，未知兜底', () => {
    expect(reasonText('self-loop')).toBe('不能连自己')
    expect(reasonText('duplicate')).toBe('已存在同一条连线')
    expect(reasonText('cycle')).toBe('会形成环')
    expect(reasonText('missing-node')).toBe('目标不存在')
    // 未知给兜底
    expect(reasonText('anything-else' as never)).toBe(DEFAULT_REASON_TEXT)
  })
})
