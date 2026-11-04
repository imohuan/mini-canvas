/**
 * 应用级 / 画布级拆分。
 *
 * 验收要求（docs/问题整理/18-…）：项目页没有 doc 也要能查历史；
 * 画布读写（save 适配器、动作清单、实时同步）只能在 onCanvasReady 之后发生。
 */
import { describe, expect, it } from 'vitest'
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
})
