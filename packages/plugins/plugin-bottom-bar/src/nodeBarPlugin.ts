/**
 * nodeBarPlugin —— bottom-bar 插件主体：读服务 nodeBar + 执行服务 nodeTask + 三个注册糖。
 *
 * 归属规则（最容易写错的一条，见计划 §0.3）：
 * - NodeBarService 是**共享单实例**，它的 this.ctx 恒为 bottom-bar 的 scope；
 * - 所以它只做**读**（list/get/applierOf/state）——读不落场，无所谓归谁；
 * - 写（注册动作/写入器/发布工具动作）走**注册方自己的 ctx**（ctx.registryOf），
 *   条目才归注册方插件：卸载自动摘除、同 id 替换。注册糖就是这条规则的封装。
 *
 * 服务取值（见计划 §0.1）：插件 apply 内可直访 ctx.nodeBar；组件与根级测试一律
 * ctx.get('nodeBar') —— 服务解析 Proxy 只存在于插件作用域。
 */
import { Service, type Context } from '@mini-canvas/canvas-base'
import type { PluginScope } from '@mini-canvas/kernel'
import type { DocService } from '@mini-canvas/canvas-data'
import type { BarAction, BarApplier } from './barTypes'
import type { ToolResourceKind } from '@mini-canvas/kernel'
import { runAction, resumeAction, type TaskDeps } from './taskRuntime'
import { readRunState } from './runState'
import BottomBarHost from './BottomBarHost.vue'
import NodeTaskOverlay from './NodeTaskOverlay.vue'
import NodeBottomBar from './NodeBottomBar.vue'

/** 底栏整体换皮的主题槽名（与 settingsPanel 同构：order 最小者赢） */
export const BOTTOM_BAR_SLOT = 'bottomBar'

/** 跨插件共用的两张注册场 */
export const BAR_FIELD = 'node/bar'
export const BAR_APPLIER_FIELD = 'node/bar-applier'

/** 类型 → 内容 kind（publishToolActions 用；与内核 ToolResourceKind 同词表） */
export function kindOf(nodeType: string): ToolResourceKind | undefined {
  const known: ReadonlySet<string> = new Set(['text', 'image', 'video', 'audio'])
  return known.has(nodeType) ? (nodeType as ToolResourceKind) : undefined
}

/**
 * 读服务：列动作 / 查动作 / 查写入器 / 读节点运行状态。
 * 只读 —— 所有写都走注册糖（调用方作用域）。
 */
export class NodeBarService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'nodeBar')
  }

  private field() {
    return this.ctx.registryOf<BarAction>(BAR_FIELD)
  }

  /**
   * 列出适用于某节点类型的动作。场的键就是 action.id（没有类型索引），
   * 所以要扫全键摊平 → 按 types 过滤 → 按 order 跨键升序；动作量级几十条，无性能问题。
   */
  list(filter?: { type?: string }): BarAction[] {
    const field = this.field()
    const all: BarAction[] = []
    for (const key of field.keys()) {
      for (const entry of field.list(key)) all.push(entry.value)
    }
    const picked = filter?.type ? all.filter((a) => !a.types || a.types.includes(filter.type!)) : all
    return picked.sort((a, b) => (a.order ?? Number.POSITIVE_INFINITY) - (b.order ?? Number.POSITIVE_INFINITY))
  }

  /** 查一条动作（键=id），不走 list().find()（那等于每次洗全表） */
  get(id: string): BarAction | undefined {
    return this.field().get(id, id)?.value
  }

  /** 查某类型的写入器（键=kind） */
  applierOf(kind: string): BarApplier | undefined {
    return this.ctx.registryOf<BarApplier>(BAR_APPLIER_FIELD).get(kind, kind)?.value
  }

  /** 读节点当前运行状态（不改写） */
  state(nodeId: string) {
    const doc = this.ctx.get<DocService>('doc')
    return readRunState(doc.getNode(nodeId)?.data)
  }
}

/** 执行服务：run / cancel / restoreAll。runState 写盘走 doc.updateNodeRuntime（不进撤销栈）。 */
export class NodeTaskService extends Service {
  private cancels = new Map<string, AbortController>()

  constructor(ctx: Context) {
    super(ctx, 'nodeTask')
  }

  private doc(): DocService {
    return this.ctx.get('doc')
  }

  /** 组装执行依赖（真实现接 doc 与 nodeBar；测试直接注 TaskDeps 假货） */
  private deps(): TaskDeps {
    const doc = this.doc()
    const bar = this.ctx.get<NodeBarService>('nodeBar')
    return {
      readData: (id) => doc.getNode(id)?.data ?? {},
      // 注意：data 这里就是 { runState } 载荷 —— 必须包进 NodePatch 的 data 键，
      // 否则 nodeStore.updateNode 会把它当非法 patch 键整体忽略（e2e 排查实录）。
      writeRuntime: (id, data) => doc.updateNodeRuntime(id, { data }),
      runApplier: (id, result, c) => void bar.applierOf(c.nodeType)?.(id, result, c),
    }
  }

