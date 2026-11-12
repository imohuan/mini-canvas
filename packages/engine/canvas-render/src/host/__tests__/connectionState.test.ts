import { describe, it, expect } from 'vitest'
import {
  createConnectionState,
  beginConnection,
  endConnection,
  getSourceHandle,
  hoverWriter,
  isConnectionSource,
} from '../connectionState'
import type { ActiveConnection } from '../../contracts/connectionContext'

describe('createConnectionState', () => {
  it('初始：isConnecting false、active/hover null、suppressHandles false', () => {
    const s = createConnectionState()
    expect(s.isConnecting.value).toBe(false)
    expect(s.activeConnection.value).toBeNull()
    expect(s.hoverNode.value).toBeNull()
    expect(s.aimedTarget.value).toBeNull()
    expect(s.suppressHandles.value).toBe(false)
  })

  it('begin 记录源 + 压端口 + isConnecting 派生 true', () => {
    const s = createConnectionState()
    const a: ActiveConnection = { sourceNodeId: 'a', sourceHandle: 'source' }
    s.hoverNode.value = { nodeId: 'x', status: 'valid', zone: 'body', flowPosition: { x: 1, y: 2 } }
    s.aimedTarget.value = { nodeId: 'x', side: 'body' }
    beginConnection(s, a)
    expect(s.isConnecting.value).toBe(true)
    expect(s.activeConnection.value).toEqual(a)
    expect(s.suppressHandles.value).toBe(true)
    expect(s.hoverNode.value).toBeNull()
    expect(s.aimedTarget.value).toBeNull()
    expect(getSourceHandle(s)).toBe('source')
  })

  it('end 全清空', () => {
    const s = createConnectionState()
    beginConnection(s, { sourceNodeId: 'a', sourceHandle: 'target' })
    s.aimedTarget.value = { nodeId: 'b', side: 'input' }
    endConnection(s)
    expect(s.isConnecting.value).toBe(false)
    expect(s.activeConnection.value).toBeNull()
    expect(s.aimedTarget.value).toBeNull()
    expect(s.suppressHandles.value).toBe(false)
    expect(getSourceHandle(s)).toBeNull()
  })

  it('hoverWriter 读写', () => {
    const s = createConnectionState()
    const w = hoverWriter(s)
    const h = {
      nodeId: 'b',
      status: 'invalid' as const,
      zone: 'snap' as const,
      flowPosition: { x: 0, y: 0 },
      reason: 'x',
    }
    w.write(h)
    expect(w.read()).toEqual(h)
  })
})

/**
 * isConnectionSource —— "我是不是本次拖线的源"。
 *
 * 用户问的是"判断连接线是否可以链接，之前判断的是只有单个连接线，现在可能需要让他支持多个"。
 * 单源（节点端口拖线）语义必须逐字不变；多源（多选批量连线：一次拖出、给每个选中节点各连一条）
 * 时，选中集里**每个**节点都得被认成源 —— 否则只有一个节点算源，其余源节点的端口不会被压住、
 * 自己还会被当成可连目标（3D 反馈乱亮）。
 */
describe('isConnectionSource —— 单源与批量多源', () => {
  it('没有拖线（active 为 null）→ 谁都不是源', () => {
    expect(isConnectionSource(null, 'a')).toBe(false)
    expect(isConnectionSource(undefined, 'a')).toBe(false)
  })

  it('单源：只认 sourceNodeId 那一个（与从前完全一致）', () => {
    const a: ActiveConnection = { sourceNodeId: 'a', sourceHandle: 'source' }
    expect(isConnectionSource(a, 'a')).toBe(true)
    expect(isConnectionSource(a, 'b')).toBe(false)
  })

  it('多源：sourceNodeIds 里的每个都算源', () => {
    const a: ActiveConnection = {
      sourceNodeId: 'a',
      sourceNodeIds: ['a', 'b', 'c'],
      sourceHandle: 'source',
    }
    expect(isConnectionSource(a, 'a')).toBe(true)
    expect(isConnectionSource(a, 'b')).toBe(true)
    expect(isConnectionSource(a, 'c')).toBe(true)
    expect(isConnectionSource(a, 'd')).toBe(false)
  })

  it('空的 sourceNodeIds 视为"没给"→ 回落到单源语义（防御半套脏值）', () => {
    const a: ActiveConnection = { sourceNodeId: 'a', sourceNodeIds: [], sourceHandle: 'source' }
    expect(isConnectionSource(a, 'a')).toBe(true)
    expect(isConnectionSource(a, 'b')).toBe(false)
  })
})
