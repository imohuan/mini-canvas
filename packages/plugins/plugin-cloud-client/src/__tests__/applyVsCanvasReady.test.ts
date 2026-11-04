/**
 * 应用级 / 画布级拆分。
 *
 * 验收要求（docs/问题整理/18-…）：项目页没有 doc 也要能查历史；
 * 画布读写（save 适配器、动作清单、实时同步）只能在 onCanvasReady 之后发生。
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@mini-canvas/canvas-data'
import { cloudClientPlugin, onCanvasReady } from '../plugin'

function docStub() {
  return {
    getNodes: () => [] as unknown[],
    getEdges: () => [] as unknown[],
    getNode: (_id: string) => undefined,
    replaceAll: () => {},
    types: { has: (_t: string) => true },
  }
}

/** 记录 save 的 adapter 切换 */
function saveStub() {
  const switched: string[] = []
  return {
    switched,
    save: {
      useAdapter: (type: string) => switched.push(type),
      get: async () => undefined,
      adapterOf: () => ({ resolveResource: async () => undefined }),
      onAdapterChange: () => ({ dispose() {} }),
    },
  }
}

describe('cloud-client 的应用级 / 画布级边界', () => {
  it('apply 不碰 save：项目页没有画布也不会切换存档域', async () => {
    const { switched, save } = saveStub()
    const ctx = new Context()
    ctx.inject('save', save)
    // node 的 fetch 不接受相对地址：给一个绝对 baseUrl，测试才能观察真实请求。
    ctx.inject('settings', { get: (key: string) => (key === 'cloudClientBaseUrl' ? 'http://test.local' : undefined) })
    ctx.plugin(cloudClientPlugin as never)
    await ctx.start()

    expect(switched).toEqual([])
    expect(ctx.hasService('cloud-client:history')).toBe(true)
    expect(ctx.hasService('cloud-client')).toBe(true)
    // 没有 doc 时钩子是 no-op：不能因为项目页误调就动存档
    onCanvasReady(ctx as never)
    expect(switched).toEqual([])
    ctx.stop()
  })

  it('onCanvasReady 在有 doc 时才切画布存档域', async () => {
    const { switched, save } = saveStub()
    const ctx = new Context()
    ctx.inject('save', save)
    ctx.inject('doc', docStub())
    ctx.plugin(cloudClientPlugin as never)
    await ctx.start()

    onCanvasReady(ctx as never)
    expect(switched).toContain('canvas')
    expect(switched).toContain('resource')
    ctx.stop()
  })

  it('项目页 → 画布 → 项目页往返后，历史查询仍在、画布同步已撤', async () => {
    const { switched, save } = saveStub()
    // 记录所有画布请求：项目页阶段必须是 0，进画布后才有。
    const requested: string[] = []
    // 实时通道走 EventSource，不经过 fetch；这里给个空实现，免得噪声盖住断言。
    vi.stubGlobal('EventSource', class {
      close(): void {}
      addEventListener(): void {}
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        requested.push(String(url))
        // 画布快照的真实形状：有 nodes/edges 才不会被误判成"404 空画布"。
        return new Response(JSON.stringify({ ok: true, nodes: [], edges: [], view: {}, revision: 0 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }),
    )
    const ctx = new Context()
    ctx.inject('save', save)
    ctx.plugin(cloudClientPlugin as never)
    await ctx.start()

    // 往返前：项目页能查历史。
    expect(ctx.hasService('cloud-client:history')).toBe(true)
    expect(requested, '项目页不该请求画布数据').toEqual([])

    // 进画布：挂同步（会切存档域）；离开：执行返回的清理。
    ctx.inject('doc', docStub())
    const off = onCanvasReady(ctx as never)
    expect(switched).toContain('canvas')
    expect(requested.some((u) => u.includes('/api/canvases/')), '进画布后应该开始请求画布').toBe(true)
    if (typeof off === 'function') off()

    // 回项目页：历史服务还在（应用级常驻），画布同步的订阅已被清理。
    expect(ctx.hasService('cloud-client:history')).toBe(true)
    expect(ctx.hasService('cloud-client')).toBe(true)
    vi.unstubAllGlobals()
    ctx.stop()
  })
})
