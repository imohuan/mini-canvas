/**
 * 参考图上传 —— cloud-server 与 web2api 是**两个独立服务**（可能不在同一台机器）。
 *
 * 用户口径：先上传拿到地址，再用地址生成任务；任务也支持 data URL。
 * 这里锁住 web2api provider 的行为：
 *  - data URL / web2api 自己的资源地址 / 纯相对文件名 → 原样交给 web2api（它会落盘或当本机文件）；
 *  - 其它（cloud-server 地址 / 外部 URL）→ 先经 `system/upload-resource` 上传成 web2api 本机文件，
 *    用返回的 `referenceUrl`（`/<hash>`）下单 —— 这样 web2api 够不到 cloud-server 也没关系。
 */
import { describe, it, expect } from 'vitest'
import { createWeb2ApiProvider } from '../providers/web2api/index'
import type { ActionDef } from '../providers/types'

const EP = 'http://localhost:8033/mcp'

/** 记录所有 tools/call 的假 fetch；upload-resource 回一个固定 referenceUrl */
function fakeFetch() {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = []
  const impl = (async (_url: string, init?: RequestInit) => {
    // 非 MCP 地址 = 下载参考图（provider 用注入的 fetch 去取字节）→ 回一小段图片字节
    if (!String(_url).includes('/mcp')) {
      return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { 'content-type': 'image/png' } })
    }
    const body = JSON.parse(String(init?.body ?? '{}')) as { method?: string; id?: number; params?: { name?: string; arguments?: Record<string, unknown> } }
    if (body.method === 'initialize') {
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json', 'mcp-session-id': 's' } })
    }
    if (body.method === 'notifications/initialized') return new Response('', { status: 202 })
    if (body.method === 'tools/call') {
      const name = body.params?.name ?? ''
      calls.push({ name, args: body.params?.arguments ?? {} })
      if (name === 'system/upload-resource') {
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { structuredContent: { referenceUrl: '/abc123.png', url: '/api/resources/uploads/abc123.png' } } }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      // 任务工具：回一个 taskId
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { structuredContent: { taskId: 't1' } } }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  return { impl, calls }
}

const IMG: ActionDef = {
  id: 'web2api:doubao-image', title: '图', tool: 'doubao/chat-auto', promptMode: 'chat-auto', mediaMode: 'image', nodeTypes: ['image'],
}

describe('参考图上传', () => {
  it('cloud-server 地址 → 先上传，用返回的 referenceUrl 下单', async () => {
    const { impl, calls } = fakeFetch()
    const provider = createWeb2ApiProvider({ endpoint: EP, fetchImpl: impl })
    const r = await provider.submit(IMG, {
      canvasId: 'c1', nodeId: 'n1', actionId: IMG.id, prompt: '画',
      resources: [{ kind: 'image', url: 'http://127.0.0.1:8865/api/canvases/c1/resources/x.png' }],
    })
    expect(r).toEqual({ taskId: 't1' })
    expect(calls.some((c) => c.name === 'system/upload-resource')).toBe(true)
    const taskCall = calls.find((c) => c.name === 'doubao/chat-auto')!
    expect(taskCall.args.referenceImages).toEqual(['/abc123.png'])
  })

  it('data URL 也走上传（用户口径：先上传拿地址）；web2api 资源地址 / 相对文件名原样用', async () => {
    const { impl, calls } = fakeFetch()
    const provider = createWeb2ApiProvider({ endpoint: EP, fetchImpl: impl })
    await provider.submit(IMG, {
      canvasId: 'c1', nodeId: 'n1', actionId: IMG.id, prompt: '画',
      resources: [
        { kind: 'image', url: 'data:image/png;base64,AAAA' },
        { kind: 'image', url: '/api/resources/uploads/abc123.png' },
        { kind: 'image', url: '/def456.png' },
      ],
    })
    // data URL 会上传；另两个已经在 web2api 本机、直接用
    const ups = calls.filter((c) => c.name === 'system/upload-resource')
    expect(ups.length).toBe(1)
    expect(ups[0].args.content).toBe('data:image/png;base64,AAAA')
    const taskCall = calls.find((c) => c.name === 'doubao/chat-auto')!
    expect(taskCall.args.referenceImages).toEqual(['/abc123.png', '/api/resources/uploads/abc123.png', '/def456.png'])
  })
})
