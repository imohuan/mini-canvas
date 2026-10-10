/**
 * 审批命中时要把**那条工具**标成卡片（刷新后才不会缩成一行）—— 回归测试。
 *
 * 真缺陷（代码审查实测）：approve 回调从 payload 里读的是 `id`，而 SDK 的真字段是
 * `tool_call_id`（translate.ts 用的也是它）—— 于是 patchTool(card:true) 永远不执行，
 * 刷新后命中审批的工具缩成折叠行，与刚才看到的卡片样式对不上。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AgentRuntime } from '../agent/runtime.js'
import { AgentSessionStore } from '../agent/sessionStore.js'

let root: string
let store: AgentSessionStore

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'rt-card-'))
  store = new AgentSessionStore(root)
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('审批命中 ⇒ 那条工具被标成卡片', () => {
  it('patchTool 用的是 SDK 的 tool_call_id（不是 payload.id）', async () => {
    const session = {
      sessionId: 's-card',
      provider: 'p',
      modelId: 'm',
      async *run(_messages: unknown[], opts: { approve: (c: unknown) => Promise<'allow' | 'deny'> }) {
        yield { type: 'session_meta', payload: { session_id: 's-card', model_context_window: 1000 } }
        // 工具调用先落一行（translate 会把它翻成 tool_call 事件）
        yield {
          type: 'model_msg',
          payload: { type: 'tool_call', name: 'exec_command', arguments: '{"cmd":"ls"}', tool_call_id: 'call-xyz' },
        }
        // 审批：exec_command 默认 ask ⇒ 会挂起
        const decision = await opts.approve({
          payload: { name: 'exec_command', arguments: '{"cmd":"ls"}', tool_call_id: 'call-xyz' },
        })
        yield { type: 'model_msg', payload: { type: 'text', text: '决定 ' + decision, role: 'assistant' } }
      },
    }
    const rt = new AgentRuntime({
      root,
      store,
      agent: async () => ({ createSession: async () => session, resumeSession: async () => session }) as never,
      makeUserMessage: (text: string) => ({ kind: 'user', text }),
      log: () => undefined,
    } as never)
    await store.ensure('c1', { id: 's-card', title: 't', createdAt: 1, provider: 'p', modelId: 'm' })

    const ac = new AbortController()
    const drain = (async () => {
      for await (const ev of rt.run('c1', { canvasId: 'c1', sessionId: 's-card', text: '跑' }, ac.signal)) {
        void ev
      }
    })()
    // 等审批挂上，然后放行
    for (let i = 0; i < 100 && rt.pendingApprovals('c1', 's-card').length === 0; i++) {
      await new Promise((r) => setTimeout(r, 5))
    }
    const pending = rt.pendingApprovals('c1', 's-card')
    expect(pending).toHaveLength(1)
    // 挂起信息里带着 toolCallId（界面据此精确落点）
    expect(pending[0].toolCallId).toBe('call-xyz')
    rt.resolveApproval('c1', 's-card', pending[0].id, 'allow')
    await drain

    // 落盘的转录里，那条工具应当是 card=true
    const rec = await store.get('c1', 's-card')
    const toolTurn = rec!.turns.find((t) => t.tool?.id === 'call-xyz')
    expect(toolTurn?.tool?.card).toBe(true)
  })
})
