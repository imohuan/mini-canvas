/**
 * serverFramework —— 后台插件宿主（把 cloud-server 变成「和前端一样的插件容器」）。
 *
 * ## 生命周期（硬约束，别改）
 *
 * Hono 首次 `fetch` 后路由表冻结（实测）。全程分两段：
 *
 * **装配段**（`start()` 之前）——可以往 `app` 注册任何东西：
 *   ① `app.use('*', cors())`（cors 必须最先，实测后注册不生效）
 *   ② `ctx.inject(名, 实例)` 上架宿主服务
 *   ③ `ctx.plugin(内置插件)` 登记（此阶段只登记、不 apply）
 *   ④ 宿主直挂的固定路由（如 MCP）
 *
 * **启动段**（`await start()`）——顺序不可调换：
 *   ⑤ `await ctx.start()`：插件 apply 跑完 → 注册场里已有全部路由
 *   ⑥ 把插件路由翻成 Hono 代理（`flushRoutes`）
 *   ⑦ `afterRoutes` 回调：挂**兜底类**路由（ui 静态 + SPA 回落）——
 *      **必须在插件路由之后**，否则 `get('*')` 会把 /health 之类的插件路由全吃掉（实测）。
 *
 * `app` 是 Proxy：注册方法与 `fetch` 都可用，但 **`fetch` 在启动段结束前会抛错**
 * （防止有人在装配未完成时 fetch，把路由表冻在半成品状态）。
 */
import { Hono } from 'hono'
import { Context, setDefaultCapabilityLayerFactory } from '@mini-canvas/kernel'
import { createServerCapabilityLayer } from './capabilityLayer.js'
// 声明合并：让 `ctx.routes` 在类型上存在（纯类型，运行时无副作用）
import './capabilityTypes.js'
import { flushRoutes } from './routes.js'

export interface ServerFramework {
  /** 内核上下文（后台插件的 apply 收到它） */
  ctx: Context
  /** Hono 实例（Proxy：fetch 需等 start() 之后） */
  readonly app: Hono
  /**
   * 启动：装载插件 → 挂插件路由 → 执行 `afterRoutes`（挂兜底路由）。
   * @param afterRoutes 可选：在**插件路由挂好之后**执行的回调 —— 用来挂 ui 静态/SPA 兜底
   *   （兜底类必须在插件路由之后，否则会吃掉插件路由；见文件头 ⑦）。
   *   **只会被调一次**（重复 start 不会再触发）。
   */
  start(afterRoutes?: () => void): Promise<void>
  /** 停：回收插件作用域（jobs 定时器 / store 命名空间等随 ctx.stop 一起清） */
  stop(): void
  /** 是否已启动 */
  readonly started: boolean
}

export interface ServerFrameworkOptions {
  /**
   * 数据根目录：ctx.store 的插件私有数据落在它的 plugin-data/ 下。
   * 缺省用进程当前目录（测试常见；真实服务由 server.ts 传真实数据根）。
   */
  root?: string
  /**
   * 是否开启"运行期热装兜底"：装一个 catch-all 代理，让**运行期**新注册的后台插件路由
   * 无需重启即可命中（见 routes.ts ④）。真实服务（cloud-server，可能从 NPM 现装插件）开 true；
   * 测试里的纯 framework 缺省 false（不改变既有路由语义）。
   */
  hotFallback?: boolean
}

