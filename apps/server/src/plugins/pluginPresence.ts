/**
 * pluginPresence —— 「调试监听到底还在不在」的唯一事实源（协议见 docs/plugin-dev/10-debug-protocol.md）。
 *
 * ## 它解决什么
 *
 * 热重载记录（`plugin-watch:<名>`）只说明「某次构建成功过」，**不说明 watch 还在跑**：
 * 进程被关掉之后那条记录原样留着，画布看起来一切正常，改代码却毫无反应。
 * 这里补一条独立的「在场」通道：watch 定期发心跳，停了就超时变「失联」。
 *
 * ## 三条设计决定（别改回去）
 *
 * 1. **只存内存，不落盘**。心跳每 10 秒一次，落盘就是每 10 秒重写一遍 settings.json；
 *    而「在不在线」本来就不该跨重启保留 —— 服务重启后先显示「未知」，下次心跳即恢复。
 * 2. **超时只标记，不卸载**。掉线只说明热重载停了，插件本身还能用；
 *    自动卸载会误删（休眠、长构建、调试器卡住），还会让画布上已有节点渲染不出来。
 * 3. **以服务端收到的时间为准**。不信任上报方的时间戳，避免两台机器时钟不一致。
 */

/** 监听状态（与协议文档一致；`stopped` 等价于「告别」） */
export type PresenceState = 'watching' | 'building' | 'paused' | 'failed' | 'stopped'

export const PRESENCE_STATES: readonly PresenceState[] = ['watching', 'building', 'paused', 'failed', 'stopped']

/** 超过这么久没心跳 = 失联（协议值；watch 每 10 秒报一次，留了三次余量） */
export const PRESENCE_STALE_MS = 30_000

/** 失联后再留多久才从表里清掉（保留是为了让界面能显示「失联」，而不是凭空消失） */
export const PRESENCE_RETENTION_MS = 10 * 60_000

/** 插件名的合法形状：字母数字下划线点连字符（与 server-plugins 的 id 白名单同口径，额外允许点） */
export const PRESENCE_NAME_RE = /^[A-Za-z0-9_.-]{1,64}$/

/** 一次心跳上报 */
export interface PresenceHeartbeat {
  name: string
  /** 进程实例 id：同一插件可能同时跑两个 watch，靠它区分 */
  instance: string
  state: PresenceState
  /** 前端产物地址（浏览器可直接请求；绝对地址或同源相对地址） */
  front?: string
  /** 后台产物路径（后台机器上的绝对路径） */
  server?: string
  /** 失败时的一句话原因（上限 500 字） */
  message?: string
}

/** 表里的一行（快照输出） */
export interface PresenceEntry {
  name: string
  instance: string
  state: PresenceState
  front?: string
  server?: string
  message?: string
  /** 服务端收到最后一次心跳的时刻（毫秒） */
  lastSeenAt: number
  /** 距上次心跳多久（毫秒；快照时现算） */
  ageMs: number
  /** 是否已超时失联 */
  stale: boolean
}

/** 快照里一个插件的合并结果（多实例时取最近的） */
export interface PresenceRow extends PresenceEntry {
  /** 这个插件当前有几个 watch 实例（>1 要让用户看到，别静默选一个） */
  instances: number
  /** 是否有多实例同时在线 */
  multiple: boolean
}

export interface PresenceSnapshot {
  ok: true
  staleAfterMs: number
  now: number
  plugins: PresenceRow[]
}

/** 入参校验：返回错误文案（null = 合法） */
export function validateHeartbeat(input: unknown): { error: string } | { value: PresenceHeartbeat } {
  if (!input || typeof input !== 'object') return { error: 'body 必须是 JSON 对象' }
  const b = input as Record<string, unknown>
  const name = typeof b.name === 'string' ? b.name.trim() : ''
  if (!PRESENCE_NAME_RE.test(name)) {
    return { error: '非法插件名（只允许字母数字下划线点连字符，1-64 位）' }
  }
  const instance = typeof b.instance === 'string' ? b.instance.trim() : ''
  if (!instance || instance.length > 128) {
    return { error: '需要 instance（当前 watch 进程的唯一 id，1-128 位）' }
  }
  const state = typeof b.state === 'string' ? (b.state as PresenceState) : undefined
  if (!state || !PRESENCE_STATES.includes(state)) {
    return { error: 'state 必须是 watching / building / paused / failed / stopped 之一' }
  }
  const front = typeof b.front === 'string' ? b.front.trim() : undefined
  if (front !== undefined && front !== '') {
    // 只接受浏览器能请求的地址：绝对 http(s) 或同源相对路径。
    if (!/^https?:\/\//i.test(front) && !front.startsWith('/')) {
      return { error: 'front 必须是 http(s):// 开头的绝对地址或 / 开头的同源路径' }
    }
    if (front.length > 2048) return { error: 'front 过长（上限 2048）' }
  }
  const server = typeof b.server === 'string' ? b.server.trim() : undefined
  if (server !== undefined && server.length > 1024) return { error: 'server 过长（上限 1024）' }
  const message = typeof b.message === 'string' ? b.message.slice(0, 500) : undefined
  return {
    value: {
      name,
      instance,
      state,
      ...(front ? { front } : {}),
      ...(server ? { server } : {}),
      ...(message ? { message } : {}),
    },
  }
}

/**
 * 在场表。纯内存、无 IO、可单测（时间可注入）。
 */
export class PluginPresence {
  /** name → instance → 条目 */
  private readonly byName = new Map<string, Map<string, Omit<PresenceEntry, 'ageMs' | 'stale'>>>()
  private readonly listeners = new Set<(name: string) => void>()

