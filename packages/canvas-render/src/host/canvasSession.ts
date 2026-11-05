/**
 * canvasSession —— 「进入画布 / 离开画布」这一对动作的唯一入口。
 *
 * 模型（见 docs/问题整理/18-项目页插件面板与上下文分层.md）：
 * - 根级 Provider 常驻一个 Context，应用级服务（save/resources/注册表/命令）一直在；
 * - 进入画布：往同一份 Context 热装 canvas-data，补 doc/selection/view/canvas/nodeToolbar，
 *   再恢复当前画布、装业务插件；
 * - 离开画布：先落盘，再卸 canvas-data，依赖它的插件由内核自动回退 PENDING。
 *
 * 为什么不用手写 inject/撤销：内核只会在「提供服务的插件被卸载」时回退依赖方；
 * 手写 inject 撤销不会触发回退。所以画布服务必须住在一个可装卸的普通插件里。
 */
import { CANVAS_BASE_PLUGIN_NAME, type Context } from '@mini-canvas/canvas-data'
import type { CanvasNode, StorageAdapter, CanvasAppBaseServices } from '@mini-canvas/canvas-data'
import type { PluginClassLike, PluginModule } from '@mini-canvas/kernel'
import { createMiniCanvasHost, type CanvasHostHandle, type MiniCanvasApi } from './createMiniCanvasHost'
import type { PluginManager } from './pluginManager'

type CanvasReadyPlugin = PluginModule & {
  onCanvasReady?: (ctx: Context) => void | (() => void)
}

/**
 * 这次会话要叫醒哪些插件的 onCanvasReady。
 *
 * 为什么不能只看 opts.plugins（画布级清单）：cloud-client、auto-save 这类
 * 应用级插件也有画布钩子（云端动作清单 / 存档域切换都要等 doc 就位）。
 * 只传画布级清单时它们永远收不到钩子 —— 用户实测 2026-11-05：选中图片底部状态栏不出现，
 * 因为云端动作一条都没注册进 node/bar。
 *
 * 规则：画布级清单在前（按装配序），再把根 Context 里已激活的应用级插件补上，
 * 同一个 name 只叫一次。只补 active 的，PENDING/FAILED 的插件还不到能用的时候。
 */
function canvasReadyPlugins(opts: MountCanvasOptions): CanvasReadyPlugin[] {
  const out: CanvasReadyPlugin[] = []
  const seen = new Set<string>()
  const push = (plugin: PluginModule | PluginClassLike | undefined): void => {
    if (!plugin || typeof plugin !== 'object') return
    const p = plugin as CanvasReadyPlugin
    if (typeof p.onCanvasReady !== 'function') return
    const key = p.name ?? ''
    if (key) {
      if (seen.has(key)) return
      seen.add(key)
    }
    out.push(p)
  }
  for (const plugin of opts.plugins ?? []) push(plugin)
  const active = new Set(
    opts.ctx
      .inspectPlugins()
      .filter((p) => p.state === 'active')
      .map((p) => p.name),
  )
  for (const pluginName of opts.ctx.listPlugins()) {
    if (!active.has(pluginName)) continue
    push(opts.ctx.pluginModule(pluginName))
  }
  return out
}

/** 画布会话句柄：一次挂载的完整结果。 */
export interface CanvasSessionHandle {
  ctx: Context
  host: CanvasHostHandle
  api: MiniCanvasApi
  manager: PluginManager
  /** 卸载本会话（先落盘、再卸 canvas-data；可重复调用，不抛错）。 */
  dispose(): Promise<void>
}

export interface MountCanvasOptions {
  /** 根级唯一 Context（必须已 start）。 */
  ctx: Context
  /** 根级已经建好的应用级底座（save/resources/注册表/命令）。 */
  appBase: CanvasAppBaseServices
  /** 当前画布的业务插件（进入画布时才装）。 */
  plugins?: (PluginModule | PluginClassLike)[]
  /** 首次（存储为空）生成默认画布。 */
  seed?: () => CanvasNode[]
  /** 独立调试用；缺省沿用根级 ctx 的 isDev。 */
  dev?: boolean
  /** 挂到 window 的调试 key；缺省不挂（根级 Provider 已经有自己的入口）。 */
  windowKey?: string
}

