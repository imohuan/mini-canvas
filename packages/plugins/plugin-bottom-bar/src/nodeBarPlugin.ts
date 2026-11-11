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
import { Service, type Context } from '@plume-canvas/canvas-base'
import type { PluginScope } from '@plume-canvas/kernel'
import type { DocService } from '@plume-canvas/canvas-data'
import type { BarAction, BarApplier } from './barTypes'
import { registerBarAction, registerBarApplier } from '@plume-canvas/bar-contract'
import type { ToolResourceKind } from '@plume-canvas/kernel'
import { runAction, type TaskDeps } from './taskRuntime'
import { errorState, readRunState } from './runState'
import { publishToolActions, type PublishToolActionsOptions } from './toolActions'
import NodeBottomBar from './NodeBottomBar.vue'
// 参考选择态浮层（顶行「参考」按钮引发）：注册进同一 overlay 槽，与底栏宿主同层。
import ReferenceSelectOverlay from './ReferenceSelectOverlay.vue'
// 全屏媒体预览浮层（素材卡点开看大图/全文）
import MediaPreviewOverlay from './MediaPreviewOverlay.vue'
import NodeSelectOverlay from './NodeSelectOverlay.vue'

/** 底栏整体换皮的主题槽名（与 settingsPanel 同构：order 最小者赢） */
export const BOTTOM_BAR_SLOT = 'bottomBar'

/** 底栏所在的画布 UI 槽名（宿主 CanvasSurface 的 overlay 槽里按 order 渲染）。
 *  本插件**不再**往这里注册底栏宿主：位置由节点壳的 out:bottom 锚点负责（主题挂解析面板）。
 *  保留这个常量是因为参考选择态 / 媒体预览等其它浮层仍挂在同一槽（见 apply 里的注册）。 */
export const BOTTOM_BAR_SLOT_NAME = 'overlay'

