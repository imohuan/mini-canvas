/**
 * pluginPresenceRoute —— 调试监听的「在场」接口（协议见 docs/plugin-dev/10-debug-protocol.md）。
 *
 * 对外三个口子：
 *
 *   POST /api/plugin-presence/heartbeat   { name, instance, state, front?, server?, message? }
 *   POST /api/plugin-presence/leave       { name, instance }
 *   GET  /api/plugin-presence             快照（每个插件一行，含 stale / multiple）
 *
 * 三个都不碰磁盘：在不在线不该跨重启保留，也不该每 10 秒重写 settings.json。
 *
 * 广播复用**现成的** `/api/kv/events`：每次变化写**同一个**小 key（`plugin-presence`，
 * 值里带「哪个插件变了」），订阅方收到就现拉一次快照。
 * 为什么借 KV 而不新开 SSE 通道：画布已经连着那条共享长连接，多开一条会吃并发额度
 * （见 packages/ui/src/composables/kvEvents.ts 的说明）。
 * 为什么只用一个 key：每个插件一个 key 会在 settings.json 里越积越多；这里只关心「有变化」，
 * 具体是谁由订阅方拉快照自己算。
 */
import { Hono } from 'hono'
import type { KvStore } from '../store/kvStore.js'
import { PluginPresence, validateHeartbeat } from '../plugins/pluginPresence.js'

/** 广播用的 KV key（画布收到就现拉一次快照） */
export const PRESENCE_KEY = 'plugin-presence'

export interface PluginPresenceRouteOptions {
  /** 预置实例（真实服务里由内置插件持有；测试可自己造一个） */
  presence: PluginPresence
  /** 用来广播变更的 KV（缺省不广播，只更新内存） */
  kv?: KvStore
}

export interface PluginPresenceRoutes {
  app: Hono
  /** 扫描超时：把「刚掉线」的插件广播出去（由内置插件按间隔调用，卸载即停） */
  sweep(): Promise<void>
}

/** 路由工厂。装不装由 server.ts 按开关决定（本机回环自动开，见其 presenceEnabled 注释）；
 *  这里再加一道 Host 校验：即使插件被强制开启（环境变量），也只收本机回环请求。 */
export function createPluginPresenceRoutes(opts: PluginPresenceRouteOptions): PluginPresenceRoutes {
  const app = new Hono()
  const presence = opts.presence

  /** 状态一变就写一条小 key（订阅方收到后现拉快照） */
  async function broadcast(name: string): Promise<void> {
    if (!opts.kv) return
    try {
      // 值里带 name 与时间戳：订阅方据此知道是哪个插件变了；具体状态自己拉快照。
      await opts.kv.set('config', PRESENCE_KEY, { t: Date.now(), name })
    } catch {
      /* 广播失败不影响状态本身：页面下次刷新仍能拿到正确的快照 */
    }
  }

  presence.onChange((name) => {
    void broadcast(name)
  })

  app.post('/api/plugin-presence/heartbeat', async (c) => {
    // 双保险：Host 必须是本机回环（与 install-from-path 同一判断口径）
    const hostHeader = (c.req.header('host') ?? '').trim().toLowerCase()
    const hostname = hostHeader.startsWith('[') ? hostHeader.slice(0, hostHeader.indexOf(']') + 1) : (hostHeader.split(':')[0] ?? '')
    if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(hostname)) {
      return c.json({ ok: false, error: '在场接口只允许本机调用（Host 不是回环地址）' }, 403)
    }
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ ok: false, error: 'body 不是合法 JSON' }, 400)
    }
    const checked = validateHeartbeat(body)
    if ('error' in checked) return c.json({ ok: false, error: checked.error }, 400)
    presence.heartbeat(checked.value)
    return c.json({ ok: true })
  })

  app.post('/api/plugin-presence/leave', async (c) => {
    const hostHeader = (c.req.header('host') ?? '').trim().toLowerCase()
    const hostname = hostHeader.startsWith('[') ? hostHeader.slice(0, hostHeader.indexOf(']') + 1) : (hostHeader.split(':')[0] ?? '')
    if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(hostname)) {
      return c.json({ ok: false, error: '在场接口只允许本机调用（Host 不是回环地址）' }, 403)
    }
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ ok: false, error: 'body 不是合法 JSON' }, 400)
    }
    const b = (body ?? {}) as Record<string, unknown>
    const name = typeof b.name === 'string' ? b.name.trim() : ''
    const instance = typeof b.instance === 'string' ? b.instance.trim() : ''
    if (!name || !instance) return c.json({ ok: false, error: '需要 name 与 instance' }, 400)
    // 告别是幂等的：没这条记录也回 ok（目标状态已经达成）
    presence.leave(name, instance)
    return c.json({ ok: true })
  })

  app.get('/api/plugin-presence', (c) => c.json(presence.snapshot()))

  return {
    app,
    async sweep() {
      for (const name of presence.sweep()) await broadcast(name)
    },
  }
}
