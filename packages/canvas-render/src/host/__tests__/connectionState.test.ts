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
    expect(s.suppressHandles.value).toBe(false)
  })

  it('begin 记录源 + 压端口 + isConnecting 派生 true', () => {
    const s = createConnectionState()
    const a: ActiveConnection = { sourceNodeId: 'a', sourceHandle: 'source' }
    s.hoverNode.value = { nodeId: 'x', status: 'valid', zone: 'body', flowPosition: { x: 1, y: 2 } }
    beginConnection(s, a)
    expect(s.isConnecting.value).toBe(true)
    expect(s.activeConnection.value).toEqual(a)
    expect(s.suppressHandles.value).toBe(true)
    expect(s.hoverNode.value).toBeNull()
    expect(getSourceHandle(s)).toBe('source')
  })

  it('end 全清空', () => {
    const s = createConnectionState()
    beginConnection(s, { sourceNodeId: 'a', sourceHandle: 'target' })
    endConnection(s)
    expect(s.isConnecting.value).toBe(false)
    expect(s.activeConnection.value).toBeNull()
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

describe('lastDrop 松开落点建边快照', () => {
  it('初始为 null', () => {
    const s = createConnectionState()
    expect(s.lastDrop.value).toBeNull()
  })

  it('begin 会重置 lastDrop(null)，避免上一次手势残留误触发 connect-end 建边', () => {
    const s = createConnectionState()
    s.lastDrop.value = { source: 'a', target: 'b', zone: 'body' }
    beginConnection(s, { sourceNodeId: 'a', sourceHandle: 'source' })
    expect(s.lastDrop.value).toBeNull()
  })

  it('end 不清 lastDrop——CanvasHost.onConnectEnd 需先读 lastDrop 判 body/snap 建边，再由宿主手动置空', () => {
    const s = createConnectionState()
    const drop = { source: 'a', target: 'b', zone: 'body' as const }
    s.lastDrop.value = drop
    endConnection(s)
    expect(s.lastDrop.value).toEqual(drop) // endConnection 不得吃掉待决策的落点
    // 宿主读完置空 → 下一次手势从 null 开始
    s.lastDrop.value = null
    expect(s.lastDrop.value).toBeNull()
  })
})
