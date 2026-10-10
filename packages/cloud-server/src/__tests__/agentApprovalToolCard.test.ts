/**
 * 审批请求要带上**那条工具**的调用 id（toolCallId）—— 回归测试。
 *
 * 为什么必须有 toolCallId：界面靠它把「审批卡片」与它那条工具调用精确对上
 *（同一轮里可能有好几个同名工具；按名字找会认错兄弟）。
 *
 * 为什么**不再**标 card=true（用户口径 2026-10-10）：早先给命中审批的工具打 card，
 * 本意是让它显眼，副作用是把 exec_command / read_file 这类默认工具从**折叠行**顶成
 * 常驻展开的卡片（折叠箭头没了、输入输出一直摊着）。审批本来就有自己独立的卡片 UI
 *（.ac-approval），不需要再改底层工具的样子 —— 除了自带卡片的画布 MCP 工具，其余一律折叠行。
 *
 * 另锁一个字段名：SDK 的真字段是 `tool_call_id`（不是 `payload.id`）—— 读错了 toolCallId 就恒为空。
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

describe('审批请求 ⇒ 带 toolCallId，但不改工具的折叠样式', () => {
  it('挂起信息里带 tool_call_id；落盘的转录里那条工具**没有** card 标记', async () => {
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

    // 落盘的转录里，那条工具**不应**被标成卡片（要保持在默认折叠行里）
    const rec = await store.get('c1', 's-card')
    const toolTurn = rec!.turns.find((t) => t.tool?.id === 'call-xyz')
    expect(toolTurn?.tool).toBeTruthy()
    expect(toolTurn?.tool?.card).toBeFalsy()
  })
})
