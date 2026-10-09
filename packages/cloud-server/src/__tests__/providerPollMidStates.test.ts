/**
 * provider 轮询对 web2api「中间态」的翻译 —— 复现用户实测的 bug（2026-10-08）。
 *
 * 现场日志（任务 c2632f08）：
 *   18:54:20  pending → processing（attempt #1）
 *   18:54:42  验证码 2007 → paused          ← 非终态，在等用户手动过验证码
 *   18:54:43  cloud-server 轮询看到 paused → 立刻判失败收工   ← BUG
 *   18:55:11  验证码消失 → captcha-watcher 自动恢复 → attempt #2
 *   18:56:35  completed 100%                 ← 真实成功，但 cloud-server 早就撒手了
 *
 * 契约：web2api 只有 completed / failed / cancelled 是**真终态**；
 * paused / retrying / polling_failed / pending 都还在自己往前走，必须继续轮询。
 * 其中 paused（等验证码）与 retrying/pending（换号退避）还要标 `waiting`，
 * 让后台把这段时间从超时预算里扣掉（人处理验证码要多久不由程序决定）。
 */
import { describe, it, expect } from 'vitest'
import { createWeb2ApiProvider } from '../providers/web2api/index'
import type { ActionDef } from '../providers/types'

const EP = 'http://localhost:8033/mcp'

const ACTION: ActionDef = { id: 'web2api:doubao-image-seedream45', title: '豆包 Seedream 4.5', tool: 'doubao/chat-auto', nodeTypes: ['image'] }

/** 假 fetch：只回 get-task 的详情（照真实响应的包装层数） */
function taskFetch(detail: Record<string, unknown>): typeof fetch {
  return (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { method?: string; id?: number; params?: { name?: string } }
    if (body.method === 'initialize') {
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json', 'mcp-session-id': 's' } })
    }
    if (body.method === 'notifications/initialized') return new Response('', { status: 202 })
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { structuredContent: detail } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
}

const poll = async (detail: Record<string, unknown>) => {
  const provider = createWeb2ApiProvider({ endpoint: EP, fetchImpl: taskFetch(detail) })
  return provider.poll!('c2632f08', ACTION)
}

describe('中间态继续轮询（不判失败）', () => {
  it('paused（等用户在浏览器里过验证码）→ running + waiting', async () => {
    const p = await poll({ status: 'paused', message: '触发人机验证码，需人工在远程控制中完成验证后恢复', progress: 40 })
    expect(p.status).toBe('running')
    expect(p.waiting).toBe(true)
    expect(p.message).toContain('验证码')
    // 进度要如实带出来（界面继续显示"卡在 40%"而不是清零）
    expect(p.progress).toBe(40)
  })

  it('retrying（失败退避，稍后自动重试）→ running + waiting', async () => {
    const p = await poll({ status: 'retrying', message: '失败，稍后自动重试' })
    expect(p.status).toBe('running')
    expect(p.waiting).toBe(true)
  })

  it('pending（换号后重新排队）→ running + waiting', async () => {
    const p = await poll({ status: 'pending', message: '已换号，10s 后重新执行' })
    expect(p.status).toBe('running')
    expect(p.waiting).toBe(true)
  })

  it('polling_failed（轮询中断，可手动恢复）→ running（不带 waiting）', async () => {
    const p = await poll({ status: 'polling_failed', message: '轮询中断' })
    expect(p.status).toBe('running')
    expect(p.waiting).toBeUndefined()
  })

  it('普通进行中仍按正常超时算（不带 waiting）', async () => {
    for (const s of ['processing', 'polling']) {
      const p = await poll({ status: s, progress: 30, message: '生成中' })
      expect(p.status, s).toBe('running')
      expect(p.waiting, s).toBeUndefined()
      expect(p.progress, s).toBe(30)
    }
  })
})

describe('真终态仍正确收敛', () => {
  it('completed → done（产物地址绝对化）', async () => {
    const p = await poll({ status: 'completed', resources: [{ downloadUrl: '/api/resources/images/doubao/a.png' }] })
    expect(p.status).toBe('done')
    expect(p.urls).toEqual(['http://localhost:8033/api/resources/images/doubao/a.png'])
  })

  it('failed → error（web2api 判死才是死）', async () => {
    const p = await poll({ status: 'failed', message: '无可用账号（本任务已尝试 3 个）' })
    expect(p.status).toBe('error')
    expect(p.error).toContain('无可用账号')
  })

  it('cancelled → error', async () => {
    const p = await poll({ status: 'cancelled', message: '任务已取消' })
    expect(p.status).toBe('error')
  })
})
