/**
 * pluginWatch —— 盯住「插件产物目录」，产物一变就经 SSE 通知前端重装。
 *
 * ## 它解决什么
 *
 * 开发期改一个插件、`pnpm build` 之后，浏览器里的画布要看到新版，原本只能手动
 * 重装（卸旧 → 拉产物 → 装新）。这套东西把它变成自动：**产物一变 → 前端自己重装**。
 *
 * ## 与 providerWatcher 同一套做法（为什么不 fs.watch）
 *
 * 照抄 providers/watch.ts 的结论：fs.watch 在 Windows 上对"编辑器保存"的表现不一致
 * （先删后建 / 写临时文件再改名），且不告诉你内容变没变。轮询**内容签名**（文件名 + 大小 +
 * 修改时间）跨平台一致，碰一下文件但内容没变也不会白通知。
 *
 * 只盯**会被加载的产物**（`<插件>/dist/*.js`，跳过 `_`/`.` 开头的），
 * 所以改源码、改 README、改测试都不会触发 —— 只有真产物变了才通知（改完记得 build）。
 *
 * ## 为什么是 SSE
 *
 * 与 kv 实时通道同一个理由（见 routes/events.ts）：数据流天生单向 —— 服务器只需喊一声
 * "某插件产物变了"，浏览器要做什么已经有现成的 HTTP 了。不用为单向通知背上 WebSocket 的
 * 重连/心跳/粘包复杂度。
 *
 * ## 契约
 *
 *   GET /api/plugin-events  → text/event-stream
 *   data: {"type":"plugin-changed","id":"plugin-style-library","name":"style-library"}
 *   : ping                                     保活（客户端忽略）
 *
 * 有意**只报"哪个插件的产物变了"**，不带产物内容：前端自己按 id/地址去拉最新产物
 * （那条路已经存在：window.MiniCanvasPlugin.reload）。服务端不当代码分发器。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'

/** 与 events.ts 同口径的保活间隔（低于常见 30 秒空闲超时） */
const PING_INTERVAL_MS = 25_000
/** 轮询间隔：够快（改完 build 后 2 秒内看到），几乎不耗资源 */
const POLL_INTERVAL_MS = 2000

/** 一件变更事件（推给前端的形状） */
export interface PluginChangeEvent {
  type: 'plugin-changed'
  /** 插件目录名（= 清单里的 id） */
  id: string
  /** 插件运行时名（清单里的 name；取不到就回落成 id） */
  name: string
}

/** 一个插件产物目录签名的组成：产物文件 + dist 的 mtime。 */
async function distSignature(pkgDir: string): Promise<string> {
  const dist = path.join(pkgDir, 'dist')
  let names: string[]
  try {
    names = await fs.readdir(dist)
  } catch {
    return '' // 没 dist = 还没构建；与"空"等价
  }
  const parts: string[] = []
  for (const n of names) {
    if (!n.endsWith('.js') || n.endsWith('.min.js')) continue
    try {
      const st = await fs.stat(path.join(dist, n))
      parts.push(n + ':' + st.size + ':' + Math.round(st.mtimeMs))
    } catch {
      /* 扫描间隙被删：跳过，下一轮签名自然变 */
    }
  }
  // 把 dist 目录本身的 mtime 也算进去："删掉一个旧产物"这种变化也能被察觉
  try {
    const st = await fs.stat(dist)
    parts.push('@dir:' + Math.round(st.mtimeMs))
  } catch {
    /* 忽略 */
  }
  return parts.sort().join('|')
}

/**
 * 算整个插件目录的内容签名：`插件名=签名` 用 \n 连。
 * 只有会被加载的插件（有 dist、名字不以 _/. 开头）才进签名。
 */
export async function pluginsDirSignature(pluginsDir: string | undefined): Promise<string> {
  if (!pluginsDir) return ''
  let entries: Array<import('node:fs').Dirent>
  try {
    entries = await fs.readdir(pluginsDir, { withFileTypes: true })
  } catch {
    return ''
  }
  const parts: string[] = []
  for (const e of entries) {
    if (!e.isDirectory()) continue
    if (e.name.startsWith('_') || e.name.startsWith('.')) continue
    const sig = await distSignature(path.join(pluginsDir, e.name))
    if (!sig) continue // 没构建 = 不参与（构建出来那一刻签名从无到有 → 触发一次，正好）
    parts.push(e.name + '=' + sig)
  }
  return parts.sort().join('\n')
}

/** 从插件目录读它的运行时名（package.json 的 miniCanvas.pluginName，退回落包名，再退回落目录名） */
async function pluginNameOf(pkgDir: string, fallback: string): Promise<string> {
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(pkgDir, 'package.json'), 'utf8')) as {
      name?: string
      miniCanvas?: { pluginName?: string }
    }
    const mc = pkg.miniCanvas?.pluginName
    if (typeof mc === 'string' && mc) return mc
    if (typeof pkg.name === 'string' && pkg.name) return pkg.name.replace(/^@[^/]+\//, '')
  } catch {
    /* 没有/坏 package.json 不致命 */
  }
  return fallback
}

