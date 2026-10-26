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
import { publishToolActions, type PublishToolActionsOptions } from './toolActions'
import NodeTaskOverlay from './NodeTaskOverlay.vue'
import NodeBottomBar from './NodeBottomBar.vue'
import NodeBottomBarOverlay from './NodeBottomBarOverlay.vue'
// 参考选择态浮层（顶行「参考」按钮引发）：注册进同一 overlay 槽，与底栏宿主同层。
import ReferenceSelectOverlay from './ReferenceSelectOverlay.vue'
// 全屏媒体预览浮层（素材卡点开看大图/全文）
import MediaPreviewOverlay from './MediaPreviewOverlay.vue'
// Ctrl 拖选择态浮层（按住 Ctrl 时的画布选择态，视觉复刻参考选择）
import CtrlDragOverlay from './CtrlDragOverlay.vue'
import NodeSelectOverlay from './NodeSelectOverlay.vue'

/** 底栏整体换皮的主题槽名（与 settingsPanel 同构：order 最小者赢） */
export const BOTTOM_BAR_SLOT = 'bottomBar'

/** 底栏所在的画布 UI 槽名（宿主 CanvasSurface 的 overlay 槽里按 order 渲染）。
 *  为什么不是节点 out:bottom：节点带 transform 必然成层叠上下文，节点内的 z 压不过
 *  外壳底部工具栏（.shell-dock），输入区会被截走点击 —— 实测复现，见 NodeBottomBarOverlay 文件头。 */
