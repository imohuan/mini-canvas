/**
 * 调试监听「在场」协议：心跳 / 超时 / 告别 / 多实例。
 *
 * 核心不变量（这些破了，界面就会撒谎）：
 *   1. 心跳只更新内存，不碰磁盘；
 *   2. 超时只标记 stale，**不删插件、不卸载**；
 *   3. 「刚掉线」只广播一次，不能每 5 秒刷一次；
 *   4. 正常退出（stopped / leave）立刻从表里消失；
 *   5. 同一插件两个 watch 实例 → instances=2、multiple=true，不静默挑一个。
 */
import { describe, expect, it, vi } from 'vitest'
import {
  PluginPresence,
  PRESENCE_RETENTION_MS,
  PRESENCE_STALE_MS,
  validateHeartbeat,
} from '../plugins/pluginPresence.js'
import { createPluginPresenceRoutes } from '../routes/pluginPresenceRoute.js'
import { createServerFramework } from '../serverFramework/index.js'

const base = { name: 'demo', instance: 'pid-1', state: 'watching' as const, front: '/plugins/plugin-demo/demo.js' }

describe('validateHeartbeat', () => {
  it('合法输入原样收下（可选字段缺省不塞空串）', () => {
    const r = validateHeartbeat(base)
    expect('value' in r).toBe(true)
    if ('value' in r) expect(r.value).toEqual(base)
  })

  it('非法插件名 / 缺 instance / 未知 state / 非法 front → 明确报错', () => {
    expect(validateHeartbeat({ ...base, name: '../evil' })).toEqual({ error: expect.stringContaining('非法插件名') })
    expect(validateHeartbeat({ ...base, instance: '' })).toEqual({ error: expect.stringContaining('instance') })
    expect(validateHeartbeat({ ...base, state: 'online' })).toEqual({ error: expect.stringContaining('state') })
    expect(validateHeartbeat({ ...base, front: 'C:\\evil.js' })).toEqual({ error: expect.stringContaining('front') })
  })
})

describe('PluginPresence 在场表', () => {
  it('心跳进来 → 快照在线；时间推进到超时 → stale=true，但条目还在', () => {
    const p = new PluginPresence()
    const t0 = 1_000_000
    p.heartbeat(base, t0)
    expect(p.snapshot(t0).plugins[0]).toMatchObject({ name: 'demo', stale: false, instances: 1 })
    const later = p.snapshot(t0 + PRESENCE_STALE_MS + 1)
    expect(later.plugins, '超时不能把插件从表里删掉').toHaveLength(1)
    expect(later.plugins[0]).toMatchObject({ stale: true, name: 'demo' })
  })

  it('超过保留期才真正清掉（避免表无限增长）', () => {
    const p = new PluginPresence()
    const t0 = 1_000_000
    p.heartbeat(base, t0)
    expect(p.snapshot(t0 + PRESENCE_RETENTION_MS + 1).plugins).toEqual([])
  })

  it('「刚掉线」只广播一次（sweep 不反复刷）', () => {
    const p = new PluginPresence()
    const t0 = 1_000_000
    p.heartbeat(base, t0)
    const staleAt = t0 + PRESENCE_STALE_MS + 1
    expect(p.sweep(staleAt), '第一次扫到掉线 → 广播').toEqual(['demo'])
    expect(p.sweep(staleAt + 5_000), '再扫 → 不重复广播').toEqual([])
  })

  it('状态变化才广播；单纯心跳（时间变化）不广播', () => {
    const p = new PluginPresence()
    const seen: string[] = []
    p.onChange((n) => seen.push(n))
    p.heartbeat(base, 1)
    p.heartbeat(base, 2) // 只刷新时间
    expect(seen).toEqual(['demo'])
    p.heartbeat({ ...base, state: 'building' }, 3)
    expect(seen).toEqual(['demo', 'demo'])
  })

  it('heartbeat 里 state=stopped 等同告别：立刻消失', () => {
    const p = new PluginPresence()
    p.heartbeat(base, 1)
    p.heartbeat({ ...base, state: 'stopped' }, 2)
    expect(p.snapshot(2).plugins).toEqual([])
  })

  it('leave 幂等：没这条记录也返回 false，不抛', () => {
    const p = new PluginPresence()
    expect(p.leave('nobody', 'x')).toBe(false)
  })

  it('同一插件两个实例 → instances=2 / multiple=true，取最近心跳那个', () => {
    const p = new PluginPresence()
    p.heartbeat(base, 1)
    p.heartbeat({ ...base, instance: 'pid-2', state: 'building' }, 5)
    const row = p.snapshot(6).plugins[0]!
    expect(row).toMatchObject({ instances: 2, multiple: true, state: 'building', instance: 'pid-2' })
  })

  it('一个实例退出后，另一个还在 → 不判失联', () => {
    const p = new PluginPresence()
    p.heartbeat(base, 1)
    p.heartbeat({ ...base, instance: 'pid-2' }, 2)
    p.leave('demo', 'pid-1')
    const row = p.snapshot(3).plugins[0]!
    expect(row).toMatchObject({ instances: 1, stale: false })
  })
})

