/**
 * plugin-hot-reload · 后台半 —— 「按绝对路径装/卸后台插件」。
 *
 * ## 它解决什么（用户口径 2026-11-25）
 *
 * 调试时插件的后台产物就在仓库里（`packages/plugins/<插件>/dist/server.js`），
 * watch 上报的是**这个文件的绝对路径**。后台这一半直接读它、装进内核 ——
 * 不需要复制进数据根的插件目录，也不需要改对方的 package.json。
 *
 * 前端那一半（`src/data/hotReload.ts`）只负责 `fetch` 这两条路由；浏览器执行不了服务端代码，
 * 所以真正的「读文件 → import」只能在这里做。
 *
 * ## 路由
 *
 *   POST /api/hot-reload/server/install    { file, id? } → { ok, name?, error? }
 *   POST /api/hot-reload/server/uninstall  { file?, id?, name? } → { ok }
 *
 * 都声明 `admin`：装插件 = 执行服务端代码，必须带管理令牌。
 *
 * ## 边界（两条都别放宽）
 *
 * 1. **只收绝对路径**。相对路径的含义取决于服务进程的 cwd，接收它等于「看起来成功、装错文件」。
 * 2. **只在本机回环上生效**。`ctx.runtime` 是宿主注入的运行期装卸能力，本机调试才有；
 *    没有它（纯框架单测 / 非本机部署）就静静地不装这两条路由，而不是装一半再报错。
 *
 * 装进来的插件只活在**当前进程内存里**：服务重启就没了（它本来就不在插件目录里）。
 * 这是调试语义，不是安装语义 —— 要持久化就走插件管理 / NPM 安装。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'

export const name = 'hot-reload'

/** 与 hono 的 Context 只需要这几个方法；不 import hono 类型，产物保持零依赖 */
interface HonoLike {
  req: { json(): Promise<unknown> }
  json(body: unknown, status?: number): Response
}

/** 后台插件 ctx 的最小面（与 kernel 的 PluginScope 兼容；只列用到的） */
interface ServerCtx {
  routes: {
    post(path: string, handler: (c: HonoLike) => Promise<Response> | Response, auth?: 'admin' | 'public'): void
  }
  runtime?: { install(mod: unknown): void; uninstall(nameOrId: string): boolean }
}

/** 像不像一个后台插件模块（与 serverFramework/pluginLoader.ts 的判据同口径） */
function isValidServerPlugin(v: unknown): v is { name: string; apply: (...a: never[]) => unknown } {
  if (!v || typeof v !== 'object') return false
  const m = v as { name?: unknown; apply?: unknown }
  return typeof m.name === 'string' && m.name !== '' && typeof m.apply === 'function'
}

/**
 * 读文件 → import → 校验 → 装进内核。返回内核里的真名。
 *
 * ## 为什么要先卸旧（2026-11-25 真机踩到）
 *
 * 内核按**插件名**索引，已存在同名时 `install()` 会抛
 * `[core] Duplicate plugin name: "plugin-node-ui"` —— 于是「重装」永远 400，
 * 后台半一直是第一次装进去的那份（改了代码也不生效，看起来像热重载没起作用）。
 * 调试语义就是「把现在这份换掉」，所以这里是**替换**：先按同名卸掉，再装新的。
 * 卸载失败（内核里没有）不算错 —— 那正是「还没装过」的第一次安装。
 */
async function installFromFile(
  runtime: NonNullable<ServerCtx['runtime']>,
  file: string,
  /** 调用方给的插件 id（目录名 / 上报名）；通常不等于产物导出的 name，两个都要试 */
  id = '',
): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  if (!path.isAbsolute(file)) {
    return { ok: false, error: 'file 必须是绝对路径（相对路径会按服务进程的 cwd 解析，容易装错文件）：' + file }
  }
  let text: string
  try {
    text = await fs.readFile(file, 'utf8')
  } catch (err) {
    return { ok: false, error: '读不到文件：' + file + '（' + (err instanceof Error ? err.message : String(err)) + '）' }
  }
  try {
    // data: URL：不需要基准目录，自包含单文件产物直接可用（与宿主加载器同一套做法）
    const mod = (await import(/* @vite-ignore */ 'data:text/javascript,' + encodeURIComponent(text))) as
      | ({ default?: unknown } & Record<string, unknown>)
      | { default?: unknown }
    const candidate = (mod as { default?: unknown }).default ?? mod
    if (!isValidServerPlugin(candidate)) {
      return { ok: false, error: '不是合法后台插件（需导出 name 与 apply）' }
    }
    // 替换语义：先摘掉同名的旧版本（按导出的 name 与调用方给的 id 都试一遍）
    for (const key of [candidate.name, id]) {
      if (!key) continue
      try {
        runtime.uninstall(key)
      } catch {
        /* 内核里没有这个键，或摘除时有别的插件在跑：交给下面的 install 判重 */
      }
    }
    runtime.install(candidate)
    return { ok: true, name: candidate.name }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export function apply(ctx: ServerCtx): void {
  // 没有运行期装卸能力：不装这两条路由（纯框架单测 / 非本机部署）
  const runtime = ctx.runtime
  if (!runtime || typeof runtime.install !== 'function' || typeof runtime.uninstall !== 'function') return

  ctx.routes.post('/api/hot-reload/server/install', async (c) => {
    const body = (await c.req.json().catch(() => undefined)) as { file?: unknown; id?: unknown } | undefined
    const file = typeof body?.file === 'string' ? body.file.trim() : ''
    const id = typeof body?.id === 'string' ? body.id.trim() : ''
    if (!file) return c.json({ ok: false, error: '需要 file（后台产物在本机上的绝对路径）' }, 400)
    const r = await installFromFile(runtime, file, id)
    return c.json(r, r.ok ? 200 : 400)
  }, 'admin')

  ctx.routes.post('/api/hot-reload/server/uninstall', async (c) => {
    const body = (await c.req.json().catch(() => undefined)) as
      | { file?: unknown; id?: unknown; name?: unknown }
      | undefined
    if (!body) return c.json({ ok: false, error: 'body 不是合法 JSON' }, 400)
    const file = typeof body.file === 'string' ? body.file.trim() : ''
    const id = typeof body.id === 'string' ? body.id.trim() : ''
    const pluginName = typeof body.name === 'string' ? body.name.trim() : ''
    // 卸载时的候选：显式插件名 → 显式 id → 文件路径。宿主按「内核里登记的名字」摘，
    // 三者未必相同（id 是目录/路径，name 是产物导出的名字），所以都试一遍。
    const candidates = [pluginName, id, file].filter((x) => x.length > 0)
    if (candidates.length === 0) return c.json({ ok: false, error: '需要 id / file / name 之一' }, 400)
    for (const key of candidates) {
      try {
        if (runtime.uninstall(key)) return c.json({ ok: true })
      } catch {
        /* 这个候选不是内核里的名字：试下一个 */
      }
    }
    // 内核里本来就没有 = 目标状态已达成（调试侧只关心它现在不在）
    return c.json({ ok: true, note: '内核里没有这个插件，视为已卸载' })
  }, 'admin')
}