let active: CanvasSessionHandle | undefined
let generation = 0
/**
 * 挂载串行队列。
 *
 * 为什么需要：连续点两张画布时，两次 mountCanvas 会同时往同一个 Context 装
 * canvas-data，第二次撞上"重名插件"直接失败，用户看到的是白屏或停在旧画布。
 * 串行后每一次都等上一份卸干净再装；旧异步恢复也不可能覆盖最后一份。
 */
let mountQueue: Promise<void> = Promise.resolve()

/** 当前是否在画布内（项目页为 false）。 */
export function hasActiveCanvasSession(): boolean {
  return active !== undefined
}

/**
 * 进入画布：装会话、恢复当前画布、装业务插件。
 *
 * 幂等：已经有一份会话时先卸掉旧的（画布 A → B 只换 id 也会走这里）。
 * 并发：每次挂载带 generation，旧的异步恢复结果不会覆盖新的。
 */
export async function mountCanvas(opts: MountCanvasOptions): Promise<CanvasSessionHandle> {
  const run = mountQueue.then(() => mountCanvasNow(opts))
  // 失败也要放行队列，否则一次挂载失败会让后续所有切换卡死。
  mountQueue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

async function mountCanvasNow(opts: MountCanvasOptions): Promise<CanvasSessionHandle> {
  const gen = ++generation
  if (active) await unmountCanvas()

  const created = await createMiniCanvasHost({
    ctx: opts.ctx,
    // 根级底座已经作为 `canvas-base` 插件装进同一份 Context；这里只传实例，
    // 不再另立插件名（否则会出现两个名字指向同一层底座）。
    appBase: { pluginName: CANVAS_BASE_PLUGIN_NAME, services: opts.appBase },
    coldPlugins: opts.plugins ?? [],
    seedDefault: opts.seed,
    dev: opts.dev,
  })

  // 旧 generation 的恢复已经完成：把刚建好的这份收掉，别覆盖新画布。
  if (gen !== generation) {
    created.host.stop()
    throw new Error('[canvas-data] superseded by a newer mount')
  }
  if (opts.windowKey) created.exposeToWindow(opts.windowKey)

  /**
   * 画布会话就绪钩子：插件在 apply 里只能拿到应用级服务，
   * 需要 doc/selection 的部分（如云端同步）在这里挂上。
   * 钩子抛错不影响画布本身：记一条 warn，继续往下走。
   */
  const sessionDisposers: Array<() => void> = []
  for (const plugin of canvasReadyPlugins(opts)) {
    const hook = plugin.onCanvasReady
    if (typeof hook !== 'function') continue
    try {
      const dispose = hook(opts.ctx)
      if (typeof dispose === 'function') sessionDisposers.push(dispose)
    } catch (err) {
      console.warn('[canvas-data] onCanvasReady 失败：' + ((plugin as { name?: string }).name ?? '?'), err)
    }
  }

  let disposed = false
  const handle: CanvasSessionHandle = {
    ctx: created.host.ctx,
    host: created.host,
    api: created.api,
    manager: created.manager,
    dispose: async () => {
      if (disposed) return
      disposed = true
      if (active === handle) active = undefined
      // 先落盘：会话一旦卸掉，save 服务就没了。
      try {
        await created.host.save.flush()
      } catch {
        /* 落盘失败不该挡住离开画布 */
      }
      for (const dispose of sessionDisposers.reverse()) {
        try {
          dispose()
        } catch {
          /* 单个清理失败不打断其它 */
        }
      }
      created.host.stop()
    },
  }
  active = handle
  return handle
}

/** 离开画布：可重复调用；没有会话时是安全 no-op。 */
export async function unmountCanvas(): Promise<void> {
  const current = active
  if (!current) return
  await current.dispose()
}
