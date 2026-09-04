import { describe, it, expect } from 'vitest'
import { Context } from '../../Context'
import { NodeStore } from '../../../services/nodeStore'
import { NodeRegistry } from '../nodeRegistry'
import { registerNodeType } from '../registerNodeType'
import { resolveSegment } from '../nodeRenderer'
import type { PluginScope } from '../../types'

/** 测试 content stub（内核不 import Vue，opaque 句柄即可） */
const TextContentStub = { name: 'TextContent' }

/** 造一个"能跑插件 setup"的最小 ctx：注入 nodeStore + nodeRegistry，start 触发 setup */
async function bootWithSetup(setup: (ctx: PluginScope) => void): Promise<{
  ctx: Context
  nodeStore: NodeStore
  registry: NodeRegistry
}> {
  const ctx = new Context()
  const nodeStore = new NodeStore()
  const registry = new NodeRegistry()
  ctx.inject('nodeStore', nodeStore)
  ctx.inject('nodeRegistry', registry)
  ctx.plugin({ name: 'under-test', setup })
  await ctx.start()
  return { ctx, nodeStore, registry }
}

describe('registerNodeType（插件"一次自描述"节点注册接缝）', () => {
  it('一次调用同时落 nodeStore(数据) + nodeRegistry(展示 content)', async () => {
    const { nodeStore, registry } = await bootWithSetup((ctx) => {
      registerNodeType(ctx, {
        type: 'text',
        label: '文本',
        defaultSize: { w: 300, h: 200 },
        segments: { content: TextContentStub },
      })
    })

    // 数据侧：type 可建、label/尺寸/连接约束齐
    const def = nodeStore.types.get('text')
    expect(def?.label).toBe('文本')
    expect(def?.defaultSize).toEqual({ w: 300, h: 200 })

    // 展示侧：NodeRenderer 能解析出 content 组件（宿主免手 seed）
    expect(resolveSegment(registry, 'text', 'content')).toBe(TextContentStub)
    expect(registry.has('text')).toBe(true)
  })

  it('只给 segments 为空时仍注册数据侧，跳过展示（纯数据场景可用）', async () => {
    const { nodeStore, registry } = await bootWithSetup((ctx) => {
      registerNodeType(ctx, { type: 'meta', label: 'M', defaultSize: { w: 1, h: 1 } })
    })
    expect(nodeStore.types.has('meta')).toBe(true)
    expect(registry.has('meta')).toBe(false)
  })

  it('缺 nodeRegistry 服务（纯数据 ctx）时只落数据、不抛', async () => {
    const ctx = new Context()
    const nodeStore = new NodeStore()
    ctx.inject('nodeStore', nodeStore)
    ctx.plugin({
      name: 'no-registry',
      setup: (c) =>
        registerNodeType(c, { type: 'x', label: 'X', defaultSize: { w: 1, h: 1 }, segments: { content: TextContentStub } }),
    })
    await ctx.start()
    expect(nodeStore.types.has('x')).toBe(true)
  })

  it('同 type 重复注册抛错（防覆盖，与 registerType 语义一致）', async () => {
    await expect(
      bootWithSetup((ctx) => {
        registerNodeType(ctx, { type: 'text', label: 'a', defaultSize: { w: 1, h: 1 }, segments: { content: TextContentStub } })
        registerNodeType(ctx, { type: 'text', label: 'b', defaultSize: { w: 1, h: 1 } })
      }),
    ).rejects.toThrow(/already registered/i)
  })
})