export const BOTTOM_BAR_SLOT_NAME = 'overlay'

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

  // ==================== 写入面（给**别的插件**用；条目归调用方 scope） ====================
  //
  // 为什么方法要收一个 scope 参数：本服务是**共享单实例**，this.ctx 恒为 bottom-bar 的 scope。
  // 若直接用 this.ctx 落场，别人的动作会挂在 bottom-bar 名下 —— 那家插件卸载时摘不掉自己的动作
  // （留一条指向已死插件的 run）。所以把**调用方自己的 ctx** 传进来落场，卸载才会自动回收。
  //
  // 给方法而不是让调用方 import 注册糖：插件之间不互相 import（那是反向依赖），
  // 统一经 `ctx.get('nodeBar')` 拿服务、按服务名协作。
  /** 注册一条底栏动作（归属 = 传入的 scope，卸载自动摘除、同 id 替换） */
  register(scope: PluginScope, action: BarAction): void {
    registerBarAction(scope, action)
  }

  /** 注册某节点类型的结果写入器（一个 kind 只允许一个；归属 = 传入的 scope） */
  registerApplier(scope: PluginScope, kind: string, fn: BarApplier): void {
    registerBarApplier(scope, kind, fn)
  }

  /**
   * 把 `ctx.tools` 里某类工具自动发布成底栏动作（「加一个模型 = 装一个工具插件」的保持点）。
   * 与 register 同样归**传入的 scope**；工具表变化时自动增量同步。
   * @returns 立即重新同步的函数（一般不用管）
   */
  publishTools(scope: PluginScope, opts: PublishToolActionsOptions): () => void {
    return publishToolActions(scope, opts)
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
      // 但节点可能在任务跑着的时候被删掉（用户删了节点）—— writeRuntime 一律不抛：
      // nodeStore.updateNode 对不存在的节点会 throw，那会变成一条未捕获的 promise 异常
      // （实测：轮询中删节点 → 页内 PAGEERROR [nodeStore] no node "x"）。任务本身还在跑，
      // 只是没地方写进度了，静默跳过即可。
      writeRuntime: (id, data) => {
        if (!doc.getNode(id)) return
        doc.updateNodeRuntime(id, { data })
      },
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
      // ★ 必须登记 AbortController：续查出来的任务同样要能被「取消」按钮中断。
      //   不登记的话 `cancel()` 拿不到控制器 → 点了取消什么都没发生（用户实测反馈）。
      const ctrl = new AbortController()
      this.cancels.set(node.id, ctrl)
      void resumeAction(
        {
          nodeId: node.id,
          nodeType: node.type,
          registry: this.lookup(),
          taskId: rs.taskId ?? '',
          actionId: rs.actionId,
          signal: ctrl.signal,
        },
        this.deps(),
      ).finally(() => this.cancels.delete(node.id))
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

  // 覆盖层挂节点 over:inset（* 通配；组件自己判空与显隐）
  ctx.nodes.attach('*', { region: 'over:inset', component: NodeTaskOverlay, id: 'bottom-bar/overlay' })

  // 底栏宿主挂**画布 UI 槽**（不是节点 out:bottom）：节点带 transform 必然成层叠上下文，
  // 底栏住在节点里就压不过外壳底部工具栏（.shell-dock z-index:30），输入区点击被截走（实测复现）。
  // 挂到画布槽后由 NodeBottomBarOverlay 摆到卡片正下方，栏内内容仍是 themeRegistry 的 winner。
  ctx.slots.register(BOTTOM_BAR_SLOT_NAME, {
    id: 'bottom-bar/host',
    order: 40,
    component: NodeBottomBarOverlay,
    meta: { title: '节点底栏' },
  })

  // 默认皮登记进 themeRegistry 的 bottomBar 槽（order 最小者赢；换皮插件给更小 order 即顶掉）
  ctx.theme.add(BOTTOM_BAR_SLOT, NodeBottomBar)

  // 参考选择态浮层：与底栏宿主同槽、不同 order（浮层内容自己判空，不在选择态时不产出 DOM）。
  // 为什么单独一条而不是塞进 NodeBottomBarOverlay：那个组件只管「底栏摆哪」，而这条要铺满
  // 所有节点（每个节点一张盖层）—— 职责不同，分开放各自的显隐条件才写得清楚。
  ctx.slots.register(BOTTOM_BAR_SLOT_NAME, {
    id: 'bottom-bar/reference-select',
    order: 41,
    component: ReferenceSelectOverlay,
    meta: { title: '参考选择态' },
  })

  // 全屏媒体预览：素材卡点开看大图/全文（用户要求「要的是全屏，是整个视图」，不是在底栏里缩着看）
  ctx.slots.register(BOTTOM_BAR_SLOT_NAME, {
    id: 'bottom-bar/media-preview',
    order: 42,
    component: MediaPreviewOverlay,
    meta: { title: '媒体预览' },
  })

  // Ctrl 拖选择态浮层：按住 Ctrl 时的画布选择态（视觉复刻参考选择：紫描边/角标/提醒）。
  ctx.slots.register(BOTTOM_BAR_SLOT_NAME, {
    id: 'bottom-bar/ctrl-drag',
    order: 43,
    component: CtrlDragOverlay,
    meta: { title: 'Ctrl 拖选择态' },
  })

  // 参考选择态的**节点覆盖层**：点击连/断。
  ctx.nodes.attach('*', { region: 'over:inset', component: NodeSelectOverlay, props: { mode: 'reference' }, id: 'bottom-bar/ref-select-node' })
  // Ctrl 拖选择态的**节点覆盖层**：按住拖拽替换（同一套面孔，操作是拖拽）。
  ctx.nodes.attach('*', { region: 'over:inset', component: NodeSelectOverlay, props: { mode: 'ctrl-drag' }, id: 'bottom-bar/ctrl-drag-node' })

  // 刷新续查（§0.5）：冷启动与热装两条时机都挂，只跑一次；
  // ready 之前必须排除自己的安装事件（否则在节点插件注册动作前就把可续查任务误判成中断），
  // ready 之后放行它（manifest 路径 bottom-bar 是热装、ctx:ready 时还没它，靠这条补跑）。
  //
  // ⚠️ 为什么不能只在 ctx:ready 跑一次（2026-09-29 实测复现的 bug）：
  // `ctx:ready` 在**插件装载完成**时就广播了，而画布数据是**之后**才从 storage 恢复进 nodeStore 的
  // （见 createMiniCanvasHost：先 ctx.start() → 恢复画布 → nodeStore.replaceAll）。
  // 于是 ready 那一刻 doc.getNodes() 还是空的 —— 续查扫了个空，界面就永远停在刷新前的进度上。
  // 修法：订阅 doc 变化，等**文档真有 running 节点**了再续查（扫到就收工）。
  // 只在「文档真的有内容了」之后跑一次并锁死：
  // - 冷启动 ctx:ready 那一刻文档还是空的（数据稍后才恢复）→ 不锁，等 doc 变化再来；
  // - 热装时文档已在 → 立刻跑；
  // - 真的空画布 → 每次 doc 变化只多一次 getNodes()，代价可忽略。
  let restored = false
  const tryRestore = () => {
    if (restored) return
    const docServiceForCheck = ctx.get<DocService>('doc')
    if (!docServiceForCheck || docServiceForCheck.getNodes().length === 0) return // 数据还没恢复出来，等下一拍
    restored = true
    void task.restoreAll()
  }
  const docService = ctx.get<{ subscribe(cb: (change: unknown) => void): () => void }>('doc')
  if (docService && typeof docService.subscribe === 'function') {
    const off = docService.subscribe(tryRestore)
    ctx.effect(() => () => off())
  }
  // 兜底再来一次：插件都装完/数据可能已就位时（顺序不定，两处都试，tryRestore 自带幂等）
  ctx.on('ctx:ready', tryRestore)
  ctx.on('ctx:plugin-installed', tryRestore)
}