/** 跨插件共用的两张注册场 */
export const BAR_FIELD = 'node/bar'

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

  /** 写入器与动作同住 node/bar：键前缀区分，卸载时随同一个场一起消失 */
  private applierField() {
    return this.ctx.registryOf<BarApplier>(BAR_FIELD)
  }

  /**
   * 列出适用于某节点类型的动作。场的键就是 action.id（没有类型索引），
   * 所以要扫全键摊平 → 按 types 过滤 → 按 order 跨键升序；动作量级几十条，无性能问题。
   */
  list(filter?: { type?: string }): BarAction[] {
    const field = this.field()
    const all: BarAction[] = []
    for (const key of field.keys()) {
      if (!key.startsWith('actions/')) continue
      for (const entry of field.list(key)) all.push(entry.value)
    }
    const picked = filter?.type ? all.filter((a) => !a.types || a.types.includes(filter.type!)) : all
    return picked.sort((a, b) => (a.order ?? Number.POSITIVE_INFINITY) - (b.order ?? Number.POSITIVE_INFINITY))
  }

  /** 查一条动作（键=id），不走 list().find()（那等于每次洗全表） */
  get(id: string): BarAction | undefined {
    return this.field().get(`actions/${id}`, id)?.value
  }

  /** 查某类型的写入器（键=kind） */
  applierOf(kind: string): BarApplier | undefined {
    return this.applierField().get(`appliers/${kind}`, kind)?.value
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

/**
 * 执行服务：run / cancel。runState 写盘走 doc.updateNodeRuntime（不进撤销栈）。
 *
 * 用户口径 2026-11-10：**任务只有后台在跑**。这里不保存任何"正在跑"的句柄，
 * 也不自己轮询 —— 前端只剩一条全局定时器（plugin-cloud-client 的 jobsWatcher）
 * 负责对账。所以这个服务变薄了：
 *   · run   = 提交（写 running 帧 + 调动作的 run）；
 *   · cancel = 按节点上的 taskId 请后台取消。
 */
export class NodeTaskService extends Service {
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
    input: { prompts?: Parameters<typeof runAction>[0]['input']['prompts']; values?: Record<string, unknown>; resources?: Parameters<typeof runAction>[0]['input']['resources'] } = {},
  ) {
    const action = this.lookup().get(actionId)
    if (!action) return { ok: false as const, error: '未找到动作 ' + actionId }
    return runAction(
      {
        nodeId,
        nodeType: this.doc().getNode(nodeId)?.type ?? '',
        action,
        input,
        registry: this.lookup(),
      },
      this.deps(),
    )
  }

  /**
   * 取消某节点上的任务 —— **按节点上记着的任务号**取消（用户 2026-11-10）。
   *
   * 任务号只有一个真源 = `node.data.runState.taskId`（后台每一帧都写）。
   * 拿它 + actionId 找到动作，调动作声明的 onCancel 请后台停下 —— 前端不保管句柄，
   * 所以刷新 / 换标签页 / 换浏览器之后取消一样有效。
   *
   * 立刻把节点写成「已取消」：用户点了就要看到反应，不等后台那一帧回来。
   *
   * @returns 是否真的发出了取消（false = 这条任务没有可取消的通道）
   */
  async cancel(nodeId: string): Promise<boolean> {
    const rs = readRunState(this.doc().getNode(nodeId)?.data)
    if (!rs.taskId) return false
    const action = rs.actionId ? this.lookup().get(rs.actionId) : undefined
    if (!action || typeof action.onCancel !== 'function') return false
    const data = this.doc().getNode(nodeId)?.data ?? {}
    const runCtx = {
      nodeId,
      nodeType: this.doc().getNode(nodeId)?.type ?? '',
      signal: new AbortController().signal,
      onProgress: () => {},
      readData: () => data,
    }
    this.deps().writeRuntime(nodeId, { runState: errorState(rs.actionId ?? '', '已取消') })
    try {
      await action.onCancel(rs.taskId, runCtx)
    } catch {
      /* 请后台取消失败不改「本地已取消」这个事实；下一帧状态会把它纠正回来 */
    }
    return true
  }

  /** 旧调用名（节点壳历史上用过）：与 cancel 同一件事 */
  async cancelByNodeTaskId(nodeId: string): Promise<boolean> {
    return this.cancel(nodeId)
  }

  /**
   * 本节点当前那条任务**能不能取消**（覆盖层据此决定画不画取消按钮）。
   *
   * **只看节点数据**（用户 2026-11-10）：提交任务时执行方把 `runState.canCancel`
   * 写进节点，这里原样读出来。不查动作表 —— 刷新后动作清单还没到的那一小会儿，
   * 也不会把一条能取消的任务误判成不能取消。
   *
   * 老数据没有这个字段时，回落到「按 actionId 查动作」的旧判断（不改变旧行为）。
   */
  canCancel(nodeId: string): boolean {
    const rs = readRunState(this.doc().getNode(nodeId)?.data)
    if (rs.status !== 'running') return false
    const flag = (this.doc().getNode(nodeId)?.data as { runState?: { canCancel?: unknown } } | undefined)?.runState
      ?.canCancel
    if (typeof flag === 'boolean') return flag
    if (!rs.actionId) return false
    const action = this.lookup().get(rs.actionId)
    if (!action) return false
    if (typeof action.cancellable === 'boolean') return action.cancellable
    return typeof action.onCancel === 'function'
  }
}

// ==================== 注册糖（写走调用方作用域，条目归注册方） ====================

export { registerBarAction, registerBarApplier }

export const name = 'bottom-bar'
export const inject = ['doc'] as string[]

/**
 * 插件可配置项（设置面板「常规/底栏」组）。
 *
 * **这里不声明后台地址**（用户口径 2026-10-27）：「这边本身就是使用 Agent 之间配置的这个数据」。
 * AI 请求的后台根地址直接取 plugin-agent 的 `agentBaseUrl`（缺省同源），渠道与模型也是
 * Agent 里配好的默认那条。底栏再放一份地址就是第二个真源：改了 Agent、底栏还打旧端口，
 * 那种问题很难看出来是哪一份生效。
 *
 * 分组必须有**至少一个真 schema 字段**才会被登记（否则 settings.groups() 里没有它，
 * 挂在上面的自绘页永远不渲染）。所以这里放「失败重试轮数」这个确实有用的旋钮
 *（用户口径：默认 3 轮），而不是编个占位字段。
 */
