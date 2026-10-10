// 文件：packages/docs/public/examples/canvas-data/connection/plugin-conn-demo/src/__tests__/connRules.test.ts
// 格式：TypeScript 测试（vitest，environment: 'node'）
// 位置：连接规则的逐条验证 —— 纯函数，不需要浏览器

import { describe, expect, it } from 'vitest'
import { Context, createCanvasBasePlugin, MemoryStorageAdapter } from '@mini-canvas/canvas-data'
import type { DocService } from '@mini-canvas/canvas-data'
import { checkEdge } from '../connRules'
import * as connDemo from '../index'

async function boot() {
  const ctx = new Context({ dev: true })
  ctx.plugin(createCanvasBasePlugin({ adapter: new MemoryStorageAdapter() }).plugin)
  ctx.plugin(connDemo)
  await ctx.start()
  const doc = ctx.get<DocService>('doc')
  // 造一个图片节点当上游（只声明产出 image，不需要任何组件）
  doc.registerType({
    type: 'image',
    label: '图片',
    defaultSize: { w: 320, h: 240 },
    outputs: [{ port: 'source', contentType: 'image' }],
  })
  return { ctx, doc }
}

describe('连接校验（纯函数，Node 可测）', () => {
  it('类型不接 → type-not-accepted；接图片 → ok，且第二次是 duplicate', async () => {
    const { doc } = await boot()
    const img = doc.createNode('image', { x: 0, y: 0 })
    const badge = doc.createNode('badge', { x: 300, y: 0 })

    // 造一个文本节点当“类型不匹配”的源
    doc.registerType({ type: 'text', label: '文本', defaultSize: { w: 200, h: 80 } })
    const txt = doc.createNode('text', { x: 0, y: 200 })

    expect(checkEdge(doc, { source: txt, target: badge }).reason).toBe('type-not-accepted')
    expect(checkEdge(doc, { source: img, target: badge }).ok).toBe(true)

    // 真的连上以后再查，就是重复了
    doc.connectEdge({ source: img, target: badge })
    expect(checkEdge(doc, { source: img, target: badge }).reason).toBe('duplicate')
  })

  it('徽章没有输出口 → 连它的下游是 no-source-port', async () => {
    const { doc } = await boot()
    const badge = doc.createNode('badge', { x: 0, y: 0 })
    const img = doc.createNode('image', { x: 300, y: 0 })
    expect(checkEdge(doc, { source: badge, target: img }).reason).toBe('no-source-port')
  })

  it('自己连自己 → self-loop', async () => {
    const { doc } = await boot()
    const img = doc.createNode('image', { x: 0, y: 0 })
    expect(checkEdge(doc, { source: img, target: img }).reason).toBe('self-loop')
  })

  it('capacity: 1 满额时放行（挤老边），connectEdge 返回 evictedEdgeId', async () => {
    const { doc } = await boot()
    const a = doc.createNode('image', { x: 0, y: 0 })
    const b = doc.createNode('image', { x: 0, y: 200 })
    const badge = doc.createNode('badge', { x: 400, y: 0 })
    doc.connectEdge({ source: a, target: badge })
    const second = doc.connectEdge({ source: b, target: badge })
    expect(second.status).toBe('ok')
    // 满额默认挤掉最老一条（FIFO），而不是拒
    expect(second.evictedEdgeId).toBeTruthy()
    expect(doc.getEdges()).toHaveLength(1)
  })
})

