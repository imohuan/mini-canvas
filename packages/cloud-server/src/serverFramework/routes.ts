/**
 * routes —— `ctx.routes` 路由注册能力段的实现（后台插件系统的「用户点 1：路由注册」）。
 *
 * 目标：**后台新增一个接口 = 装一个插件**。插件在自己的 apply 里写
 * `ctx.routes.get('/api/x', handler)`；卸载插件时这条路由自动消失。
 *
 * ## 三条实测结论（决定了实现方式，别改回去）
 *
 * 1. **Hono 首次 `app.fetch` 后路由表冻结**：之后再 `app.get()` / `app.on()` 抛
 *    `Can not add a route since the matcher is already built.`（实测）。
 *    所以「运行期往 Hono 动态加/删路由」这条路根本走不通。
 * 2. **Hono 没有反注册 API**：`app.routes` 只增不减（实测），加进去就摘不掉。
 * 3. **`app.all('*')` 兜底能拿到 method + path，且可反复 fetch**（实测）——
 *    所以「一次性挂代理、代理内部查表」是可行的。
 *
 * ## 由此得到的实现：启动期一次性挂代理 + 每次请求查注册场
 *
 * - 插件把 handler 写进**内核注册场**（`server/route`），条目归注册方插件，
 *   用 `ctx.registryOf` 的 `ctx.effect` 绑定 → **卸载即从表里移除**。
 * - `flushRoutes()` 在 `ctx.start()` 结束时（`ctx:ready`）执行一次：
 *   给注册场里**已出现过的每个 path** 往 Hono 挂一个**代理 handler**；
 *   代理每次请求现查注册场 —— 命中就调真 handler，没命中就 `next()`。
 * - **Hono 的路由表自始至终不动**，所以结论 1、2 的两个限制都不存在；
 *   连带好处：**卸载/重装即时生效**（表是活的），比「装载期一次性翻译成静态路由」更强。
 *
 * ## 匹配语义（写明，免得作者误解）
 *
 * - **同 method + 同 path：先注册者优先**（与 Hono 原生行为一致，实测）。
 *   实现方式 = 每个注册用「插件名」当 id → 不同插件各成一条、互不覆盖；
 *   读取时取该 key 下**第一条**（注册场按插入序返回）。先装的那个赢，卸载它下一个顶上。
 * - `mount(prefix, subApp)`：整段转发到子应用（剥掉 prefix 再 `subApp.fetch`）。
 *   子应用路由在 **mount 之前**必须建齐（Hono `route()` 的固有行为）。
 * - ⚠️ **路由必须在 `ctx.start()` 之前注册**（装载期）。运行期新注册的 path 没有代理，会 404。
 */
import { Hono, type Handler } from 'hono'
import type { Context, PluginScope } from '@mini-canvas/kernel'

/** 注册场名：路由条目（key = `METHOD path`，id = 注册方插件名） */
export const ROUTE_FIELD = 'server/route'
/** 注册场名：挂载的子应用（key = 前缀，id = 注册方插件名） */
export const MOUNT_FIELD = 'server/route-mount'

/** 一条已注册的路由（opaque 交给 Hono 处理函数） */
export interface RouteEntry {
  /** HTTP 方法（大写；'USE' = 中间件） */
  method: string
  /** 已归一的路径 */
  path: string
  /** Hono 处理函数 */
  handler: Handler
}

/** 一次挂载：前缀 → 子应用 */
export interface MountEntry {
  prefix: string
  app: Hono
}

/** `ctx.routes` 的形状（插件作者用的那个对象） */
export interface RouteRegistrar {
  get(path: string, handler: Handler): void
  post(path: string, handler: Handler): void
  put(path: string, handler: Handler): void
  patch(path: string, handler: Handler): void
  delete(path: string, handler: Handler): void
  /** 所有方法都收（含 HEAD/OPTIONS） */
  all(path: string, handler: Handler): void
  /** 挂中间件（对该 path 前缀生效；先于方法路由执行） */
  use(path: string, mw: Handler): void
  /** 挂子应用（先把子应用路由建齐，再 mount）；按前缀整段转发 */
  mount(prefix: string, app: Hono): void
  /**
   * 把已建好的子应用的**路由逐条摊平**进来（前缀由子应用自己写在 path 里）。
   * 用于「把现有 xxxRoutes(honoApp) 原样变成一个插件的路由」——
   * 比 mount 更贴合现有代码（那些路由本来就写全了路径，如 /api/canvases/:id）。
   */
  adopt(app: Hono): void
}

/** 路径归一：补前导 `/`、去尾斜杠（根除外）。空串 → '/' */
export function normalizePath(path: string): string {
  if (!path) return '/'
  const p = path.startsWith('/') ? path : '/' + path
  return p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p
}

/**
 * 建一个绑定到某插件作用域的路由注册器。
 *
 * 同一个 kind 的注册场是全插件共享的一张表；这里用**插件名当条目 id**，
 * 于是「不同插件注册同 path」= 同一 key 下两条并列（先注册者在前），
 * 「同一插件重复注册同 path」= 替换自己那条（热更语义）。
 *
 * @param ctx       调用方插件的 scope（能力层为每个 scope 各建一个注册器）
 * @param scopeName 放置方名字（写进条目 id；根上下文是 '<host>'）
 */
