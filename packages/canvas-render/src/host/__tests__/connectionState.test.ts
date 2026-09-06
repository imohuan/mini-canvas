import { describe, it, expect } from 'vitest'
import {
  createConnectionState,
  beginConnection,
  endConnection,
  getSourceHandle,
  hoverWriter,
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
