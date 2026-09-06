import { describe, it, expect } from 'vitest'
import {
  aimOrientation,
  aimAcceptsSide,
  aimBodyCandidate,
  aimSnapCandidate,
  aimToCandidate,
  aimPortSide,
  type Aim,
} from '../aim'

const A = { nodeId: 'a' }
const B = { nodeId: 'b' }

function mk(side: 'input' | 'output' | 'body'): Aim {
  return { nodeId: 'b', side }
}

describe('aimOrientation', () => {
  it('从 source 口拖出 = forward，从 target 口拖出 = reverse', () => {
    expect(aimOrientation('source')).toBe('forward')
    expect(aimOrientation('target')).toBe('reverse')
  })
})

describe('aimAcceptsSide（方向匹配才接收）', () => {
  it('forward 只收 input / body，不收 output', () => {
    expect(aimAcceptsSide(mk('input'), 'source')).toBe(true)
    expect(aimAcceptsSide(mk('body'), 'source')).toBe(true)
    expect(aimAcceptsSide(mk('output'), 'source')).toBe(false)
  })
  it('reverse 只收 output / body，不收 input', () => {
    expect(aimAcceptsSide(mk('output'), 'target')).toBe(true)
    expect(aimAcceptsSide(mk('body'), 'target')).toBe(true)
    expect(aimAcceptsSide(mk('input'), 'target')).toBe(false)
  })
})

describe('aimToCandidate（规整 source→target）', () => {
  it('forward 拖 source→瞄准节点 b，body 落 body 区', () => {
    const c = aimToCandidate(mk('body'), 'a', 'source')
    expect(c).toEqual({ source: 'a', target: 'b', zone: 'body' })
  })
  it('forward 命中 input 端口区 → snap', () => {
    const c = aimToCandidate(mk('input'), 'a', 'source')
    expect(c).toEqual({ source: 'a', target: 'b', zone: 'snap' })
  })
  it('reverse（从 target 口拖）→ 瞄准节点 b 作 source', () => {
    const c = aimToCandidate(mk('body'), 'a', 'target')
    expect(c).toEqual({ source: 'b', target: 'a', zone: 'body' })
  })
  it('reverse 命中 output 端口区 → snap', () => {
    const c = aimToCandidate(mk('output'), 'a', 'target')
    expect(c).toEqual({ source: 'b', target: 'a', zone: 'snap' })
  })
})

describe('aimBodyCandidate / aimSnapCandidate', () => {
  it('body 与 snap 候选 zone 分别标注', () => {
    expect(aimBodyCandidate(mk('body'), 'a', 'source').zone).toBe('body')
    expect(aimSnapCandidate(mk('input'), 'a', 'source').zone).toBe('snap')
  })
})

describe('aimPortSide', () => {
  it('forward → 输入口 input；reverse → 输出口 output；body → null', () => {
    expect(aimPortSide(mk('input'), 'source')).toBe('input')
    expect(aimPortSide(mk('output'), 'target')).toBe('output')
    expect(aimPortSide(mk('body'), 'source')).toBeNull()
  })
})