describe('plugin-presence 路由', () => {
  function boot() {
    const presence = new PluginPresence()
    const built = createPluginPresenceRoutes({ presence })
    const host = createServerFramework()
    host.ctx.routes.adopt(built.app)
    return { host, presence, built }
  }

  it('POST 心跳 → 200；GET 快照能读回；POST 告别 → 消失', async () => {
    const { host } = boot()
    await host.start()
    const post = (path: string, body: unknown) =>
      host.app.fetch(
        new Request('http://x' + path, {
          method: 'POST',
          body: JSON.stringify(body),
          headers: { 'content-type': 'application/json' },
        }),
      )
    expect((await post('/api/plugin-presence/heartbeat', base)).status).toBe(200)
    const snap = (await (await host.app.fetch(new Request('http://x/api/plugin-presence'))).json()) as {
      plugins: Array<{ name: string }>
    }
    expect(snap.plugins.map((p) => p.name)).toEqual(['demo'])
    expect((await post('/api/plugin-presence/leave', { name: 'demo', instance: 'pid-1' })).status).toBe(200)
    const after = (await (await host.app.fetch(new Request('http://x/api/plugin-presence'))).json()) as { plugins: unknown[] }
    expect(after.plugins).toEqual([])
    host.ctx.stop()
  })

  it('非法心跳 → 400 且带可读原因（不静默吞）', async () => {
    const { host } = boot()
    await host.start()
    const res = await host.app.fetch(
      new Request('http://x/api/plugin-presence/heartbeat', {
        method: 'POST',
        body: JSON.stringify({ ...base, state: 'nope' }),
        headers: { 'content-type': 'application/json' },
      }),
    )
    expect(res.status).toBe(400)
    expect(String(((await res.json()) as { error?: string }).error)).toContain('state')
    host.ctx.stop()
  })

  it('sweep() 把「刚掉线」写进广播（借现有 KV 通道，键固定）', async () => {
    const presence = new PluginPresence()
    const written: Array<{ type: string; key: string; value: unknown }> = []
    const kv = {
      async set(type: string, key: string, value: unknown) {
        written.push({ type, key, value })
      },
    }
    const built = createPluginPresenceRoutes({ presence, kv: kv as never })
    const host = createServerFramework()
    host.ctx.routes.adopt(built.app)
    await host.start()
    // 用假时钟写一次心跳，再让 sweep 看到它超时
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    presence.heartbeat(base)
    nowSpy.mockReturnValue(1_000_000 + PRESENCE_STALE_MS + 1)
    await built.sweep()
    nowSpy.mockRestore()
    expect(written.some((w) => w.key === 'plugin-presence')).toBe(true)
    host.ctx.stop()
  })
})
