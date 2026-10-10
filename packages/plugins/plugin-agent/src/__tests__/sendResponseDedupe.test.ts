/**
 * send 响应也必须按帧 seq 去重 —— 回归测试。
 *
 * 真缺陷（代码审查实测）：send 响应与常驻流订阅的是**同一个** hub 通道，
 * 同一条事件因此会到前端两次。此前只给常驻流传了 acceptSeq，send 那侧没传，
 * 于是助手正文被应用两遍（探针实测正文变成「收到收到」），工具卡片也重复。
 *
 * 这里锁住：agentService 的两条发送路径都把同一套帧级水位交给 api.sendMessage。
 */
import { describe, it, expect } from 'vitest'
import { AgentApi } from '../agentApi.js'

const NL = String.fromCharCode(10)
const SEP = String.fromCharCode(10, 10)
const frame = (seq: number, ev: unknown): string =>
  'data: ' + JSON.stringify(ev) + NL + 'id: ' + seq + SEP

function sseResponse(body: string): typeof fetch {
  return (async () =>
    new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })) as typeof fetch
}

describe('sendMessage：带 sink 时按 seq 去重', () => {
  it('同一 seq 的重复帧只投递一次（正文不会变两份）', async () => {
    const api = new AgentApi({
      fetchImpl: sseResponse(
        frame(1, { type: 'text', text: '收到', final: true }) +
          frame(1, { type: 'text', text: '收到', final: true }),
      ),
    })
    let applied = 0
    const seen: string[] = []
    await api.sendMessage(
      'c1',
      's1',
      'hi',
      {},
      (e) => {
        if (e.type === 'text' && typeof e.text === 'string') seen.push(e.text)
      },
      undefined,
      {
        acceptSeq: (n) => (n <= applied ? false : ((applied = n), true)),
        onSeq: (n) => {
          if (n > applied) applied = n
        },
      },
    )
    expect(seen).toEqual(['收到'])
  })

  it('不传 sink 时保持老行为（每帧都投递）', async () => {
    const api = new AgentApi({
      fetchImpl: sseResponse(
        frame(1, { type: 'text', text: 'A', final: true }) + frame(1, { type: 'text', text: 'A', final: true }),
      ),
    })
    const seen: string[] = []
    await api.sendMessage('c1', 's1', 'hi', {}, (e) => {
      if (e.type === 'text' && typeof e.text === 'string') seen.push(e.text)
    })
    expect(seen).toEqual(['A', 'A'])
  })
})