export function createRouteRegistrar(ctx: PluginScope, scopeName: string): RouteRegistrar {
  const field = ctx.registryOf<RouteEntry>(ROUTE_FIELD)
  const mounts = ctx.registryOf<MountEntry>(MOUNT_FIELD)

  function add(method: string, path: string, handler: Handler): void {
    const p = normalizePath(path)
    field.add(method + ' ' + p, { method, path: p, handler }, { id: scopeName })
  }

  return {
    get: (path, handler) => add('GET', path, handler),
    post: (path, handler) => add('POST', path, handler),
    put: (path, handler) => add('PUT', path, handler),
    patch: (path, handler) => add('PATCH', path, handler),
    delete: (path, handler) => add('DELETE', path, handler),
    all: (path, handler) => add('ALL', path, handler),
    use: (path, mw) => add('USE', path, mw),
    mount: (prefix, app) => {
      const p = normalizePath(prefix)
      mounts.add(p, { prefix: p, app }, { id: scopeName })
    },
    adopt: (app) => {
      for (const r of app.routes) {
        // 逐一登记，**严格保持子应用原本的注册顺序**。
        // 这条是正确性要求（实测）：Hono 的路由匹配是"先注册者优先"，
        // 而现有路由里有 /api/kv/events（静态）与 /api/kv/:type（动态）这种同层冲突，
        // 顺序一反，静态的就被动态的吃掉（events 会返回 kvtype:events）。
        // 子应用内部的注册顺序本来就是对的（eventsRoutes 刻意排在 kvRoutes 前），
        // 这里原样搬过来即可。
        add(r.method, r.path, r.handler as unknown as Handler)
      }
    },
  }
}

/**
 * 把注册场里已有的路由，一次性翻成 Hono 上的代理 handler。
 *
 * **只能调一次**，且必须在任何 `app.fetch` 之前（`ctx:ready` 时）。
 * 之后再调用会重复挂代理 / 撞上 Hono 的路由冻结。
 */
export function flushRoutes(app: Hono, ctx: Context, opts: { hotFallback?: boolean } = {}): void {
  const field = ctx.registryOf<RouteEntry>(ROUTE_FIELD)
  const mounts = ctx.registryOf<MountEntry>(MOUNT_FIELD)

  /** 每条代理：现查注册场，命中调真 handler，否则交给下游（下一个代理 / 404） */
  const proxyFor = (key: string) => (c: Parameters<Handler>[0], next: () => Promise<void>) => {
    const e = field.list(key)[0]
    return e ? (e.value.handler as (c: unknown, next: unknown) => unknown)(c, next) : next()
  }

  // ① 中间件先挂：Hono 的 use 只对它之后注册的路由生效，故必须排在方法路由之前
  for (const key of field.keys()) {
    if (!key.startsWith('USE ')) continue
    app.use(key.slice('USE '.length), proxyFor(key) as never)
  }

  // ② 方法路由
  for (const key of field.keys()) {
    if (key.startsWith('USE ')) continue
    const sp = key.indexOf(' ')
    const method = key.slice(0, sp)
    const path = key.slice(sp + 1)
    app.on(method as 'GET', path, proxyFor(key) as never)
  }

  // ③ 挂载：整段转发到子应用（剥掉前缀后交给子应用自己的 router）
  for (const prefix of mounts.keys()) {
    const proxy = (c: Parameters<Handler>[0], next: () => Promise<void>) => {
      const e = mounts.list(prefix)[0]
      if (!e) return next()
      const url = new URL(c.req.url)
      url.pathname = url.pathname.slice(prefix.length) || '/'
      return e.value.app.fetch(new Request(url, c.req.raw))
    }
    app.all(prefix, proxy as never)
    app.all(prefix + '/*', proxy as never)
  }

  // ④ **运行期热装兜底**：挂一条 catch-all，按 method+path 现查注册场。
  //
  // 为什么需要：② 只为"启动那一刻已存在的 path"挂了代理 —— Hono 路由表之后会冻死，
  // 运行期新注册的 path 在 Hono 里没有对应路由，请求会漏到 404。catch-all 让运行期装进来的
  // 后台插件（例如从 NPM 现装的）无需重启即可命中（实测：加它之前 404、加了之后 200）。
  //
  // 它排在 ② 之后 → 只接管 ② 没覆盖的 path，不改变既有路由优先级。
  // 只在"服务可能运行期装插件"时开（cloud-server）；测试里的纯 framework 默认不开，
  // 避免改变既有断言语义。
  if (opts.hotFallback) {
    app.all('*', ((c: Parameters<Handler>[0], next: () => Promise<void>) => {
      const key = c.req.method + ' ' + new URL(c.req.url).pathname
      const e = field.list(key)[0]
      return e ? (e.value.handler as (c: unknown, n: unknown) => unknown)(c, next) : next()
    }) as never)
  }
}
