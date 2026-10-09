/**
 * 「引用标签被点了」这条系统事件的名字与载荷（用户口径 2026-10-08）。
 *
 * 为什么要测：名字或字段口径写错的表现是「点了没反应」—— 事件是广播，没人应答不报错，
 * 浏览器里很难定位；而应用层是**按名 + 按字段**监听的，两边必须逐字一致。
 */
import { describe, expect, it } from 'vitest'
import { REF_CLICK_EVENT, refClickPayloadOf } from '../refClickEvents'
import { hasKnownEvent } from '@mini-canvas/kernel'

describe('事件名', () => {
  it('带 agent: 前缀（表示由本插件发出）', () => {
    expect(REF_CLICK_EVENT).toBe('agent:ref-click')
  })

  it('已登记进 EventBus 白名单（dev 下 emit 它不该 warn）', () => {
    expect(hasKnownEvent(REF_CLICK_EVENT)).toBe(true)
  })
})

describe('refClickPayloadOf', () => {
  it('资产文件：带 path 与 ext', () => {
    expect(refClickPayloadOf({ refType: 'asset', name: '图.png', path: '/x/ab.png', ext: 'png', folderId: 'f1' }))
      .toEqual({ type: 'asset', name: '图.png', path: '/x/ab.png', ext: 'png', folderId: 'f1' })
  })

  it('资产文件夹：带 folderId、没有 ext（消费方靠这一点认出是目录）', () => {
    expect(refClickPayloadOf({ refType: 'asset', name: '待分类资产', folderId: 'f1' }))
      .toEqual({ type: 'asset', name: '待分类资产', folderId: 'f1' })
  })

  it('节点引用：带 canvasId 之外的 nodeId', () => {
    expect(refClickPayloadOf({ refType: 'node', name: '花海', nodeId: '35' }))
      .toEqual({ type: 'node', name: '花海', nodeId: '35' })
  })

  it('没带引用字段（普通标签）→ null，调用方据此不发事件', () => {
    expect(refClickPayloadOf({ name: '普通标签' })).toBe(null)
    expect(refClickPayloadOf({ refType: '', name: 'x' })).toBe(null)
  })

  it('空字段不输出（保持最小载荷）', () => {
    expect(refClickPayloadOf({ refType: 'mcp', name: 'canvas' })).toEqual({ type: 'mcp', name: 'canvas' })
  })
})
