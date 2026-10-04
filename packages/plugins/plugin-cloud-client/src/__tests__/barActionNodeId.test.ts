/**
 * 回归：云端动作下单必须带上**节点 id**。
 *
 * 复现的是用户实测报的 bug：在节点底栏点「发送」后，后台回 `{ ok:false, error:'缺少 nodeId' }`。
 *
 * 根因：底栏的动作契约把节点 id 放在 `run(input, runCtx)` 的**第二个参数**
 * （`BarRunContext.nodeId`，见 plugin-bottom-bar 的 barTypes / taskRuntime），
 * 而本插件以前写的是 `run(input)` 读 `input.nodeId` —— 那个键**从来不存在**，
 * 于是永远兜底成空串发出去，服务端判空即拒（缺少 nodeId）。
 *
 * 这里在插件自身的边界上验证：动作真正发给 /api/jobs 的 body 里，nodeId 是发起节点那个。
 */
import { describe, it, expect, afterEach } from 'vitest'
import { Context } from '@mini-canvas/canvas-data'
import { cloudClientPlugin } from '../plugin'
import type { BarActionLike } from '../actions'

/** 记录请求的假 fetch（不起真服务；Node 里相对地址必须自己接，故整体替换 globalThis.fetch） */
function installFakeFetch() {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    const u = String(url)
    calls.push({ url: u, ...(init ? { init } : {}) })
    const body = ((): unknown => {
      if (u.includes('/api/actions')) return { ok: true, version: 1, changed: true, actions: [SERVER_ACTION] }
      if (u.includes('/api/jobs')) return { ok: true, jobId: 'job-1', status: 'running' }
      if (u.includes('/api/canvases/')) return { nodes: [], edges: [], view: null }
      return { ok: true }
    })()
    return new Response(JSON.stringify(body), { status: 200 })
  }) as typeof fetch
  return { calls, restore: () => { globalThis.fetch = realFetch } }
}

/** 后台清单里的一条动作（图片节点可用） */
const SERVER_ACTION = {
  id: 'cloud:demo-image',
  title: '云端演示模型',
  nodeTypes: ['image'],
  needsPrompt: true,
}

/** 抓住插件注册进底栏的动作（不装 plugin-bottom-bar，只按服务名提供一个注册口） */
function captureBarActions(): { registered: BarActionLike[]; service: unknown } {
  const registered: BarActionLike[] = []
  const service = {
    register(_scope: unknown, a: BarActionLike) {
      registered.push(a)
    },
    registerApplier() {},
  }
  return { registered, service }
}

/** 最小 doc 面（插件只用到这几个读口与 types） */
function docStub() {
  return {
    getNodes: () => [] as unknown[],
    getEdges: () => [] as unknown[],
    getNode: (_id: string) => undefined,
    replaceAll: () => {},
    types: { has: (_t: string) => true },
  }
}

let restoreFetch: (() => void) | null = null
afterEach(() => {
  restoreFetch?.()
  restoreFetch = null
})

async function waitFor(pred: () => boolean, tries = 100): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (pred()) return
    await new Promise((r) => setTimeout(r, 1))
  }
}

describe('云端动作下单带节点 id', () => {
  it('run(input, runCtx) 时把 runCtx.nodeId 发给 /api/jobs', async () => {
    const { calls, restore } = installFakeFetch()
    restoreFetch = restore
    const { registered, service } = captureBarActions()

    const ctx = new Context()
    ctx.inject('doc', docStub() as never)
    ctx.inject('nodeBar', service as never)
    // 本插件的 shims 把 Config 声明为 unknown（产物自包含、不 import 内核类型），
    // 这里按结构塞进真实内核即可。
    ctx.plugin(cloudClientPlugin as never)
    await ctx.start()
    // 清单是异步拉的：等动作落进注册口
    await waitFor(() => registered.some((a) => a.id === SERVER_ACTION.id))

    const action = registered.find((a) => a.id === SERVER_ACTION.id)
    expect(action, '云端动作没注册进底栏').toBeTruthy()

    const NODE_ID = 'node-42'
    await (action!.run as (i: unknown, c: unknown) => Promise<unknown>)(
      { prompt: '画只猫' },
      { nodeId: NODE_ID, nodeType: 'image', signal: new AbortController().signal, onProgress: () => {}, readData: () => ({}) },
    )

    const submit = calls.find((c) => c.url.includes('/api/jobs') && c.init?.method === 'POST')
    expect(submit, '没有发出下单请求').toBeTruthy()
    const sent = JSON.parse(String(submit!.init?.body ?? '{}')) as { nodeId?: unknown }
    // 这就是服务端「缺少 nodeId」那条校验的前置条件：空串/undefined 都会被拒
    expect(sent.nodeId).toBe(NODE_ID)

    ctx.stop()
  })
})
