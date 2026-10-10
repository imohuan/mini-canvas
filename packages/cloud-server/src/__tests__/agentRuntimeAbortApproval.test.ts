/**
 * 中止一轮时**挂着的审批必须一起解开** —— 回归测试。
 *
 * 真 bug（用户实测 2026-10-10）：一轮停在审批上（SDK 在 await 中途回调我们，
 * 由我们握住那个 promise）。此时点「终止」只 abort 了信号，SDK 根本没在听 ——
 * 它正卡在等卡片。于是 run() 的循环永远出不来、finally 也跑不到，
 * 这一轮就「停不住」：刷新页面后 running 恒为 true，输入框右下角按钮永远显示停止。
 *
 * 修法：abort 时把挂起的审批按「拒绝」放行，循环才能收尾。
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
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'rt-abort-ap-'))
  store = new AgentSessionStore(root)
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('abort：挂着的审批一起解开', () => {
  it('停在审批上的一轮，abort 后能收尾（不永远挂着）', async () => {
    let approveSettled = false
    const session = {
      sessionId: 's-ap',
      provider: 'p',
      modelId: 'm',
      async *run(_messages: unknown[], opts: { approve: (c: unknown) => Promise<'allow' | 'deny'> }) {
        yield { type: 'session_meta', payload: { session_id: 's-ap', model_context_window: 1000 } }
        // 这一步会挂起：审批 promise 由 runtime 握住，直到有人点允许/拒绝或 abort
        const decision = await opts.approve({ payload: { id: 'call-1', name: 'exec_command', arguments: '{}' } })
        approveSettled = true
        yield { type: 'model_msg', payload: { type: 'text', text: '决定是 ' + decision, role: 'assistant' } }
      },
    }
    const rt = new AgentRuntime({
      root,
      store,
      agent: async () => ({ createSession: async () => session, resumeSession: async () => session }) as never,
      makeUserMessage: (text: string) => ({ kind: 'user', text }),
      log: () => undefined,
    } as never)
    await store.ensure('c1', { id: 's-ap', title: 't', createdAt: 1, provider: 'p', modelId: 'm' })

    const ac = new AbortController()
    const seen: string[] = []
    // 跑到审批那一刻就停住：notify 收到 approval_request 后模拟用户点了「终止」
    const drain = (async () => {
      for await (const ev of rt.run('c1', { canvasId: 'c1', sessionId: 's-ap', text: '跑' }, ac.signal, (e) => {
        seen.push(e.type)
      })) {
        seen.push(ev.type)
      }
    })()

    // 等审批真的推出来再 abort（挂起表先写、emitApproval 在 await 之后）
    for (let i = 0; i < 100 && !seen.includes('approval_request'); i++) {
      await new Promise((r) => setTimeout(r, 5))
    }
    expect(rt.pendingApprovals('c1', 's-ap')).toHaveLength(1)
    expect(seen).toContain('approval_request')

    rt.abort('c1', 's-ap')
    // 关键断言：真的收尾了（没有这一条就是「永远挂在审批上」的原 bug）
    await Promise.race([drain, new Promise((_, rej) => setTimeout(() => rej(new Error('run 没收尾（挂在审批上）')), 2000))])
    expect(approveSettled).toBe(true)
    expect(rt.pendingApprovals('c1', 's-ap')).toHaveLength(0)
    expect(seen).toContain('done')
  })
})