/** 把两份签名拆成 id → 签名 的 map（用于找出"这次变了哪几个"） */
function toMap(sig: string): Map<string, string> {
  const m = new Map<string, string>()
  if (!sig) return m
  for (const line of sig.split('\n')) {
    const i = line.indexOf('=')
    if (i > 0) m.set(line.slice(0, i), line.slice(i + 1))
  }
  return m
}

export interface PluginWatcher {
  /** 立刻比对一次（启动取基准；测试也用它） */
  check(): Promise<PluginChangeEvent[]>
  stop(): void
}

/**
 * 建一个插件目录监视器。
 *
 * @param pluginsDir 插件目录（cloud-server 的 pluginsDir 服务）
 * @param onChange   变更回调（拿到"这次变了哪些插件"）
 * @param intervalMs 轮询间隔（默认 2 秒）
 */
export function watchPluginDirs(
  pluginsDir: string | undefined,
  onChange: (changes: PluginChangeEvent[]) => void,
  intervalMs = POLL_INTERVAL_MS,
): PluginWatcher {
  /**
   * 上次看到的签名。`null` = 还没取基准。
   * 为什么用 null 而不是空串：目录一开始什么都没有时签名就是空串，
   * 那样"第一次构建出产物"会被当成基准吞掉、不通知（照抄 providers/watch.ts 的踩坑）。
   */
  let last: string | null = null
  let stopped = false
  let timer: ReturnType<typeof setInterval> | null = null

  async function check(): Promise<PluginChangeEvent[]> {
    const sig = await pluginsDirSignature(pluginsDir)
    if (last === null) {
      last = sig // 取基准，不通知
      return []
    }
    if (sig === last) return []
    const prev = toMap(last)
    const next = toMap(sig)
    last = sig

    // 找出新增 / 变化的插件（删除的不通知 —— 前端没有"卸载别人产物"的语义）
    const changedIds: string[] = []
    for (const [id, s] of next) {
      if (prev.get(id) !== s) changedIds.push(id)
    }
    if (changedIds.length === 0) return []
    const events: PluginChangeEvent[] = []
    for (const id of changedIds) {
      const name = pluginsDir ? await pluginNameOf(path.join(pluginsDir, id), id) : id
      events.push({ type: 'plugin-changed', id, name })
    }
    return events
  }

  // 立刻取基准（免得开局那 2 秒里的改动被当基准吞掉）
  void check().catch(() => {})

  timer = setInterval(() => {
    if (stopped) return
    void check()
      .then((changes) => {
        if (changes.length) onChange(changes)
      })
      .catch(() => {
        /* 单次比对失败不带崩定时器 */
      })
  }, intervalMs)

  return {
    check,
    stop() {
      stopped = true
      if (timer) clearInterval(timer)
      timer = null
    },
  }
}

/**
 * 建「插件热重载」路由（Hono 子应用，供内置插件 adopt）：GET /api/plugin-events（SSE）。
 *
 * 监视器**按需起停**：只在有 SSE 订阅者时才轮询目录（没人看就不花这份开销）。
 * 于是测试（没有订阅者）永远不会有定时器在跑，不必给每个用例加开关。
 *
 * @param pluginsDir 插件目录（可取不到：此时 SSE 照常应答，只是永远不会报变更）
 * @param intervalMs 轮询间隔（测试可传小值；缺省 2 秒）
 */
export function pluginWatchRoutes(pluginsDir: string | undefined, intervalMs = POLL_INTERVAL_MS): Hono {
  const app = new Hono()
  /** 订阅者集合（每条 SSE 一个 emit） */
  const subscribers = new Set<(e: PluginChangeEvent) => void>()
  /** 目录监视器（首/末订阅者进出时起停） */
  let watcher: PluginWatcher | null = null

  function startWatcher(): void {
    if (watcher) return
    watcher = watchPluginDirs(
      pluginsDir,
      (changes) => {
        for (const ch of changes) for (const emit of subscribers) emit(ch)
      },
      intervalMs,
    )
  }
  function stopWatcher(): void {
    watcher?.stop()
    watcher = null
  }

  app.get('/api/plugin-events', (c) =>
    streamSSE(c, async (stream) => {
      let closed = false
      const queue: PluginChangeEvent[] = []
      let wake: (() => void) | null = null

      const emit = (e: PluginChangeEvent): void => {
        if (closed) return
        queue.push(e)
        wake?.()
      }
      subscribers.add(emit)
      startWatcher() // 第一个订阅者：开始盯目录

      stream.onAbort(() => {
        closed = true
        subscribers.delete(emit)
        if (subscribers.size === 0) stopWatcher() // 最后一个走了：别空跑
        wake?.()
      })

      const ping = setInterval(() => {
        if (!closed) void stream.write(': ping\\n\\n')
      }, PING_INTERVAL_MS)

      try {
        while (!closed) {
          if (queue.length === 0) {
            await new Promise<void>((resolve) => {
              wake = resolve
            })
            wake = null
            continue
          }
          await stream.writeSSE({ data: JSON.stringify(queue.shift()!) })
        }
      } finally {
        closed = true
        clearInterval(ping)
        subscribers.delete(emit)
        if (subscribers.size === 0) stopWatcher()
      }
    }),
  )

  return app
}