  /** 订阅「某插件的在场状态变了」；返回取消函数 */
  onChange(cb: (name: string) => void): () => void {
    this.listeners.add(cb)
    return () => {
      this.listeners.delete(cb)
    }
  }

  private notify(name: string): void {
    for (const cb of [...this.listeners]) {
      try {
        cb(name)
      } catch {
        /* 单个订阅者出错不影响别人，也不影响写入 */
      }
    }
  }

  /**
   * 收一次心跳。
   *
   * `stopped` 视为「告别」：直接删掉该实例（插件仍可能装在画布上，但 watch 已经走了）。
   * @returns 这次是否真的改变了状态（用于决定要不要广播）
   */
  heartbeat(input: PresenceHeartbeat, now = Date.now()): boolean {
    if (input.state === 'stopped') return this.leave(input.name, input.instance, now)
    let instances = this.byName.get(input.name)
    if (!instances) {
      instances = new Map()
      this.byName.set(input.name, instances)
    }
    const prev = instances.get(input.instance)
    instances.set(input.instance, {
      name: input.name,
      instance: input.instance,
      state: input.state,
      ...(input.front ? { front: input.front } : {}),
      ...(input.server ? { server: input.server } : {}),
      ...(input.message ? { message: input.message } : {}),
      lastSeenAt: now,
    })
    // 心跳本身（时间只变）也要广播吗？不要：每 10 秒一次会让所有页面白刷。
    // 只在「状态/地址/错误」真的变了时广播；超时那一刻由 sweep() 广播。
    const changed =
      !prev ||
      prev.state !== input.state ||
      prev.front !== (input.front || undefined) ||
      prev.server !== (input.server || undefined) ||
      prev.message !== (input.message || undefined)
    // 记下「这个插件此刻是活着的」，供 sweep 判断「刚掉线」只广播一次
    this.lastAlive.set(input.name, true)
    if (changed) this.notify(input.name)
    return changed
  }

  /** 主动告别（正常退出）：删掉该实例并广播 */
  leave(name: string, instance: string, now = Date.now()): boolean {
    void now
    const instances = this.byName.get(name)
    if (!instances?.delete(instance)) return false
    if (instances.size === 0) {
      this.byName.delete(name)
      this.lastAlive.delete(name)
    }
    this.notify(name)
    return true
  }

  /**
   * 扫一遍：找出「这次刚超时」的插件并广播。
   *
   * 刻意不删超时条目（删了界面就只能显示「没有这个插件」，看不出是掉线）；
   * 只有超过保留期（10 分钟）才真正清掉，防止表无限增长。
   * @returns 这次新变成失联的插件名
   */
  sweep(now = Date.now()): string[] {
    const newlyStale: string[] = []
    for (const [name, instances] of [...this.byName]) {
      for (const [instance, entry] of [...instances]) {
        if (now - entry.lastSeenAt > PRESENCE_RETENTION_MS) {
          instances.delete(instance)
        }
      }
      if (instances.size === 0) {
        this.byName.delete(name)
        this.lastAlive.delete(name)
        continue
      }
      const alive = [...instances.values()].some((e) => now - e.lastSeenAt <= PRESENCE_STALE_MS)
      if (alive) {
        this.lastAlive.set(name, true)
      } else if (this.lastAlive.get(name) === true) {
        // 曾经活着、这一刻全超时 → 只广播这一次
        this.lastAlive.set(name, false)
        newlyStale.push(name)
      }
    }
    return newlyStale
  }

  /** name → 上一轮是否「全在线」（用来判断「刚掉线」只广播一次） */
  private readonly lastAlive = new Map<string, boolean>()

  /** 快照：每个插件合并成一个展示行（多实例取最近心跳的那个） */
  snapshot(now = Date.now()): PresenceSnapshot {
    const plugins: PresenceRow[] = []
    for (const [name, instances] of this.byName) {
      // 超过保留期的实例顺手清掉：不依赖扫描定时器先跑（页面长时间不刷新也该看到干净的快照）
      for (const [instance, entry] of [...instances]) {
        if (now - entry.lastSeenAt > PRESENCE_RETENTION_MS) instances.delete(instance)
      }
      if (instances.size === 0) {
        this.byName.delete(name)
        this.lastAlive.delete(name)
        continue
      }
      const entries = [...instances.values()]
      if (!entries.length) continue
      // 最近心跳的那个代表这一行（真有两个都在线时，界面上看 instances/multiple）
      entries.sort((a, b) => b.lastSeenAt - a.lastSeenAt)
      const top = entries[0]!
      const ageMs = Math.max(0, now - top.lastSeenAt)
      plugins.push({
        name: top.name,
        instance: top.instance,
        state: top.state,
        ...(top.front ? { front: top.front } : {}),
        ...(top.server ? { server: top.server } : {}),
        ...(top.message ? { message: top.message } : {}),
        lastSeenAt: top.lastSeenAt,
        ageMs,
        stale: ageMs > PRESENCE_STALE_MS,
        instances: entries.length,
        multiple: entries.length > 1,
      })
    }
    plugins.sort((a, b) => a.name.localeCompare(b.name))
    return { ok: true, staleAfterMs: PRESENCE_STALE_MS, now, plugins }
  }

  /** 清空（测试 / 服务停止） */
  clear(): void {
    this.byName.clear()
    this.lastAlive.clear()
    this.listeners.clear()
  }
}

/** 扫描间隔：5 秒足够让「失联」在 30~35 秒内出现在界面上 */
export const PRESENCE_SWEEP_MS = 5_000
