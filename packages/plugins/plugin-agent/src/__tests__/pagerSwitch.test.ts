/**
 * 切会话时，分页器不能「慢一拍」（用户 2026-11-13 报：点分页切换后页码是旧版本 / 像没动）。
 *
 * 根因：openSession 先 await 拉转录、再 await 拉分叉信息。这两步之间界面已经渲染了
 * **新**会话的转录，而 state.pagers 还是**旧会话**那一份 —— 旧分页器按旧 userOrdinal
 * 挂在新消息上、页码指着旧版本。修法：进 openSession 第一步就清空 pagers。
 *
 * 这里用一个「分叉信息永不返回」的假 fetch 把中间态**固定住**：
 * 只要切换瞬间 pagers 被清空，就说明界面不会再拿旧页码去画新会话。
 */
import { describe, expect, it } from 'vitest'
import { createAgentService } from '../service/agentService'

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

const SESSIONS = [
  { id: 'a', title: '版本 A', createdAt: 1, updatedAt: 9 },
  { id: 'b', title: '版本 B', createdAt: 2, updatedAt: 8 },
]

/**
 * 第一次请求正常返回（先把会话 A 装好），之后的分支信息请求**挂着不返回** ——
 * 模拟「点完分页、网络还没回来」的那一小段中间态。
 */
function hangingBranchFetch(): typeof fetch {
  let branchCalls = 0
  return (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/api/agent/config')) {
      return json({ models: [{ provider: 'p', modelId: 'm', hasKey: true }], providers: [], skills: [], mcpServers: [], catalog: [] })
    }
    if (url.includes('/prompts')) return json({ prompts: [] })
    if (url.includes('/policy')) return json({ policy: { enabled: true, rules: [] } })
    if (url.includes('/branch-info')) {
      branchCalls += 1
      if (branchCalls > 1) return new Promise<Response>(() => undefined)
      return json({ ok: true, points: [] })
    }
    if (url.includes('/sessions/')) {
      const id = url.split('/sessions/')[1].split('?')[0]
      return json({
        session: { id, title: '会话 ' + id, createdAt: 1, updatedAt: 9, turns: [{ role: 'user', text: 'hi', ts: 1 }] },
        running: false,
        queue: { paused: false, items: [] },
      })
    }
    if (url.includes('/sessions')) return json({ ok: true, sessions: SESSIONS, parents: {} })
    return json({ ok: true })
  }) as typeof fetch
}

describe('切会话时分页器不会停留在旧版本', () => {
  it('openSession 一开始就清空旧 pagers（不等网络回来）', async () => {
    const orig = globalThis.fetch
    globalThis.fetch = hangingBranchFetch()
    try {
      const svc = createAgentService({ baseUrl: '' })
      // 先装好会话 A
      await svc.openSession('a')
      // 手工塞一份「旧会话的分页器」，模拟界面已经画出来的状态
      svc.state.pagers = [{ at: 1, userOrdinal: 0, items: [{ id: 'a', label: '当前' }, { id: 'b', label: '版本 B' }], index: 0, position: 1, total: 2 }]
      expect(svc.state.pagers).toHaveLength(1)

      // 点「下一个版本」= openSession('b')；分支信息永远不返回
      void svc.openSession('b')
      // 只要进到函数第一个 await 之前，旧分页器就该被清掉
      await new Promise((r) => setTimeout(r, 10))
      expect(svc.state.pagers).toEqual([])
      expect(svc.state.sessionId).toBe('b')
    } finally {
      globalThis.fetch = orig
    }
  })

  /**
   * 切完会话要**立刻重接常驻流**。
   *
   * openSession 里 detachStream() 断掉旧流；若不再接，新会话的 running / 工具进度 /
   * 审批都要等下次打开面板 —— 用户看到的就是「切过去了，但内容不更新、慢一拍」。
   * 这里数的是对 /stream 的请求次数：切一次会话应该**再连一次**。
   */
  it('openSession 结束后会重新订阅新会话的事件流', async () => {
    const orig = globalThis.fetch
    let streamCalls = 0
    const seen: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/stream')) {
        streamCalls += 1
        seen.push(url)
        // 立刻结束（空流）：只要发起过就算接上了，不用真挂着
        return new Response('', { status: 204, headers: { 'content-type': 'text/event-stream' } })
      }
      return hangingBranchFetch()(input)
    }) as typeof fetch
    try {
      const svc = createAgentService({ baseUrl: '' })
      await svc.openSession('a')
      const afterFirst = streamCalls
      await svc.openSession('b')
      expect(streamCalls).toBeGreaterThan(afterFirst)
      expect(seen.some((u) => u.includes('/b/'))).toBe(true)
    } finally {
      globalThis.fetch = orig
    }
  })

  /**
   * 连点分页（并发 openSession）时，**旧请求后返回不许覆盖新会话**。
   *
   * 这是用户「页码不对 / 慢一拍」的另一半：网络不保证按发起顺序返回。
   * 场景：先点 A（慢），再点 B（快）—— 最终必须停在 B。
   */
  it('并发切换：先发起的慢请求后返回，不覆盖最后选中的会话', async () => {
    const orig = globalThis.fetch
    // 用对象持句柄：TS 在闭包里看不到对外层 `let` 的赋值，会把变量收窄成 `never`，
    // 直接 `releaseA?.()` 报 TS2349（本次 typecheck 抓到的）。放进对象属性就不收窄。
    const gate: { release?: () => void } = {}
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/agent/config')) {
        return json({ models: [{ provider: 'p', modelId: 'm', hasKey: true }], providers: [], skills: [], mcpServers: [], catalog: [] })
      }
      if (url.includes('/prompts')) return json({ prompts: [] })
      if (url.includes('/policy')) return json({ policy: { enabled: true, rules: [] } })
      if (url.includes('/branch-info')) return json({ ok: true, points: [] })
      if (url.includes('/stream')) return new Response('', { status: 204 })
      if (url.includes('/sessions/a')) {
        // A 的转录请求卡住，等测试放行
        await new Promise<void>((r) => { gate.release = r })
      }
      if (url.includes('/sessions/')) {
        const id = url.split('/sessions/')[1].split('?')[0]
        return json({
          session: { id, title: '会话 ' + id, createdAt: 1, updatedAt: 9, turns: [{ role: 'user', text: 'hi from ' + id, ts: 1 }] },
          running: false,
          queue: { paused: false, items: [] },
        })
      }
      if (url.includes('/sessions')) return json({ ok: true, sessions: SESSIONS, parents: {} })
      return json({ ok: true })
    }) as typeof fetch
    try {
      const svc = createAgentService({ baseUrl: '' })
      const slow = svc.openSession('a')
      await new Promise((r) => setTimeout(r, 5))
      await svc.openSession('b')
      // 现在才放行 A 的慢请求：它必须自己放弃，不能把界面拉回 A
      gate.release?.()
      await slow
      expect(svc.state.sessionId).toBe('b')
      expect(JSON.stringify(svc.state.turns)).toContain('from b')
    } finally {
      globalThis.fetch = orig
    }
  })
})
