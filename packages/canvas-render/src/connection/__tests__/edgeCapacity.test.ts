/**
 * edgeCapacity 单测：输入口容量 + 满额挤最老(FIFO)。
 */
import { describe, it, expect } from 'vitest'
import { oldestIncomingToEvict } from '../edgeCapacity'
import type { CanvasEdge } from '@mini-canvas/canvas-core-v2'

const e = (source: string, target: string, id?: string): CanvasEdge => ({
  id: id ?? `e-${source}-${target}`,
  source,
  target,
  type: 'custom',
})

describe('edgeCapacity: oldestIncomingToEvict', () => {
  it('容量未满 → 不挤', () => {
    // capacity=2，现 1 条入边 → 新边加上正好满，无需挤
    const edges = [e('a', 't'), e('x', 'y')]
    expect(oldestIncomingToEvict({ edges, target: 't', capacity: 2 })).toBeNull()
  })
  it('容量 0/负数 → 视为 1', () => {
    const edges = [e('a', 't')]
    expect(oldestIncomingToEvict({ edges, target: 't', capacity: 0 })).toBe('e-a-t')
    expect(oldestIncomingToEvict({ edges, target: 't', capacity: -3 })).toBe('e-a-t')
  })
  it('满额(入边数=容量) → 挤最老一条(FIFO,数组序第一)', () => {
    // capacity=2，现 2 条入边(a、b 先后)→ 挤最老 a
    const edges = [e('a', 't'), e('b', 't'), e('c', 'z')]
    expect(oldestIncomingToEvict({ edges, target: 't', capacity: 2 })).toBe('e-a-t')
  })
  it('超容量多条入边 → 仍挤最老(数组序第一)', () => {
    const edges = [e('a', 't'), e('b', 't'), e('c', 't')]
    expect(oldestIncomingToEvict({ edges, target: 't', capacity: 2 })).toBe('e-a-t')
  })
  it('容量极大 → 不挤', () => {
    const edges = [e('a', 't'), e('b', 't')]
    expect(oldestIncomingToEvict({ edges, target: 't', capacity: 10 })).toBeNull()
  })
})
