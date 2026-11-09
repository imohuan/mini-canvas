/**
 * Agent 对话的**任务化**端到端（用户 2026-11-09：点发送 = 提交任务；边生成边写节点）。
 *
 * 这条链断过一次：第一版把整段生成塞进 provider.submit 里跑完，TaskManager
 * 在长跑 submit 期间不写任何进度帧 —— 用户看到的就是「一直卡在 0%」。
 * 所以这里用真后台 + 内置 test 模型（不需要任何密钥）走一遍完整链路：
 *   下单 → 节点立刻 running 0% → 进度真的往上走 → 正文流式写进 data.text → 终态 done。
 *
 * 只替换「模型流」这一处外部依赖（test 模型就是本地假的 OpenAI 端点，本来就是真的），
 * 其余全是生产代码：TaskManager、jobs 路由、CanvasDocument、SSE 事件。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createCloudServer, type CloudServer } from '../server.js'
import { AGENT_CHAT_ACTION_ID } from '../tasks/agentChatProvider.js'

let dir: string
let srv: CloudServer

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-agent-chat-'))
  srv = await createCloudServer({ dir, watchProviders: false, port: 0 })
  await srv.start()
})

afterEach(async () => {
  srv.stop()
  // 终态帧落下时后台可能还有一拍 SSE / 写盘在路上；直接 rm 会撞 ENOTEMPTY。
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

/** 造一张画布，里面放一个文本节点 */
async function seedTextNode(canvasId: string, nodeId: string): Promise<void> {
  await fs.mkdir(path.join(dir, 'canvases', canvasId), { recursive: true })
  await fs.writeFile(
    path.join(dir, 'canvases', canvasId, 'canvas.json'),
    JSON.stringify({ nodes: [{ id: nodeId, type: 'text', position: { x: 0, y: 0 }, data: {} }], edges: [], revision: 1 }),
    'utf8',
  )
}

interface NodeSnap { data: Record<string, unknown> }

/** 读节点（走生产只读接口） */
async function readNode(canvasId: string, nodeId: string): Promise<NodeSnap> {
  const res = await srv.app.fetch(new Request('http://localhost/api/canvases/' + canvasId))
  const body = (await res.json()) as { nodes?: Array<{ id: string; data?: Record<string, unknown> }> }
  const hit = (body.nodes ?? []).find((n) => n.id === nodeId)
  return { data: hit?.data ?? {} }
}

async function post(body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await srv.app.fetch(new Request('http://localhost/api/jobs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }))
  return { status: res.status, json: (await res.json()) as Record<string, unknown> }
}

/** 等条件成立（生产代码是异步跑的，只能用轮询观察） */
async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 30_000): Promise<T> {
  const started = Date.now()
  for (;;) {
    const v = await fn()
    if (ok(v)) return v
    if (Date.now() - started > ms) throw new Error('等待超时：' + JSON.stringify(v))
    await new Promise((r) => setTimeout(r, 100))
  }
}

describe('agent:chat 任务化：后台边生成边写节点', () => {
  it('下单后节点立刻 running 0%，随后进度增长、正文流式写入，最后 done', async () => {
    const canvasId = 'agentchat1'
    const nodeId = 't1'
    await seedTextNode(canvasId, nodeId)

    const r = await post({
      canvasId,
      nodeId,
      actionId: AGENT_CHAT_ACTION_ID,
      prompts: [{ type: 'prompt', value: '数到五' }],
      // test 模型：让它慢慢吐字，好观察「边生成边写」
      values: { agentModel: 'test模型', agentProvider: 'test', duration: 1500 },
    })
    expect(r.status).toBe(200)
    expect(typeof r.json.jobId).toBe('string')

    // ① 提交帧：立刻能看到 running
    const first = await readNode(canvasId, nodeId)
    const rs0 = first.data.runState as { status?: string } | undefined
    expect(rs0?.status).toBe('running')
    // 上一次的正文必须已经清掉（否则模型吐字前节点上挂着旧回答 —— 实测踩到）
    expect(String(first.data.text ?? '')).toBe('')

    // ② 进度真的会动（不是卡在 0%）
    const advanced = await waitFor(
      async () => await readNode(canvasId, nodeId),
      (n) => {
        const rs = n.data.runState as { progress?: number } | undefined
        return typeof rs?.progress === 'number' && rs.progress > 0
      },
    )
    const rsMid = advanced.data.runState as { status?: string; progress?: number }
    expect(rsMid.status).toBe('running')
    expect(rsMid.progress!).toBeGreaterThan(0)

    // ③ 正文流式写进 data.text（生成中就应该已经有内容，不用等终态）
    const streaming = await waitFor(
      async () => await readNode(canvasId, nodeId),
      (n) => typeof n.data.text === 'string' && (n.data.text as string).length > 0,
    )
    expect(typeof streaming.data.text).toBe('string')

    // ④ 终态：done 100%，正文完整非空
    const done = await waitFor(
      async () => await readNode(canvasId, nodeId),
      (n) => (n.data.runState as { status?: string } | undefined)?.status === 'done',
    )
    const rsDone = done.data.runState as { status?: string; progress?: number }
    expect(rsDone.status).toBe('done')
    expect(rsDone.progress).toBe(100)
    expect(typeof done.data.text).toBe('string')
    expect((done.data.text as string).trim().length).toBeGreaterThan(0)
  }, 60_000)

  it('任务完成后 job 记录 done，且 result 带最终正文', async () => {
    const canvasId = 'agentchat2'
    const nodeId = 't2'
    await seedTextNode(canvasId, nodeId)
    const r = await post({
      canvasId,
      nodeId,
      actionId: AGENT_CHAT_ACTION_ID,
      prompts: [{ type: 'prompt', value: '你好' }],
      values: { agentModel: 'test模型', agentProvider: 'test' },
    })
    const jobId = String(r.json.jobId)
    const job = await waitFor(
      async () => (await (await srv.app.fetch(new Request('http://localhost/api/jobs/' + jobId))).json()) as { job?: { status?: string; result?: { text?: string } } },
      (b) => b.job?.status === 'done',
    )
    expect((job.job!.result?.text ?? '').trim().length).toBeGreaterThan(0)
  }, 60_000)
})