export const Config = {
  bottomBarAiRetries: {
    type: 'number' as const,
    default: 3,
    min: 1,
    max: 10,
    step: 1,
    label: 'AI 失败重试',
    group: '常规/底栏',
    description: 'AI 按钮请求失败时最多试几轮（含第一次）。网络抖动 / 5xx 会退避重试；4xx 参数错误不重试。',
  },
}

// 「AI 按钮」自定义配置界面（设置面板「底栏」组的内容插槽）；插件后端地址用 Config 声明。
// Config 的标量项自动登记进 settings 单一数据源（面板左树出现「底栏」分组）；
// 结构化清单（图标/描述/提示词）由 PromptActionSettings 自绘（内容插槽优先于平铺字段）。
import PromptActionSettings from './PromptActionSettings.vue'

/** 应用插件：上架服务 + 挂底栏宿主/覆盖层 + 刷新续查（默认皮登记见 Task 5） */
export function apply(ctx: Context) {
  // 设置面板「底栏」组的内容插槽：AI 按钮清单（增删改 / 模板 / 图标）自绘页。
  // meta.mode = 'append'：这一页**追加**在 schema 字段之后，而不是顶替它们。
  // 缺省是 replace —— 那样「AI 后台地址」这个 Config 字段会被整组盖掉、根本不渲染
  // （设置面板 blocksOf：有 replace 插槽时不铺 fields，2026-10-27 实测）。
  ctx.slots.register('settingsGroup/常规/底栏', {
    id: 'bottom-bar/prompt-actions',
    order: 5,
    component: PromptActionSettings,
    meta: { mode: 'append' },
  })

  // 构造即上架（随本插件 scope 回收）
  new NodeBarService(ctx)
  const task = new NodeTaskService(ctx)

  // 加载 / 失败覆盖层**不再挂在这里**（用户 2026-11-09 拍板方案 A）：
  // 它已经搬进节点壳（plugin-theme-canvas 的 NodeCardShell），所有节点类型自带，
  // 卸载本插件也照样显示。本插件只保留底栏本身与任务执行服务（nodeTask）。

  // 底栏内容注册成 nodeToolbar 的「默认模式」—— 与裁剪/扩展等模式完全平等，
  // 位置由节点壳的 out:bottom 锚点负责，本插件不再自己摆浮层。
  //
  // 为什么要等主题上架：nodeToolbar 是主题插件的服务。装配顺序不定（热装/清单顺序），
  // 所以这里注册不上就等 ctx:plugin-installed 再试一次，成功后解绑。
  const registerDefaultBar = (): boolean => {
    const svc = ctx.tryGet<{
      registerMode?(mode: unknown): (() => void) | void
    } | undefined>('nodeToolbar')
    if (!svc?.registerMode) return false
    const offMode = svc.registerMode({
      id: 'default',
      types: ['text', 'image', 'video', 'audio'],
      title: '默认底栏',
      bottomBar: NodeBottomBar,
      order: 100,
    })
    // 服务归渲染层、活得比本插件久：注册方必须自己交还这一条，
    // 否则每次热重载都会多留一份旧组件引用。返回值可选，兼容没有清理能力的旧服务桩。
    if (offMode) ctx.effect(() => offMode)
    return true
  }
  if (!registerDefaultBar()) {
    const off = ctx.on('ctx:plugin-installed', () => {
      if (registerDefaultBar()) off.dispose()
    })
  }

  // 默认皮仍登记进 themeRegistry 的 bottomBar 槽：
  // 它是「底栏内容」的换皮点（order 最小者赢），与上面的默认模式注册不冲突 ——
  // 上面的注册只是把 winner 的宿主接进统一的状态栏解析链路。
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

  // 节点盖层只挂一份：参考点击与 Ctrl 拖拽共用统一会话，模式由会话自己判定。
  ctx.nodes.attach('*', { region: 'over:inset', component: NodeSelectOverlay, id: 'bottom-bar/select-node' })
}
