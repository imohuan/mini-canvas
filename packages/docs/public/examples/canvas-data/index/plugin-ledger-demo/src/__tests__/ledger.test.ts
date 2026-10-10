// 文件：packages/docs/public/examples/canvas-data/index/plugin-ledger-demo/src/__tests__/ledger.test.ts
// 格式：TypeScript 测试（vitest，environment: 'node'）
// 位置：证明“数据层脱离浏览器也能完整验证”

import { describe, expect, it } from 'vitest'
import { MemoryStorageAdapter } from '@mini-canvas/canvas-data'
import type { DocService } from '@mini-canvas/canvas-data'
import { bootLedger } from '../host'

describe('只装数据层的画布', () => {
  it('建节点、连边、撤销、落盘都能在 Node 里跑', async () => {
    const adapter = new MemoryStorageAdapter()
    const { ctx, base, stop } = await bootLedger(adapter)
    const doc = ctx.get<DocService>('doc')

    // 一次事务：建两个账目 + 连一条边
    const [a, b] = doc.transaction('test:two', (tx) => {
      const x = tx.createNode('ledger-entry', { x: 0, y: 0 })
      const y = tx.createNode('ledger-entry', { x: 240, y: 0 })
      const r = tx.connectEdge({ source: x, target: y })
      expect(r.status).toBe('ok')
      return [x, y]
    })

    // 重复边会被守门人挡下（同一个 canonical 连接只允许一条）
    expect(doc.connectEdge({ source: a!, target: b! }).status).toBe('duplicate')

    expect(doc.getNodes()).toHaveLength(2)
    expect(doc.canUndo()).toBe(true)

    // 一次撤销要能把“两个节点 + 一条边”整批退掉
    doc.undo()
    expect(doc.getNodes()).toHaveLength(0)

    // set 只是入队；flush 之后才真的写到 adapter 上（物理 key 已带 canvas: 前缀）
    await base.services.save.flush()
    await stop()
  })
})