  private lookup() {
    const bar = this.ctx.get<NodeBarService>('nodeBar')
    return { get: (id: string) => bar.get(id), applierOf: (k: string) => bar.applierOf(k) }
  }

  /** 起一次任务；返回动作的最终结果（UI 不必再读节点） */
  async run(
    nodeId: string,
    actionId: string,
    input: { prompt?: string; values?: Record<string, unknown>; resources?: Parameters<typeof runAction>[0]['input']['resources'] } = {},
  ) {
    const action = this.lookup().get(actionId)
    if (!action) return { ok: false as const, error: '未找到动作 ' + actionId }
    const ctrl = new AbortController()
    this.cancels.set(nodeId, ctrl)
    try {
      return await runAction(
        {
          nodeId,
          nodeType: this.doc().getNode(nodeId)?.type ?? '',
          action,
          input,
          registry: this.lookup(),
          signal: ctrl.signal,
        },
        this.deps(),
      )
    } finally {
      this.cancels.delete(nodeId)
    }
  }

  /** 取消某节点正在跑的任务（覆盖层「取消」按钮） */
  cancel(nodeId: string): void {
    this.cancels.get(nodeId)?.abort()
  }

  /**
   * 刷新续查：把所有 running 状态的节点接回来。
   * 调用时机见 §0.5：ctx:ready（冷启动）与「排除自身的 ctx:plugin-installed」（manifest 热装）。
   */
  async restoreAll(): Promise<void> {
    const doc = this.doc()
    for (const node of doc.getNodes()) {
      const rs = readRunState(node.data)
      if (rs.status !== 'running' || !rs.actionId) continue
      void resumeAction(
        {
          nodeId: node.id,
          nodeType: node.type,
          registry: this.lookup(),
          taskId: rs.taskId ?? '',
          actionId: rs.actionId,
        },
        this.deps(),
      )
    }
  }
}

// ==================== 注册糖（写走调用方作用域，条目归注册方） ====================

/** 注册一个底栏动作：条目归**调用方插件**（卸载自动摘除、同 id 替换） */
export function registerBarAction(ctx: PluginScope, action: BarAction): void {
  ctx.registryOf<BarAction>(BAR_FIELD).add(action.id, action, { id: action.id })
}

/** 注册某节点类型的结果写入器（一个 kind 只允许一个，同 kind 重复抛错） */
export function registerBarApplier(ctx: PluginScope, kind: string, fn: BarApplier): void {
  const field = ctx.registryOf<BarApplier>(BAR_APPLIER_FIELD)
  if (field.has(kind)) throw new Error('[bottom-bar] applier already registered: ' + kind)
  field.add(kind, fn, { id: kind })
}

export const name = 'bottom-bar'
export const inject = ['doc', 'nodeRegistry', 'themeRegistry'] as string[]

/** 应用插件：上架服务 + 挂底栏宿主/覆盖层 + 刷新续查（默认皮登记见 Task 5） */
export function apply(ctx: Context) {
  // 构造即上架（随本插件 scope 回收）
  new NodeBarService(ctx)
  const task = new NodeTaskService(ctx)

  // 底栏宿主挂 out:bottom、覆盖层挂 over:inset（都是 * 通配；组件自己判空与显隐）
  ctx.nodes.attach('*', { region: 'out:bottom', component: BottomBarHost, id: 'bottom-bar/host' })
  ctx.nodes.attach('*', { region: 'over:inset', component: NodeTaskOverlay, id: 'bottom-bar/overlay' })

  // 默认皮登记进 themeRegistry 的 bottomBar 槽（order 最小者赢；换皮插件给更小 order 即顶掉）
  ctx.theme.add(BOTTOM_BAR_SLOT, NodeBottomBar)

  // 刷新续查（§0.5）：冷启动与热装两条时机都挂，只跑一次；
  // ready 之前必须排除自己的安装事件（否则在节点插件注册动作前就把可续查任务误判成中断），
  // ready 之后放行它（manifest 路径 bottom-bar 是热装、ctx:ready 时还没它，靠这条补跑）。
  let restored = false
  let readyFired = false
  const tryRestore = () => {
    if (restored) return
    restored = true
    void task.restoreAll()
  }
  ctx.on('ctx:ready', () => {
    readyFired = true
    tryRestore()
  })
  ctx.on('ctx:plugin-installed', (e) => {
    if (readyFired || e?.name !== 'bottom-bar') tryRestore()
  })
}