export function createServerFramework(opts: ServerFrameworkOptions = {}): ServerFramework {
  const raw = new Hono()
  let started = false
  /** runtime 转发壳（见 setDefaultCapabilityLayerFactory 处的说明） */
  const runtimeRef: { install?: (m: unknown) => void; uninstall?: (n: string) => boolean } = {}

  // `app` 用 Proxy 包住**请求入口**（fetch / request / fire 三个都会触发路由匹配）。
  //
  // 为什么不用 `Object.create(raw)`：Hono 内部用**私有字段**（`#router` 之类），
  // 原型链继承会让 `this` 不是真正的 Hono 实例 → 抛 `Receiver must be an instance of class _Hono`
  // （实测踩过）。Proxy 转发时调用者仍是 raw，私有字段照常可用。
  //
  // 为什么要挡：Hono 首次请求后路由表冻结，装配未完成就请求会把路由表冻在半成品状态。
  // 审查发现早先只包了 `fetch`，而 `request()`/`fire()` 内部直接调 `this.fetch(...)`，
  // 绕过了守卫 —— 所以三个入口都要拦。注册类方法（get/post/use/route/…）原样转发、随时可用。
  const guard = (): void => {
    if (started) return
    throw new Error(
      '[serverFramework] 装配未完成就发起了请求：Hono 路由表在首次请求后会冻结，' +
        '请先 await host.start()（它会把插件路由挂上）再发请求。',
    )
  }
  const app = new Proxy(raw, {
    get(target, prop) {
      if (prop === 'fetch') {
        return (...args: Parameters<typeof target.fetch>) => {
          guard()
          return target.fetch(...args)
        }
      }
      if (prop === 'request') {
        return (...args: Parameters<typeof target.request>) => {
          guard()
          return target.request(...args)
        }
      }
      if (prop === 'fire') {
        return () => {
          guard()
          return target.fire()
        }
      }
      const v = Reflect.get(target, prop, target)
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v
    },
  }) as Hono

  // 能力层经「全局默认工厂」装进 Context（与前端同一机制）。
  //
  // ⚠️ 这个 setter 是**进程级全局**，但 `new Context()` 在**构造那一刻**就取快照并
  // 立刻产出 layer，所以「先建 host A、再建 host B」不会让 A 拿到 B 的 app ——
  // 有测试锁住这个隔离性（serverFrameworkIsolation.test.ts）。
  setDefaultCapabilityLayerFactory(() =>
    createServerCapabilityLayer({
      app: raw,
      root: opts.root ?? process.cwd(),
      // runtime 晚绑定：layer 在 new Context() 那刻就建好，而 ctx 在下一行才有，
      // 故先给一个转发壳，等 ctx 就绪再填真身（见下）。
      runtime: {
        install: (m) => runtimeRef.install?.(m),
        uninstall: (n) => runtimeRef.uninstall?.(n) ?? false,
      },
    }),
  )
  const ctx = new Context()
  // 填 runtime 真身：把根 Context 的运行期装卸能力接到上面那个转发壳上
  runtimeRef.install = (m) => {
    ctx.installPlugin(m as never)
  }
  runtimeRef.uninstall = (n) => ctx.uninstallPlugin(n)

  let afterRoutesCb: (() => void) | undefined

  // ⑥⑦ 挂代理 + 兜底路由的时机 = `ctx:ready`（`ctx.start()` 的最后一步，此时全部插件 apply 已跑完）。
  // 挂在这里而不是只挂在自己 start() 上，是为了**直接调 ctx.start() 也生效**
  // （测试与别处都这么用）。
  //
  // ⚠️ `started` 是**唯一闸门**：它保证 flushRoutes 与 afterRoutes 各只跑一次
  // （审查发现的 bug：早先在 start() 末尾又调了一次 afterRoutes，导致 ui 兜底重复注册）。
  ctx.on('ctx:ready', () => {
    if (started) return
    flushRoutes(raw, ctx, { hotFallback: opts.hotFallback === true })
    // ⑦ 兜底路由（ui 静态 + SPA）：**必须最后**，否则 get('*') 吃掉插件路由
    afterRoutesCb?.()
    started = true
  })

  return {
    ctx,
    app,
    get started(): boolean {
      return started
    },
    async start(afterRoutes?: () => void): Promise<void> {
      // 幂等：已启动就直接返回（重复调不再触发任何装配动作，见上面 started 闸门）
      if (started) return
      afterRoutesCb = afterRoutes
      // 全部装配动作都在 ctx:ready 监听器里（见上）；这里只负责触发。
      await ctx.start()
    },
    stop(): void {
      // 回收插件作用域：jobs 的定时器、store 的命名空间清理等都在插件的 ctx.effect 里，
      // 不调 ctx.stop() 它们永远不会 dispose（审查发现的泄漏）。
      ctx.stop()
      started = false
    },
  }
}

export { ROUTE_FIELD, MOUNT_FIELD, normalizePath } from './routes.js'
export type { RouteRegistrar, RouteEntry, MountEntry } from './routes.js'
