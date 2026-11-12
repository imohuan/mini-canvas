/**
 * nodeVisualSync —— resize 拖拽中把视觉尺寸同步进 VueFlow 的回归测试。
 *
 * 线上问题（用户反馈）：拖拽 resize 时端口位置/相连边端点不跟手 ——
 * VueFlow 内部记的节点尺寸没更新，handle 与边仍按旧尺寸算。
 * 实测：拖拽中 VueFlow dimensions 恒为旧值；调 updateNode(style)+updateNodeInternals 后立刻跟上。
 *
 * 本测试锁死"两步都要做"：
 *   ① updateNode(id, { style: {width,height} }) 写新尺寸；
 *   ② updateNodeInternals([id]) 强制重算 handle / 相连边。
 */
import { describe, expect, it, vi } from 'vitest'
import { applyNodeVisualSize } from '../nodeVisualSync'

function makeApi() {
  return { updateNode: vi.fn(), updateNodeInternals: vi.fn() }
}

describe('applyNodeVisualSize', () => {
  it('同时写尺寸并强制重算内部（缺一不可）', () => {
    const api = makeApi()
    applyNodeVisualSize(api, '1', 480, 360)

    expect(api.updateNode).toHaveBeenCalledWith('1', { style: { width: '480px', height: '360px' } })
    expect(api.updateNodeInternals).toHaveBeenCalledWith(['1'])
  })

  it('先写尺寸再重算（顺序：尺寸是重算的输入）', () => {
    const order: string[] = []
    const api = {
      updateNode: vi.fn(() => order.push('size')),
      updateNodeInternals: vi.fn(() => order.push('internals')),
    }
    applyNodeVisualSize(api, 'a', 100, 100)
    expect(order).toEqual(['size', 'internals'])
  })

  it('非正尺寸忽略（拖拽中间态可能算出 0，不必打扰 VueFlow）', () => {
    const api = makeApi()
    applyNodeVisualSize(api, '1', 0, 100)
    applyNodeVisualSize(api, '1', 100, 0)
    applyNodeVisualSize(api, '1', -5, -5)
    expect(api.updateNode).not.toHaveBeenCalled()
    expect(api.updateNodeInternals).not.toHaveBeenCalled()
  })
})
