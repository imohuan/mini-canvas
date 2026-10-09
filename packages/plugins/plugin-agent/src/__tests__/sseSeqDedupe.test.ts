/**
 * SSE 帧级去重（`id: <seq>`）—— 回归测试。
 *
 * 真 bug（代码审查 + 探针实测）：send 响应与常驻流订阅的是**同一个** hub 通道，
 * 同一条事件因此会到前端两次；两端都不看 seq，于是助手正文 / 工具卡片被应用两遍
 * （探针用真实 ChatModel 跑出的正文是 `AAABBBBBB`）。
 *
 * 修法：后端每帧带 `id: <seq>`（Hono 的输出顺序是 `data:` 在前、`id:` 在后），
 * 客户端按 `acceptSeq` 去重、按 `onSeq` 推进重连水位。
 */
import { describe, it, expect } from 'vitest'
import { AgentApi, type ChatEvent } from '../agentApi.js'

/** 造一个吐固定 SSE 字节的响应（帧格式与 Hono 的 writeSSE 一致：data 在前、id 在后） */
function sseResponse(body: string): typeof fetch {
  return (async () =>
    new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })) as typeof fetch
}

const NL = String.fromCharCode(10)
const SEP = String.fromCharCode(10, 10)
const frame = (seq: number, ev: unknown): string =>
  'data: ' + JSON.stringify(ev) + NL + 'id: ' + seq + SEP

describe('consumeSse：按 seq 去重、推进水位', () => {
  it('重复投递的同一 seq 只应用一次（不重复写正文）', async () => {
    const api = new AgentApi({ fetchImpl: sseResponse(frame(1, { type: 'text', text: 'AA', final: true }) + frame(1, { type: 'text', text: 'AA', final: true })) })
    const seen: ChatEvent[] = []
    let applied = 0
    const sink = { acceptSeq: (n: number) => (n <= applied ? false : ((applied = n), true)) }
    await api.streamSession('c1', 's1', 0, (e) => seen.push(e), undefined, sink)
    expect(seen).toHaveLength(1)
    expect(applied).toBe(1)
  })

  it('onSeq 收到已应用的 seq（重连水位往上推）', async () => {
    const api = new AgentApi({ fetchImpl: sseResponse(frame(5, { type: 'notice', message: 'a' }) + frame(6, { type: 'notice', message: 'b' })) })
    const seqs: number[] = []
    await api.streamSession('c1', 's1', 4, () => undefined, undefined, { onSeq: (n) => seqs.push(n) })
    expect(seqs).toEqual([5, 6])
  })

  it('没有 id 的帧（老服务 / 保活帧）照常投递，不当重复丢掉', async () => {
    const api = new AgentApi({
      fetchImpl: sseResponse('data: {"type":"notice","message":"no-id"}' + SEP + frame(2, { type: 'notice', message: 'with-id' })),
    })
    const seen: ChatEvent[] = []
    let applied = 0
    const sink = { acceptSeq: (n: number) => (n <= applied ? false : ((applied = n), true)) }
    await api.streamSession('c1', 's1', 0, (e) => seen.push(e), undefined, sink)
    expect(seen.map((e) => (e as { message?: string }).message)).toEqual(['no-id', 'with-id'])
  })
})
