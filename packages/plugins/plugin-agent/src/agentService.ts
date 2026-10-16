/**
 * agentService —— 会话状态 + 全部动作（这就是「组件的 API」）。
 *
 * 为什么方法放在服务上而不是组件上：
 * 1. 组件没挂载时也要能调（键盘快捷键 / 底栏按钮要让 Agent「新建对话」，那时面板可能没渲染）；
 * 2. 同一块内容摆两处（左抽屉 + 右悬浮）会变成两份状态 —— 挂在服务上就只有一份。
 *
 * 任何布局都能这样拿它：`useAgent()`（渲染子树内）或 `ctx.get('agent')`（插件里）。
 */
import { computed, reactive, type ComputedRef } from 'vue'
import {
  AgentApi,
  type ChatEvent,
  type SessionMetaView,
  type SendOptions,
  type QueueStateView,
  type GoalStateView,
  type AgentContextView,
  type PromptSectionView,
} from './agentApi.js'
import { ChatModel, type AgentTurnView } from './sessionModel.js'
import { groupConversations, inlinePagers, type ConversationGroup, type PagerGroup } from './branchNav.js'
import { matchSendingQueueItem } from './userSteering.js'

export const CANVAS_ID = 'default'

/** 首屏装载的转录条数（一轮对话占好几条；30 条约等于最后三四轮，用户口径 2026-10-15） */
const TURNS_PAGE = 30

export interface McpRow {
  name: string
  config: Record<string, unknown>
  permission?: string
  invalid?: string
  /** 随 Agent 自带的画布 MCP：界面不给删除按钮（后端也拦删除请求） */
  builtin?: boolean
}

/** 「主动检查 MCP」的结果：每个服务连没连上 + 真正拿到了哪些工具 */
export interface McpProbeResult {
  ok: boolean
  servers: Array<{ name: string; transport: string; status: string; tools: number; error?: string; durationMs: number }>
  tools: Array<{ name: string; server: string; description: string; fullName: string }>
  warnings: string[]
  /** 传输层的错误（网络失败等），与 servers 里的连接失败区分开 */
  error?: string
}

export interface SkillRow {
  name: string
  description: string
  size?: number
  fileCount?: number
  /** 技能目录的绝对路径（后端给；前端拼 SKILL.md 写进引用标记） */
  dir?: string
}

export interface ModelRow {
  provider: string
  modelId: string
  hasKey: boolean
  /** 密钥掩码预览（如 `sk-0…6390`）；明文永不回传。用于编辑渠道时回显「已配置」 */
  apiKeyMask?: string
  baseUrl?: string
  /** 该模型用的客户端协议（编辑渠道时要回填到表单） */
  clientType?: string
  isDefault: boolean
  isVision: boolean
  contextWindow?: number
  displayName?: string
}

export interface ProviderRow {
  provider: string
  label: string
  known: boolean
}

export interface ApprovalRuleRow {
  id: string
  pattern: string
  ask: boolean
  label?: string
}

export interface ApprovalPolicyView {
  enabled: boolean
  rules: ApprovalRuleRow[]
}

export interface AgentServiceState {
  /** 面板可见性（悬浮外壳用；只放内容的布局可以忽略） */
  open: boolean
  /** 是否停靠（外壳用） */
  docked: boolean
  /** 面板宽度（外壳用） */
  width: number

  /** 当前会话 */
  sessionId: string | null
  /**
   * 「此刻的空白是用户**主动**点出来的新对话」（见 newSession / restoreCurrentSession）。
   *
   * 为什么需要它：sessionId=null 有两种意思 ——
   *   ① 用户点了「新建对话」（要一条空白的新会话，下一句话才开始建）；
   *   ② 刷新过页面，内存里的会话 id 丢了（要接着看**最近那条**历史）。
   * 两种都表现为 sessionId=null，但期待的行为**相反**。分不清就会出现用户实测的这个 bug：
   * 「新建对话」后打开面板 / 右键「引用到 Agent」，被 restoreCurrentSession 当成 ②，
   * 又把上一条历史对话装载回来，用户的新对话凭空消失。
   * 只有用户主动打开某条会话（openSession）或发出第一句话（ensureSession 建出会话）才清掉它。
   */
  draft: boolean
  title: string
  running: boolean
  turns: AgentTurnView[]
  /** 会话列表（历史下拉 / 侧边列表） */
  sessions: SessionMetaView[]

  /** 全局配置（设置页与输入区下拉共用） */
  models: ModelRow[]
  providers: ProviderRow[]
  skills: SkillRow[]
  mcpServers: McpRow[]
  catalog: Array<{ provider: string; modelId: string; displayName: string; contextWindow?: number }>

  /** 本轮选中项（随会话走） */
  model: { provider: string; modelId: string } | null
  /** 规则列表（审批用） */
  policy: ApprovalPolicyView

  /** 界面状态 */
  needsModel: boolean
  offline: boolean
  error: string
  contextLeft: number | null
  /**
   * 上下文用量的**绝对值**（最近一次 token_usage 的 used / limit）。
   *
   * 为什么除了百分比还要绝对值：用户点名要在面板最下面显示"上下文统计信息"——
   * 只有百分比看不出还剩多少 tokens。两个值一起给，UI 想显示哪种都有。
   */
  contextUsed: number | null
  contextLimit: number | null
  /**
   * 压缩进行中（begin 收到、end 未到）。
   *
   * 为什么要它：压缩要跑一次模型（几秒到几十秒），中间界面必须有"正在压缩"的常驻提示，
   * 否则用户以为点了没反应（用户点名的问题之一）。
   */
  compacting: boolean
  /**
   * 最近一次压缩的结果提示（成功 / 放弃 / 失败），显示在消息流里。
   *
   * 为什么不用 state.error：错误条是"出事了"的通道；压缩成功也是一条**要说得清**的结果
   * （"已压缩，上下文从 180k 降到 12k"），两者语义不同，各自有自己的位置。
   */
  compactNotice: string
  /**
   * 最近一次失败（留给界面画常驻错误条）。
   *
   * 与 state.error 的分工：error 是"整块内容不可用"（连不上后台 / 没配模型）；
   * lastError 是"这一轮失败了"（上下文超出、密钥无效…）—— 对话区要能一直看见它，
   * 而不是只挂在最后一条助手消息上（挂不上就彻底看不见，用户报的问题 2）。
   */
  lastError: string
  /**
   * 当前会话的模型分段（换过模型的会话才有，见后端 ModelSegment）。
   *
   * 界面在消息流里按 fromUser 画分割线并标注这一段用的模型（用户口径 2026-10-11）。
   */
  segments: Array<{ fromUser: number; provider: string; modelId: string }>

  // ---------------------------------------------------------------- 队列（设计 §3.3）
  /**
   * 待发队列（输入框上方那个列表）。
   *
   * 真相在后台（会话文件里）；这里是它的镜像 —— 刷新后由 GET 会话恢复，
   * 之后靠 SSE 的 `queue` 事件保持同步（多标签页也一致）。
   */
  queue: QueueStateView
  /** 转录分页（用户口径 2026-10-15）：转录总条数 / 头部还有没有更早的 / 正在续拉 */
  turnsTotal: number
  turnsHaveBefore: boolean
  turnsLoadingEarlier: boolean
  /** 已装进界面的转录条数（本页 + 已续拉页；算下一页 turnsBefore 用） */
  turnsLoaded: number
  /**
   * 目标标记（输入框上方那条）：非 null = 这一条要按目标模式发。
   *
   * 只在**发送前**存在（点 + → 目标就置上；发送后清掉）。
   * 运行中的目标状态在 `goal`（从后台读 GOAL.json）。
   */
  goalMark: { objective: string; budget: number } | null
  /** 进行中的目标状态（第 N 轮 · 已用 / 预算）；没有 = null */
  goal: GoalStateView | null
  /** 当前目标的参考图（迷你预览用；随会话记录走，发起 / 编辑目标时写入） */
  goalImages: string[]
  /** 目标被暂停（宿主侧标记；暂停时输入框旁边显示"启动"） */
  goalPaused: boolean
  /** 可导入的技能候选（扫来源目录；技能页用） */
  skillCandidates: Array<{ name: string; description: string; dir: string; installed: boolean }>
  /** 上游可用模型 id（问 GET {baseUrl}/models 拿到的；模型页下拉用） */
  upstreamModels: string[]
  /** SDK 支持的客户端协议清单（从后台读，不在界面里写死） */
  clientTypes: string[]
  /** Agent 的系统提示词（agent_state/AGENTS.md） */
  systemPrompt: string

  /**
   * 提示词模板体检（后端给）。
   *
   * 为什么要在界面上说：模板坏了（{{AGENTS_MD}} 没了）时，用户在设置里写什么提示词都
   * 进不去模型 —— 而模型端不报任何错。不提示的话他永远查不出来，只会觉得「这 AI 不太行」。
   */
  templateHealth: { ok: boolean; missing: string[] }

  /** 模板正文（只读展示用；用户要看到容器长什么样，才知道 {{AGENTS_MD}} 在哪一段） */
  templateText: string

  /** 运行环境上下文（后台地址 + 目录 + 可用占位符）；null = 还没拉到 */
  agentContext: AgentContextView | null

  /** 后台自动附加的系统提示词小节（设置页列出来，让用户看到「多了什么」） */
  promptSections: PromptSectionView[]

  /**
   * 模式提示词清单（全能创作 / 剧本创编 + 用户自建），住后台 KV。
   * 内置两条不可删（只能改名/改正文）；用户自建的可增删改查。
   */
  prompts: PromptPreset[]
  /** 当前选中的模式 id（发送时用它的 text 当系统提示词） */
  activePromptId: string
  /**
  * 当前这条会话**建的时候用的提示词正文**（SDK 把系统提示词钉在会话上，切模式 / 改正文
  * 都要开新会话才生效）。
  *
  * 为什么记正文而不是模式 id：同一模式下把正文改了，id 没变但提示词变了，也该换会话 ——
  * 记正文才能同时覆盖「换模式」和「改当前模式正文」两种情形。'' = 不知道（历史会话）。
  */
  sessionPromptText: string
  /**
   * 上面那个正文**是不是本客户端这次会话期间真实记下来的**。
   *
   * 打开历史会话（含分支）时我们不知道它当时用的提示词 —— 这时必须为 false：
   * 否则「未知 != 当前选择的提示词」会把「在分支里继续说话」误判成「提示词变了」，
   * 静默新建一条会话，用户看到的就是「在分支上继续对话，却给我新开了一个对话」（实测）。
   */
  promptKnown: boolean

  /** 当前画布 id（节点标记要用：`画布id#节点id`）；由宿主经 setCanvasId 喂进来 */
  canvasId: string

  /**
   * 会话标题模型（自动命名用哪个模型）。provider/modelId 都空 = 用会话默认模型。
   * 在「设置 → Agent → 会话标题模型」里配置。
   */
  titleModel: { provider: string; modelId: string }

  /**
   * 待插入的节点引用（两个入口共用：节点右键菜单「引用到 Agent」给一个，多选上控制栏给一批）。
   *
   * 为什么要走服务中转：命令在插件上下文里执行，而输入框在组件里 ——
   * 服务是两者唯一共享的通道。组件看见这个值就把这些节点插成标签，然后调 clearNodeRefs 清掉。
   *
   * 为什么是数组：两个入口都从这一份状态走（右键引用一个 = 数组长度为 1），
   * 不必维护「单个 / 批量」两份并行状态（那种双份迟早漂移）。
   */
  pendingNodeRefs: string[] | null
  /** 待插入的资源标签（资产「添加到 Agent」走这条：服务只记意图，输入框组件消费） */
  /** 待引用的资产（「添加到 Agent」：服务只记数据，输入框组件用 assetResource 现造完整标签） */
  pendingAsset: { id?: string; name: string; url: string; path?: string; folderId?: string; isFolder?: boolean } | null
  /** 待批量插入的资产（多选工具栏「加入资产库」走这条：一次插多张图，组件消费后清空） */
  pendingAssets: Array<{ id?: string; name: string; url: string; path?: string; folderId?: string; isFolder?: boolean }> | null

  /** 正在被编辑的用户消息 id（null = 没有编辑流程）；输入框联动标记跟它走 */
  editingId: string | null

  /** 历史列表：一个对话一行（分支树聚合后的结果；行点击打开 rootId） */
  conversations: ConversationGroup[]
  /** 内联分支分页器（跟随消息）：每个渲染在第 N 个用户消息块之后（见 inlinePagers） */
  pagers: PagerGroup[]

  /** 后端地址（排查用） */
  baseUrl: string
}

/** 一套「模式系统提示词」（与后端 PromptPreset 同形） */
export interface PromptPreset {
  id: string
  name: string
  text: string
  /** 内置项：不可删除 */
  builtin?: boolean
}

export interface AgentService {
  state: AgentServiceState
  turns: ComputedRef<AgentTurnView[]>
  /** 面板开合（外壳用） */
  toggle(): void
  show(): void
  hide(): void
  /** 拉一次全局配置 + 会话列表（打开面板 / 进设置页时调） */
  refresh(): Promise<void>
  /** 接上当前会话的常驻事件流（后台起轮 / 队列自动发都能收到） */
  attachStream(sessionId: string): void
  /** 断开当前会话的事件流订阅（不停后台那一轮） */
  detachStream(): void
  /** 拉一次技能候选（技能页打开时调） */
  loadSkillCandidates(): Promise<void>
  /** 拉上游可用模型清单（模型页的「模型 ID」下拉用） */
  loadUpstreamModels(body?: {
    provider?: string
    modelId?: string
    baseUrl?: string
    apiKey?: string
  }): Promise<{ ok: boolean; models: string[]; error?: string }>
  /** 保存系统提示词 */
  saveSystemPrompt(text: string): Promise<void>
  /** 把提示词模板恢复成出厂模板（模板体检不通过时用；见 state.templateHealth） */
  restoreTemplate(): Promise<void>
  /** 新建一个会话（清空消息区，不是删旧的） */
  newSession(): Promise<void>
  listSessions(): Promise<void>
  openSession(id: string): Promise<void>
  renameSession(id: string, title: string): Promise<void>
  deleteSession(id: string): Promise<void>
  send(text: string, images?: string[]): Promise<void>
  stop(): void
  retry(): Promise<void>
  // ---------------------------------------------------------------- 队列（设计 §3.3）
  /** 跑着的时候再发一条 ⇒ 进队列（空闲时由组件层走 send，不进队） */
  sendToQueue(text: string, images?: string[]): Promise<void>
  /** 引导（插队到正在跑的那一轮的下一次请求）——表面上像直接发送 */
  steerQueueItem(itemId: string): Promise<void>
  /** 删除队列条目 */
  removeQueueItem(itemId: string): Promise<void>
  /** 队列拖拽排序：全量 id 新顺序（sending/sent 由后端钉在原位） */
  reorderQueue(order: string[]): Promise<void>
  /** 往头部续拉更早的转录（对话分页）。返回头部还有没有更早的 */
  loadEarlierTurns(): Promise<boolean>
  /** 关闭排队：从队列移除 + 内容返回给调用方回填输入框 */
  closeQueueItem(itemId: string): Promise<{ text: string; images?: string[] } | null>
  /** 开始编辑某条排队消息（内容交给调用方回填输入框） */
  beginEditQueueItem(itemId: string): Promise<{ text: string; images?: string[] } | null>
  /** 取消编辑（状态回 queued，内容不变） */
  cancelEditQueueItem(itemId: string): Promise<void>
  /** 放弃这条会话里**所有**编辑（切会话前兜底，防 editing 永久阻塞队列） */
  cancelAllEdits(sessionId: string): Promise<void>
  /** 保存编辑（**原位替换**，位置不变） */
  saveEditedQueueItem(itemId: string, text: string, images?: string[]): Promise<void>
  pauseQueue(): Promise<void>
  resumeQueue(): Promise<void>
  // ---------------------------------------------------------------- 目标（设计 §3.4）
  /** 点 + → 目标：置上标记（预算用后台默认值） */
  setGoalMark(objective: string, budget: number): void
  clearGoalMark(): void
  /** 改进行中目标的预算 / 内容（下一轮生效） */
  updateGoal(patch: { objective?: string; budget?: number; deltaBudget?: number; tokensUsed?: number }): Promise<void>
  /** 暂停目标（GOAL.json 收走，官方循环到边界停住） */
  pauseGoal(): Promise<void>
  /** 启动目标（放回 + 踢一脚） */
  resumeGoal(): Promise<void>
  /** 结束目标（真删掉，与暂停不同：不可恢复） */
  endGoal(): Promise<void>
  /** 带目标标记发送（目标模式的第一轮） */
  sendGoal(text: string, images?: string[]): Promise<void>
  /**
   * 写当前目标的**参考图**（迷你预览用；空数组 = 清掉）。
   *
   * 启动目标时 sendGoal 内部已经写过一次；这里单独开门是给**编辑运行中目标**用
   * （组件 submit 里改了图要跟着更新）。此前这个口子没暴露，组件却调了它 ——
   * 运行时抛「agent.setGoalImages is not a function」，图片静默不落盘（真 bug）。
   */
  setGoalImages(images: string[]): Promise<void>
  /**
   * 切换模型。
   *
   * SDK 里模型钉在会话上（改不了），所以这不是"改一个字段"，而是**换一条会话**：
   * 后端把整段历史接过去 + 记一条模型分段，界面据此画分割线（与分支同款）。
   * 这才对得上用户的期待："换了模型之后，接着聊，但从这里开始换了脑子"。
   */
  setModel(provider: string, modelId: string): Promise<void>
  /** 主动压缩上下文（「压缩」命令；@ 菜单与 + 菜单共用） */
  compact(): Promise<void>
  /** 审批：用户点允许 / 拒绝 */
  decide(approvalId: string, decision: 'allow' | 'deny'): Promise<void>
  savePolicy(policy: ApprovalPolicyView): Promise<void>
  /** 设置页用的动作 */
  importSkill(dir: string): Promise<void>
  removeSkill(name: string): Promise<void>
  addMcp(body: Record<string, unknown>): Promise<void>
  removeMcp(name: string): Promise<void>
  /** 主动连一次 MCP 并列出可用工具（「检查连接」按钮） */
  probeMcp(names?: string[]): Promise<McpProbeResult>
  /**
   * 让当前会话**丢掉旧的 MCP 连接**，下一句重新连一次。
   *
   * 场景：外部把 MCP 关了又开，那条会话手里的连接已经废了，SDK 不会自己重连 ——
   * 点「检测」时顺带调它，会话就恢复成「能连上」的状态。
   */
  reconnectMcp(): Promise<boolean>
  saveModel(body: Record<string, unknown>): Promise<void>
  /** 批量写一个渠道的模型 + 删掉取消勾选的（「编辑 Provider」用） */
  saveModelsBulk(body: Record<string, unknown>): Promise<void>
  deleteModel(provider: string, modelId: string): Promise<void>
  setDefaultModel(provider: string, modelId: string): Promise<void>
  /** 拉一次模式提示词清单（打开面板 / 进设置页时调） */
  loadPrompts(): Promise<void>
  /** 整包写回模式提示词清单（增删改都用它；后端会保证内置项不被删） */
  savePrompts(list: PromptPreset[]): Promise<void>
  /** 拉一次「会话标题模型」配置（打开设置页时调） */
  loadTitleModel(): Promise<void>
  /** 写「会话标题模型」配置（provider/modelId 都空 = 回落会话默认模型） */
  saveTitleModel(provider: string, modelId: string): Promise<void>
  /** 选中一个模式（后续发送用它的系统提示词） */
  setActivePrompt(id: string): Promise<void>
  /** 当前模式的提示词正文（给 sendOptions 用；没有就空串） */
  activePromptText(): string
  /** 宿主告诉服务当前画布 id（节点标记要用） */
  setCanvasId(id: string): void
  /**
   * 请求把一批节点引用插进输入框（两个入口共用；组件消费）。
   *
   * 右键菜单「引用到 Agent」传一个 id；多选上控制栏「引用到 Agent」把选中集整批传进来 ——
   * 一条通道两种规模，行为只会一起改。
   */
  requestNodeRefs(nodeIds: string[]): void

  /** 引用一份外部资产到 Agent 输入框（资产面板「添加到 Agent」调用） */
  referenceAsset(asset: { id?: string; name: string; url: string; path?: string; folderId?: string; isFolder?: boolean }): void
  /** 批量引用多份资产到 Agent 输入框（多选工具栏「加入资产库」调用；一次插多张图） */
  referenceAssets(assets: Array<{ id?: string; name: string; url: string; path?: string; folderId?: string; isFolder?: boolean }>): void
  /** 输入框插完资产标签后清掉待办 */
  clearPendingResource(): void
  /** 输入框组件批量插完后清掉 */
  clearPendingResources(): void
  /** 组件插完清掉待办 */
  clearNodeRefs(): void
  /** 进入「正在编辑」：这条消息高亮，输入框出现联动标记（点标记滚回这条消息） */
  beginEdit(turnId: string): void
  /** 取消编辑（徽标、高亮、输入框标记一起消失） */
  cancelEdit(): void
}

/** 造一份服务（agentPlugin 在 apply 里调用一次） */
export function createAgentService(opts: { baseUrl?: string } = {}): AgentService {
  const api = new AgentApi({ baseUrl: opts.baseUrl ?? '' })
  const model = new ChatModel()
  let abort: AbortController | null = null
  let lastText = ''
  /** 上一轮的图片（retry 要连图一起重发，否则"重试"会把图丢了） */
  let lastImages: string[] | undefined

  const state: AgentServiceState = reactive({
    open: false,
    docked: false,
    width: 400,
    sessionId: null,
    draft: false,
    title: '新会话',
    running: false,
    turns: [],
    sessions: [],
    models: [],
    providers: [],
    skills: [],
    mcpServers: [],
    catalog: [],
    model: null,
    policy: { enabled: true, rules: [] },
    needsModel: false,
    offline: false,
    error: '',
    contextLeft: null,
    contextUsed: null,
    contextLimit: null,
    compacting: false,
    compactNotice: '',
    turnsTotal: 0,
    turnsHaveBefore: false,
    turnsLoadingEarlier: false,
    turnsLoaded: 0,
    lastError: '',
    segments: [],
    queue: { paused: false, items: [] },
    goalMark: null,
    goal: null,
    goalImages: [],
    goalPaused: false,
    skillCandidates: [],
    upstreamModels: [],
    clientTypes: ['openai-chat', 'deepseek-v4'],
    systemPrompt: '',
    templateHealth: { ok: true, missing: [] },
    templateText: '',
    agentContext: null,
    promptSections: [],
    prompts: [],
    activePromptId: '',
    sessionPromptText: '',
    promptKnown: false,
    titleModel: { provider: '', modelId: '' },
    canvasId: CANVAS_ID,
    pendingNodeRefs: null,
    pendingAsset: null,
    pendingAssets: null,
    editingId: null,
    conversations: [],
    pagers: [],
    baseUrl: opts.baseUrl ?? '',
  })

  /**
   * 当前画布 id：宿主经 setCanvasId 喂进来的实时值优先，拿不到才回落默认。
   *
   * 为什么统一走它：会话 / 消息必须落在**用户当前看的这张画布**上。
   * 否则「URL 上是画布 B、消息却发到 default」—— 而节点引用标记里写的是 B 的 id，
   * 模型按标记去 default 查节点就查错了（code review 发现的真问题）。
   */
  function canvasId(): string {
    return state.canvasId || CANVAS_ID
  }

  /** 把 ChatModel 的内容同步到响应式 state（turns 是普通数组，靠整体替换触发更新） */
  function sync(): void {
    state.turns = model.turns.map((t) => ({
      ...t,
      tools: t.tools.map((x) => ({ ...x })),
      ...(t.approval ? { approval: { ...t.approval } } : {}),
    }))
  }

  function setError(message: string): void {
    state.error = message
  }

  /**
   * 正在接的那条"会话事件流"的句柄（托管模式的重连）。
   *
   * 与 send 的 abort 分开：send 的 abort 是"我主动停这一轮"，
   * 这个只是"我这条订阅不要了"（后台照跑）。
   */
  let streamAbort: AbortController | null = null
  /**
   * 接流的水位：转录里已经有的最后一条事件序号。
   *
   * 从 sessionState() 的 seq 来（后端算的"已落转录"水位）；从 0 接会把
   * 转录里已有的内容在界面上重复显示一遍。
   */
  let streamSince = 0
  /**
   * 帧级水位：**任何**帧到过这里（send 响应或常驻流），都把它推进到最大 seq。
   *
   * 为什么必须记它（真机实测的洞）：send 响应与常驻流订阅的是**同一个** hub 通道，
   * 同一条事件会到两次；且常驻流断开重连时若只拿 `streamSince`（转录水位，很久不更新），
   * 已应用过的事件会被整体重放 ⇒ 助手正文 / 工具卡片重复一次。
   * 有了它，两条通道互为去重：谁先到谁应用，后到的同 seq 直接丢。
   */
  let lastAppliedSeq = 0
  /** 该不该应用这条 seq（重复投递 / 重连回放 → false） */
  function acceptSeq(seq: number): boolean {
    if (seq <= lastAppliedSeq) return false
    lastAppliedSeq = seq
    return true
  }
  /** 常驻流的重连计数（成功连上后归零；见 attachStream 的退避） */
  let streamRetry = 0
  /** 重连的定时器（换会话 / 卸载时要清掉） */
  let streamRetryTimer: ReturnType<typeof setTimeout> | null = null
  /** 当前这条流属于哪个会话（换会话要重接；见 attachStream） */
  let streamSessionId: string | null = null

  function applyEvent(ev: ChatEvent): void {
    // 队列 / 运行态 / 目标这几类事件不进 ChatModel（它不是对话内容）——
    // 它们是"会话的运行状态"，直接更新 state（界面据此刷新输入区上方区域）。
    if (ev.type === 'queue') {
      state.queue = ev.queue
      return
    }
    if (ev.type === 'run_state') {
      state.running = ev.running
      // 后台开跑了（可能是队列自动发的，界面完全没参与）⇒ 主动接上它的流，
      // 否则用户只能看到"什么都没发生"（用户实测的问题 4）。
      if (ev.running && state.sessionId && !streamAbort) attachStream(state.sessionId)
      // 注意：**这里不要调 openSession()**。
      //
      // 为什么（真机实测踩到的坑）：openSession 会用 HTTP 拿回来的快照**整体覆盖**
      // state.queue —— 而 HTTP 与 SSE 是两条通道，同一时刻拿到的可能比 SSE 已经
      // 推到的事件更旧。结果就是"后台队列已经空了，界面还挂着一行发送中"。
      // 队列的真相由 SSE 的 queue 事件单线推过来（后端每次变更都广播），
      // 这里只负责 running 这个开关。
      // 转录内容也不需要这里补：assistant/user 的回合本来就是 yield 进来的。
      return
    }
    if (ev.type === 'goal_state') {
      state.goal = (ev.goal ?? null) as GoalStateView | null
      return
    }
    if (ev.type === 'user_message') {
      // 后端告诉我们"这一轮喂给模型的是这句"：补一个用户气泡 + 助手占位。
      // 队列自动发的那条前端没参与，没有这一步界面上就只有 AI 的回答（用户实测）。
      // 顺带做「队列真发出去了」的联动：出现这条 = sending 条目已投递 ⇒ 从队列删除。
      model.acceptUserMessage(ev.text, ev.images, ev.steered)
      retireSendingItemOnUserMessage(ev.text, ev.images)
      sync()
      return
    }
    if (ev.type === 'queue_idle') {
      // 队列跑完：界面可以据此做"队列已完成"的提示（通知由组件层做）
      return
    }
    if (ev.type === 'round_done') {
      return
    }
    /**
     * 压缩进度：begin / end 成对，界面据此显示"正在压缩"与结果。
     *
     * 不进 ChatModel（它不是对话内容）：它是会话的运行状态。
     */
    if (ev.type === 'compact') {
      if (ev.phase === 'begin') {
        state.compacting = true
        state.compactNotice = ''
      } else {
        state.compacting = false
        if (ev.status === 'completed') {
          state.compactNotice = ev.reason === 'manual' ? '已压缩：历史已总结成摘要' : '上下文已自动压缩'
          // 压完上下文变小了 —— 下一轮 usage 才有新数，这里先把百分比清掉重算前的误导
          // （保留绝对值：用户至少知道压之前用过多少）
        } else {
          state.compactNotice = '压缩没成功（' + (ev.error || ev.status || '未知原因') + '），原上下文保留'
        }
      }
      return
    }
    /**
     * 压缩期间流出来的正文**不是回复**（真机实测踩到的坑）。
     *
     * SDK 的注释写得明白：compaction_begin 与 compaction_end 之间，流上只有
     * token_usage 和"摘要正在写"的 partial_text —— 那段摘要会被原样当成助手正文，
     * 在对话里冒出一大段没人要的文字（而且压缩不落转录，刷新后又消失，前后更明显）。
     * 所以压缩进行中一律丢掉 text / thinking；end 一到（compacting=false）恢复正常。
     */
    if (state.compacting && (ev.type === 'text' || ev.type === 'thinking')) return
    model.apply(ev)
    /**
     * 出错的**副本**留在 state 上：界面据此画一条常驻错误条。
     *
     * 为什么不能只靠 turn.error（用户报的问题 2）：那条错误只挂在"最后一条助手消息"上 ——
     * 如果出错时还没建出助手消息（比如请求在 bootstrap 阶段就失败、或错误发生在轮与轮之间），
     * 它就落在空气里，用户什么也看不到。
     */
    /**
     * 错误按**来源**分流（code review 抓到压缩失败看不见）：
     *   · scope 'compact' = 压缩失败 —— 放进压缩提示里。压缩不产生助手消息，
     *     挂到 ChatModel 等于落在空气里（用户看不到任何提示）；
     *   · 其它 = 某一轮失败 —— 常驻错误条 + 消息上的红字（原行为）。
     */
    if (ev.type === 'error') {
      if (ev.scope === 'compact') {
        state.compacting = false
        state.compactNotice = ev.message
        return
      }
      state.lastError = ev.message
    }
    if (ev.type === 'usage') {
      const left =
        ev.limitTokens && ev.limitTokens > 0
          ? Math.max(0, Math.min(100, Math.round((1 - ev.usedTokens / ev.limitTokens) * 100)))
          : null
      state.contextLeft = left
      // 绝对值一起存：面板最下面那行"上下文统计"要显示真实 token 数，不只百分比。
      state.contextUsed = Number.isFinite(ev.usedTokens) ? Math.max(0, Math.round(ev.usedTokens)) : null
      state.contextLimit = ev.limitTokens && ev.limitTokens > 0 ? Math.round(ev.limitTokens) : null
      /**
       * 目标的「已用」**跟着每次请求实时涨**（用户口径 2026-10-11）。
       *
       * 为什么不能只等 goal_state：那个数字由插件在**每轮结束**写进 GOAL.json，
       * 一轮里发了好几次请求它也纹丝不动（真机实测的滞后）。
       * 所以每次请求完成，把**这次的花费**加到当前显示值上；轮末 goal_state 一到，
       * 就用插件记的权威值覆盖（那时我们加的增量已经被它算进去了，不会重复）。
       * 代价：轮中间若因改预算等原因推来一次 goal_state，会短暂抹掉这段增量 —— 可接受，
       * 轮末自动对齐（插件那份才是账本）。
       */
      if (state.goal && ev.spent && ev.spent > 0) {
        state.goal = { ...state.goal, tokensUsed: state.goal.tokensUsed + ev.spent }
      }
    }
    sync()
  }

  /**
   * 接回这一轮正在跑的流（刷新 / 重开面板后的关键一步）。
   *
   * 为什么必须接：托管模式下后台自己跑，页面只是订阅者 —— 不接回来，
   * 界面就看不到后台正在产出什么（用户实测："任务结束但队列没反应"）。
   *
   * 幂等：已经有连接时不重复接（多个入口都会调）。
   * 结束条件：服务端在这一轮结束时关流；那时把 running 归位并刷新会话列表。
   */
  function attachStream(sessionId: string): void {
    // 已经接着**同一条会话**的流就不重复接；换了会话要重接（旧流在 openSession 里已断）
    if (streamAbort && streamSessionId === sessionId) return
    const ac = new AbortController()
    streamAbort = ac
    streamSessionId = sessionId
    // 起点取**较新**的那个：转录水位与帧级水位谁大用谁。
    // 帧级水位才是"这一屏真正应用过到哪里"；只用转录水位会重放已应用的事件。
    const since = Math.max(streamSince, lastAppliedSeq)
    void api
      // follow=常驻：会话页开着就一直连着，后台**空闲时自动起轮**（队列发下一条）
      // 的事件也能收到 —— 不连就永远不知道后台在动。
      .streamSession(canvasId(), sessionId, since, applyEvent, ac.signal, {
        follow: true,
        acceptSeq,
        onSeq: (n) => {
          if (n > lastAppliedSeq) lastAppliedSeq = n
        },
      })
      .catch((err) => {
        // 主动断开不算错误（组件卸载 / 换会话）
        if (!ac.signal.aborted) {
          logStreamError(err)
        }
      })
      .finally(() => {
        if (streamAbort !== ac) return
        streamAbort = null
        // 常驻流断了（网络抖动 / 服务重启）⇒ 自动重连：
        // 不重连的话，用户必须手动刷新才能再看到后台在干什么。
        // 退避 1s → 2s → 4s → … 最多 15s；换会话 / 卸载时（streamAbort 被清）不再重连。
        const attempt = ++streamRetry
        if (attempt > 8) return // 连了 8 次还不行：放弃（用户刷新页面会重来）
        const delay = Math.min(15000, 1000 * 2 ** Math.min(attempt - 1, 4))
        streamRetryTimer = setTimeout(() => {
          if (state.sessionId === sessionId) attachStream(sessionId)
        }, delay)
      })
  }

  /** 断开当前的流订阅（换会话 / 卸载时调；不停后台那一轮） */
  function detachStream(): void {
    if (streamRetryTimer) {
      clearTimeout(streamRetryTimer)
      streamRetryTimer = null
    }
    streamAbort?.abort()
    streamAbort = null
    streamSessionId = null
  }

  function logStreamError(err: unknown): void {
    // 流断了不是"对话失败"：后台还在跑，界面下一轮刷新会拿回结果。
    // 用 error 提示但不清空内容（与 SSE 断线的既有口径一致）。
    setError('连接中断（后台仍在继续，可刷新查看）：' + (err instanceof Error ? err.message : String(err)))
  }

  async function refresh(): Promise<void> {
    try {
      const cfg = await api.config()
      state.models = (Array.isArray(cfg.models) ? cfg.models : []) as ModelRow[]
      state.providers = (Array.isArray(cfg.providers) ? cfg.providers : []) as ProviderRow[]
      state.skills = (Array.isArray(cfg.skills) ? cfg.skills : []) as SkillRow[]
      state.mcpServers = (Array.isArray(cfg.mcpServers) ? cfg.mcpServers : []) as McpRow[]
      state.catalog = (Array.isArray(cfg.catalog) ? cfg.catalog : []) as AgentServiceState['catalog']
      if (Array.isArray(cfg.clientTypes)) state.clientTypes = cfg.clientTypes.map(String)
      if (typeof cfg.systemPrompt === 'string') state.systemPrompt = cfg.systemPrompt
      // 提示词模板体检 + 运行环境上下文（后台地址 / 目录 / 可用占位符）
      // 都在同一条配置响应里，一起落进 state —— 设置页据此提示与列清单。
      const tpl = cfg.template as { ok?: boolean; missing?: unknown; template?: unknown } | undefined
      if (tpl) {
        state.templateHealth = {
          ok: tpl.ok === true,
          missing: Array.isArray(tpl.missing) ? tpl.missing.map(String) : [],
        }
        state.templateText = typeof tpl.template === 'string' ? tpl.template : ''
      }
      const ctxView = cfg.context as AgentContextView | undefined
      if (ctxView && Array.isArray(ctxView.placeholders)) state.agentContext = ctxView
      // 后台自动附加了哪些内容（运行环境 / 引用标记说明…）——设置页列给用户看
      state.promptSections = Array.isArray(cfg.promptSections)
        ? (cfg.promptSections as PromptSectionView[])
        : []
      // 模式提示词清单也随这次 refresh 一起拉（列表不长，不必单独一趟）
      await loadPrompts()
      // 只有「带密钥的模型」才算配好：SDK 预置了一份目录（几十个模型、全无密钥），
      // 拿 models.length 判断会让界面在真没配的时候也以为配好了。
      const usable = state.models.filter((m) => m.hasKey)
      state.needsModel = usable.length === 0
      const def = usable.find((m) => m.isDefault) ?? usable[0]
      if (!state.model && def) state.model = { provider: def.provider, modelId: def.modelId }
      state.offline = false
    } catch (err) {
      state.offline = true
      setError(err instanceof Error ? err.message : String(err))
    }
    try {
      const p = await api.getPolicy()
      const policy = p.policy as ApprovalPolicyView | undefined
      if (policy) state.policy = policy
    } catch {
      /* 规则列表拉不到不影响对话 */
    }
    await listSessions()
    // 会话列表拉完就**装载当前会话**（含队列 / 目标 / 运行态）。
    //
    // 为什么必须在这里做（用户实测的真 bug）：刷新页面后 state.sessionId 丢了，
    // 而 refresh() 原来只拉配置 + 会话列表 —— state.queue 一直是空的，
    // 输入框上方的队列列表**永远不显示**；后台正在跑的那一轮也感知不到。
    // 面板每次打开都走 refresh()，所以在这一处接上就全都对了。
    await restoreCurrentSession()
  }

  /**
   * 恢复"当前会话"（刷新 / 打开面板时）。
   *
   * 两种情形：
   * - 内存里已经有 sessionId（同一个 SPA 会话内再次打开面板）⇒ 重新拉一次详情，
   *   把队列 / 目标 / 运行态对齐后台 —— 后台可能刚自动发了队列里的消息，界面要跟上；
   * - 内存里没有（刷新过页面）⇒ 取会话列表里最新的那一条装载它。
   *   为什么不新建：用户刷新是在"继续看这个对话"，新建一条会把他的上下文断掉。
   *
   * 没有任何会话时什么也不做（真的新用户，等第一条消息自然建）。
   */
  async function restoreCurrentSession(): Promise<void> {
    try {
      // 主动点出来的「新对话」是**有意**的空白：这里必须原样留着。
      // 否则 show() / refresh()（面板每次打开都走）会把它当成「刷新后丢了会话 id」，
      // 又把最近一条历史装载回来（用户实测：右键「引用到 Agent」后跳回老对话）。
      if (state.draft) return
      let id = state.sessionId
      if (!id) {
        const latest = state.sessions[0]
        if (!latest) return
        id = latest.id
      }
      await openSession(id)
      // 常驻订阅这条会话的事件流：后台什么时候起轮（含队列自动发）都能收到。
      // 不订阅 = 界面只能靠"用户手动刷新"才知道后台在干什么（用户实测的问题 4）。
      attachStream(id)
    } catch (err) {
      // 装载失败不该让"打开面板"整个失败：清掉可能的脏 id，下次发送会自然新建
      state.sessionId = null
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function listSessions(): Promise<void> {
    try {
      const r = await api.listSessionsWithParents(canvasId())
      state.sessions = r.sessions
      // 历史列表按分支树聚合：一个对话一行（分支再多也只占一行）
      state.conversations = groupConversations(
        r.sessions.map((s) => ({ id: s.id, title: s.title, updatedAt: s.updatedAt, createdAt: s.createdAt, ...(s.preview ? { preview: s.preview } : {}) })),
        r.parents,
      )
      // 会话列表变了 = 分叉点也可能变了：当前会话的分页器顺手刷新
      await refreshPagers()
      state.offline = false
    } catch (err) {
      state.offline = true
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  /** 拉当前会话的分页器数据（< N / M >）；没有当前会话就清空 */
  /**
   * 拉当前会话的内联分页器（跟随消息）：位置按**当前转录**的用户消息下标算，
   * 所以每次打开会话 / 收完一轮 / 会话列表变化都要重算。
   */
  async function refreshPagers(): Promise<void> {
    const id = state.sessionId
    if (!id) {
      state.pagers = []
      return
    }
    try {
      const info = await api.branchInfo(canvasId(), id)
      if (state.sessionId !== id) return
      state.pagers = inlinePagers(
        id,
        state.sessions.map((s) => ({ id: s.id, title: s.title, updatedAt: s.updatedAt, createdAt: s.createdAt, ...(s.preview ? { preview: s.preview } : {}) })),
        info.points ?? [],
      )
    } catch {
      if (state.sessionId === id) state.pagers = []
    }
  }

  async function newSession(): Promise<void> {
    // 新建不等于删除：旧会话留在历史里。当前这一屏清空，下一句话才开始真的建。
    model.reset()
    sync()
    // 会话级状态必须一起清干净（用户口径 2026-10-09 的真机 bug）：
    // 「目标」属于**那一条会话**，不是全局的。原来只清了 sessionId/title，
    // 于是新建对话后上一个会话的目标条还挂在输入区（界面显示「目标第 N 轮 · …」）。
    // 队列 / 运行态 / 目标标记同理：它们都是「当前会话」的属性，切到新会话就该归零。
    // 还要**断开旧会话的常驻流** —— 不然那条流会把旧会话的 goal_state 继续推回来，
    // 清了也会立刻被重新写上。
    detachStream()
    state.goal = null
    state.goalPaused = false
    state.goalMark = null
    state.queue = { paused: false, items: [] }
    state.running = false
    state.sessionId = null
    // 标记「这是用户主动要的空白新对话」—— 见 state.draft 的说明。
    state.draft = true
    state.sessionPromptText = ''
    state.promptKnown = false
    state.title = '新会话'
    state.segments = []
    state.error = ''
    state.contextLeft = null
    state.contextUsed = null
    state.contextLimit = null
    state.compacting = false
    state.compactNotice = ''
    state.lastError = ''
    state.pagers = []
    // 转录分页状态一起清（新会话从零开始）
    state.turnsTotal = 0
    state.turnsHaveBefore = false
    state.turnsLoaded = 0
    await listSessions()
  }

  async function openSession(id: string): Promise<void> {
    try {
      // 切会话前把**上一条**会话遗留的编辑态清掉（见 cancelAllEdits 的说明）：
      // 不到这里清，服务端那条 editing 会永久阻塞它的队列。
      const leaving = state.sessionId
      if (leaving && leaving !== id) await cancelAllEdits(leaving)
      // 用 sessionState（不是 getSession）：一次拿全转录 + 队列 + 目标 + 运行态 ——
      // 刷新后整个输入区（队列列表、暂停标记、目标状态）都靠这一条恢复（设计 §3.2/§3.3）。
      // 转录分页（用户口径 2026-10-15）：首屏只装最后 ~30 条 turn（约三四轮），
      // 更早的历史由顶部哨兵进可视区时经 loadEarlierTurns 续拉。
      const full = await api.sessionState(canvasId(), id, { turnsLimit: TURNS_PAGE })
      const rec = full.session
      model.load(Array.isArray(rec.turns) ? rec.turns : [])
      state.turnsTotal = full.turnsTotal ?? rec.turns.length
      state.turnsHaveBefore = full.turnsHaveBefore === true
      // 本页装进界面的转录条数（续拉时算 turnsBefore 用 —— UI 视图条数与转录条数
      // 不是一回事，一轮 user 会展开成 tool/thinking 好几条，绝不能拿 model.turns 数）
      state.turnsLoaded = Array.isArray(rec.turns) ? rec.turns.length : 0
      // 模型分段随转录一起装载：界面按它画"从这里换了模型"的分割线
      state.segments = Array.isArray(rec.modelSegments) ? rec.modelSegments : []
      sync()
      state.sessionId = id
      // 用户**主动**打开了这条会话：空白新对话的意图到此结束（见 state.draft）
      state.draft = false
      // 挂起中的审批补渲染成卡片（刷新 / 切会话的洞）：
      // 审批只在「发生的那一刻」经 SSE 推一次，刷新后事件早没了，界面就把它丢了；
      // 而后台仍停在原地等这张卡片 —— 不补回来，这一轮永远结束不了
      // （用户实测：输入框右下角按钮永远停在「停止」，点了也没用）。
      // 放在 model.load() 之后：卡片要追加在已恢复的转录末尾。
      if (Array.isArray(full.approvals) && full.approvals.length) {
        model.restoreApprovals(full.approvals)
        sync()
      }
      // 队列 / 目标 / 运行态：刷新后原样恢复
      state.queue = full.queue ?? { paused: false, items: [] }
      state.goal = (full.goal ?? null) as GoalStateView | null
      state.goalImages = Array.isArray(full.goalImages) ? (full.goalImages as string[]) : []
      state.goalPaused = full.goalPaused === true
      /**
       * 上下文用量从磁盘恢复（用户报的问题 1 的根因修复）。
       *
       * 为什么必须在这里补：token_usage 事件既不落转录、重连也不重放 ——
       * 刷新 / 切会话后面板上那个指示器就永远是空的，直到用户再发一条消息。
       * 后端把最近一次用量随会话记录存下来了，这里一次性画回来。
       */
      const u = full.lastUsage
      if (u && Number.isFinite(u.usedTokens)) {
        state.contextUsed = Math.max(0, Math.round(u.usedTokens))
        state.contextLimit = u.limitTokens && u.limitTokens > 0 ? Math.round(u.limitTokens) : null
        state.contextLeft = state.contextLimit
          ? Math.max(0, Math.min(100, Math.round((1 - state.contextUsed / state.contextLimit) * 100)))
          : null
      } else {
        // 老会话（没有这份记录）：如实清空，不要拿上一条会话的数字充数
        state.contextUsed = null
        state.contextLimit = null
        state.contextLeft = null
      }
      // running 以后台为准（托管模式下它才是唯一真相）
      state.running = full.running === true
      // 接流的水位：转录里已有的不算，只接"还没落转录的那部分"。
      // 帧级水位**必须一起重置**：seq 是每会话独立的（新会话从 1 开始），
      // 沿用上一条会话的水位会把新会话的事件全部误判成"已应用"而丢掉。
      streamSince = typeof full.seq === 'number' ? full.seq : 0
      lastAppliedSeq = streamSince
      // 上一轮的订阅随会话切换作废（新会话的流由 attachStream 接管）
      detachStream()
      // 重新连（新会话 / 刚装载完）：重连计数归零
      streamRetry = 0
      // 历史会话的提示词正文无从得知：标记为「未知」。未知**不触发**换会话 ——
      // 在分支 / 历史会话里继续说话必须留在原地（实测：未知被当成「不一样」后，
      // 发一句话就静默新建了一条会话，用户看到「在分支上继续却新开了一个对话」）。
      state.sessionPromptText = ''
      state.promptKnown = false
      state.title = rec.title || '新会话'
      state.error = ''
      // 错误条与压缩提示是**这一条会话**的状态：切过去时要重来（否则上一条会话的
      // 报错会挂在另一条对话下面，用户以为刚切的这条出问题了）。
      state.lastError = ''
      state.compactNotice = ''
      state.compacting = false
      /**
       * 上下文的绝对值**不重置**：它属于"模型窗口还剩多少"，切会话后由后端下一次
       * token_usage 补上；这里若清成 null，用户切回来看不到任何指示器，
       * 又变成他报的"进度莫名其妙消失"。百分比同理保留。
       */
      if (rec.provider && rec.modelId) state.model = { provider: rec.provider, modelId: rec.modelId }
      // 内联分页器随会话一起拉（跟随消息：每个在对应消息块后渲染）
      await refreshPagers()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function renameSession(id: string, title: string): Promise<void> {
    try {
      await api.renameSession(canvasId(), id, title)
      if (state.sessionId === id) state.title = title
      await listSessions()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function deleteSession(id: string): Promise<void> {
    try {
      await api.deleteSession(canvasId(), id)
      if (state.sessionId === id) await newSession()
      else await listSessions()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function ensureSession(): Promise<string | null> {
    if (state.sessionId) return state.sessionId
    if (state.needsModel) {
      setError('还没有配置模型：请到 设置 → Agent → 模型 里加一个带密钥的模型')
      return null
    }
    try {
      const opts: SendOptions = {}
      if (state.model) {
        opts.provider = state.model.provider
        opts.modelId = state.model.modelId
      }
      // 模式提示词在**建会话时**定死（SDK 把系统提示词钉在会话上）：
      // 这是它真正生效的那一次；后续轮次沿用同一条会话的提示词。
      const prompt = activePromptText()
      if (prompt) opts.systemPrompt = prompt
      const created = await api.createSession(canvasId(), { ...opts })
      state.sessionId = created.id
      // 第一句话已经把这条件谈成了真会话：空白态结束（见 state.draft）
      state.draft = false
      // 记下建这条会话时用的提示词正文（见 sessionPromptText 的说明）：
      // 之后发送前比对，正文变了就换会话，保证「改了提示词下一句就生效」。
      state.sessionPromptText = prompt
      state.promptKnown = true
      await listSessions()
      return created.id
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return null
    }
  }

  function sendOptions(): SendOptions {
    const opts: SendOptions = {}
    if (state.model) {
      opts.provider = state.model.provider
      opts.modelId = state.model.modelId
    }
    // 技能 / MCP **不再作为特殊属性发送**：它们已经是正文里的引用标记，后端自己解析。
    // 跨机器一致、删标签即失效，也不会出现「属性说有、正文里没有」的第二处真相。
    // 模式提示词（若选了）随这一轮发给后端。
    const prompt = activePromptText()
    if (prompt) opts.systemPrompt = prompt
    return opts
  }

  async function send(text: string, images?: string[]): Promise<void> {
    const value = text.trim()
    const pics = (images ?? []).filter((u) => !!u)
    // 只有图、没有字也算一条合法消息（用户常直接丢图问"这是什么"）
    if ((!value && !pics.length) || state.running) return
    setError('')
    // 新的一轮开始：把上一条错误条收掉（它属于上一次失败，用户已经看到了）
    state.lastError = ''
    // 发送前再校一次提示词新鲜度：用户可能刚在设置里改了模式正文、没动过模式下拉，
    // 这条会话就得换成新提示词的那条（见 ensurePromptFresh）。
    // **编辑重发必须跳过它**：新鲜度检查会 newSession() 清掉 turns/sessionId，
    // fork 就找不到被编辑的消息了（实测：fork 被跳过、消息发进无历史的新会话）。
    // 分支出的会话继承父 trace 的系统提示词，本来就不受这次选择影响。
    if (!state.editingId) await ensurePromptFresh()
    let id = await ensureSession()
    if (!id) return
    /**
     * 分支发送（用户口径 2026-10-06）：正在编辑某条旧消息时，重发不走原会话 ——
     * 先 fork：后端把那条消息**之前**的回合拷进新会话，新 id 从这里继续；
     * 原会话（含那条消息及其回复）原样保留，成为另一个分支。
     * fork 失败则按普通发送继续（不阻塞用户）。fork 后清编辑态。
     */
    if (state.editingId) {
      const editingTurn = state.turns.find((t) => t.id === state.editingId)
      if (editingTurn?.text) {
        try {
          const fork = await api.forkSession(canvasId(), id, editingTurn.text)
          // 直接按 openSession 装载新会话：转录（只剩被编辑消息**之前**的历史）、
          // id、后端标题（唯一真相）、兄弟分支信息一次到位 —— 视图与转录不再脱节
          // （否则界面还挂着父会话的完整消息流，刷新后突然变短）。
          await openSession(fork.sessionId)
          id = fork.sessionId
        } catch (err) {
          setError('分支创建失败，按原会话继续：' + (err instanceof Error ? err.message : String(err)))
        }
      }
      cancelEdit()
    }
    if (!id) return
    lastText = value
    lastImages = pics.length ? pics : undefined
    // 界面与转录、发给模型的内容现在是**同一份**（用户口径 2026-10-08：标记改用 <ref …> XML，
    // 自带本机绝对路径，复制到本机 Agent 直接可用；后端不再翻译）。SDK 会把标记当普通文本
    // 交给模型 —— 标记的含义由系统提示词（REFERENCE_MARKUP_GUIDE）一次性说明。
    model.send(value, pics.length ? pics : undefined)
    sync()
    state.running = true
    const ac = new AbortController()
    abort = ac
    try {
      /**
       * 这条 send 响应与常驻流订阅的是**同一个** hub 通道 ⇒ 同一条事件会到两次。
       * 只给常驻流去重是不够的（真机实测：正文变成「收到收到」、工具卡片重复）——
       * 这里也带上同一套帧级水位，两条通道互为去重。
       */
      await api.sendMessage(
        canvasId(),
        id,
        value,
        { ...sendOptions(), ...(pics.length ? { images: pics } : {}) },
        applyEvent,
        ac.signal,
        {
          acceptSeq,
          onSeq: (n) => {
            if (n > lastAppliedSeq) lastAppliedSeq = n
          },
        },
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // 主动中止不算错误（用户按了停止）
      if (ac.signal.aborted) applyEvent({ type: 'done' })
      else {
        setError(message)
        applyEvent({ type: 'error', message })
      }
    } finally {
      state.running = false
      abort = null
      applyEvent({ type: 'done' })
      // 本轮跑完后，如果队列里还有排着的条目，调度器会自动起下一轮 —— 那一轮的
      // 事件走 hub 常驻通道，而 send 响应流已经断了。这里主动接上常驻流
      // （真机自动化 2026-10-16 抓到：新会话发一条长任务 + 排队消息，队列在后台
      // 逐条发出，界面却一直显示 queued —— 因为没有任何订阅者收 queue/user_message）。
      if (state.queue.items.some((it) => it.state === 'queued' || it.state === 'sending')) {
        attachStream(state.sessionId!)
      }
      await listSessions()
    }
  }

  function stop(): void {
    abort?.abort()
    if (state.sessionId) void api.abort(canvasId(), state.sessionId)
    state.running = false
  }

  // ==================================================================
  // 队列（设计 §3.3）：真相在后台（会话文件），这里是它的镜像。
  // 所有操作都走后端 op，成功后会随 SSE 的 queue 事件回流（多标签页一致）。
  // ==================================================================

  /** 会话 id（队列/目标操作没有会话时直接放弃 —— 界面在空会话时不该调到这） */
  function currentSessionId(): string | null {
    return state.sessionId
  }

  /** 把返回值里的 queue 贴进 state（操作成功立刻反映，不必等 SSE 回来） */
  function adoptQueue(queue: QueueStateView | undefined): void {
    if (queue) state.queue = queue
  }

  /**
   * 监听「队列真的发出去了」（用户口径 2026-10-15）：后台队列自动发的那条，
   * 到达模型时被 SDK 包成 [user_steering] 块 —— user_message 事件一到，就说明
   * sending 条目已真实投递 ⇒ 立刻从队列列表里删掉（不必等轮末的 settleAsync）。
   * 比对用归一指纹（剥块 + 折空白），图片清单也要一致，避免误删同文本的其它条目。
   */
  function retireSendingItemOnUserMessage(text: string, images?: string[]): void {
    const hitId = matchSendingQueueItem(state.queue.items, text, images)
    if (!hitId) return
    const sid = currentSessionId()
    if (!sid) return
    void api.queueOp(canvasId(), sid, { op: 'remove', itemId: hitId })
      .then((r) => { if (r.queue) state.queue = r.queue })
      .catch(() => undefined) // 删失败不打扰用户：轮末的 settleAsync 仍会结算
  }

  /**
   * 跑着的时候再发一条 ⇒ 进队列（用户口径 G2：不丢弃、不改按钮状态）。
   * 空闲时**不进队**（直接发，保持原行为）—— 由组件层判断走哪条路。
   */
  async function sendToQueue(text: string, images?: string[]): Promise<void> {
    const sid = currentSessionId()
    if (!sid) return
    const value = text.trim()
    const pics = (images ?? []).filter((u) => !!u)
    if (!value && !pics.length) return
    try {
      const r = await api.queueOp(canvasId(), sid, {
        op: 'add',
        text: value,
        ...(pics.length ? { images: pics } : {}),
        // 带目标标记时一起写进条目（轮到它时按目标模式启动）
        ...(state.goalMark
          ? { goal: { objective: state.goalMark.objective || value, budget: state.goalMark.budget } }
          : {}),
      })
      adoptQueue(r.queue)
      // 目标标记随这条消息走了：清掉（下一条是普通消息）
      if (state.goalMark) state.goalMark = null
      void listSessions()
    } catch (err) {
      setError('加入队列失败：' + (err instanceof Error ? err.message : String(err)))
    }
  }

  /** 引导（插队到正在跑的那一轮的下一次请求）：表面上像直接发送 */
  async function steerQueueItem(itemId: string): Promise<void> {
    const sid = currentSessionId()
    if (!sid) return
    const item = state.queue.items.find((i) => i.id === itemId)
    try {
      const r = await api.steerQueueItem(canvasId(), sid, itemId)
      if (r.steered) {
        /**
         * 成了：条目置「发送中」**留在队列里**（用户口径 2026-10-16：引导不是立即弹气泡
         * —— 消息要先以「发送中」呈现，等它真的进入对话（user_message 事件到达，
         * 内容以 [user_steering] 包裹）才由 retireSendingItemOnUserMessage 从队列删掉、
         * 气泡替换出现。「发送中显示队列」开关控制此刻它是否可见。
         */
        adoptQueue({
          ...state.queue,
          items: state.queue.items.map((i) =>
            i.id === itemId ? { ...i, state: 'sending' as const, sentAt: Date.now() } : i,
          ),
        })
      } else {
        // 没在跑 / 轮刚好结束：条目留在队列，调度器会按序发它。
        // 后端在 steer 失败分支已广播 queue 快照 —— 但本响应不是 SSE 订阅者收不到，
        // 这里主动拉一次队列快照，让界面立即看到「条目还在队首」而不是以为丢了。
        const q = await api.getQueue(canvasId(), sid)
        if (q.queue) state.queue = q.queue
      }
    } catch (err) {
      setError('引导失败：' + (err instanceof Error ? err.message : String(err)))
    }
  }

  /** 删除队列条目（真不要了） */
  async function removeQueueItem(itemId: string): Promise<void> {
    const sid = currentSessionId()
    if (!sid) return
    const r = await api.queueOp(canvasId(), sid, { op: 'remove', itemId })
    adoptQueue(r.queue)
  }

  /**
   * 拖拽排序（用户口径 2026-10-16）：把全量 id 的新顺序发到后台。乐观更新先贴本地
   * （拖完立刻就位），服务端广播回来再校准 —— sending / sent 的位置由后端钉住。
   */
  async function reorderQueue(order: string[]): Promise<void> {
    const sid = currentSessionId()
    if (!sid || order.length !== state.queue.items.length) return
    const byId = new Map(state.queue.items.map((it) => [it.id, it]))
    if (order.some((id) => !byId.has(id))) return
    state.queue = { ...state.queue, items: order.map((id) => byId.get(id)!) }
    try {
      const r = await api.queueOp(canvasId(), sid, { op: 'reorder', order })
      if (r.queue) state.queue = r.queue
    } catch {
      /* 服务端没成：等下一次 SSE queue 快照校准，不弹错打扰 */
    }
  }

  /**
   * 往头部续拉更早的转录（对话分页：顶部哨兵进可视区时调）。返回还有没有更早的。
   */
  async function loadEarlierTurns(): Promise<boolean> {
    const sid = currentSessionId()
    if (!sid || !state.turnsHaveBefore || state.turnsLoadingEarlier) return false
    state.turnsLoadingEarlier = true
    try {
      // turnsBefore = 已装进界面的条数：后端 end = total - before 正好落在已载窗口的
      // 开头，往前切一页就与已有内容**首尾相接**（评审抓到的 bug：此前误用
      // total - loaded 会让 end 变成 loaded，跳过中间整整一页）。
      const before = Math.max(0, state.turnsLoaded)
      const full = await api.sessionState(canvasId(), sid, { turnsLimit: TURNS_PAGE, turnsBefore: before })
      const rec = full.session
      if (Array.isArray(rec.turns) && rec.turns.length) model.loadEarlier(rec.turns)
      state.turnsLoaded += Array.isArray(rec.turns) ? rec.turns.length : 0
      state.turnsHaveBefore = full.turnsHaveBefore === true
      sync()
      return state.turnsHaveBefore
    } catch {
      return false
    } finally {
      state.turnsLoadingEarlier = false
    }
  }

  /**
   * 关闭排队：从队列移除，但**内容回填输入框**（变成草稿，用户可改可发）——
   * 与"删除"的区别就在这里（用户口径）。
   */
  async function closeQueueItem(itemId: string): Promise<{ text: string; images?: string[] } | null> {
    const sid = currentSessionId()
    if (!sid) return null
    const item = state.queue.items.find((i) => i.id === itemId)
    const r = await api.queueOp(canvasId(), sid, { op: 'close', itemId })
    adoptQueue(r.queue)
    return item ? { text: item.text, ...(item.images?.length ? { images: item.images } : {}) } : null
  }

  /** 开始编辑某条排队消息：标记 editing（阻塞队列），组件负责把内容回填输入框 */
  async function beginEditQueueItem(itemId: string): Promise<{ text: string; images?: string[] } | null> {
    const sid = currentSessionId()
    if (!sid) return null
    const item = state.queue.items.find((i) => i.id === itemId)
    if (!item) return null
    // op:'edit' 只把状态改成 editing（不碰内容）—— 队头变 editing，调度器就停住等发送。
    // 改完由 saveEditedQueueItem（op:'update'）原位替换并回 queued。
    const r = await api.queueOp(canvasId(), sid, { op: 'edit', itemId })
    adoptQueue(r.queue)
    return { text: item.text, ...(item.images?.length ? { images: item.images } : {}) }
  }

  /** 取消编辑：状态回 queued（内容不变），队列继续 */
  async function cancelEditQueueItem(itemId: string): Promise<void> {
    const sid = currentSessionId()
    if (!sid) return
    const r = await api.queueOp(canvasId(), sid, { op: 'cancel-edit', itemId })
    adoptQueue(r.queue)
  }

  /**
   * 放弃这条会话里**所有**编辑（不传 itemId 的 cancel-edit）。
   *
   * 调用点：界面切换会话前调一次 —— 编辑态有一部分记在发起编辑的那个客户端（进面板
   * 时会重建），切走后服务端那条 `editing` 没人取消，等它排到队头会**永久阻塞队列**。
   * 失败静默（清不掉的编辑不该拦住切会话）。
   */
  async function cancelAllEdits(sessionId: string): Promise<void> {
    await api.queueOp(canvasId(), sessionId, { op: 'cancel-edit' }).catch(() => undefined)
  }

  /**
   * 保存编辑后的队列消息：**原位替换**（位置不变 —— 用户口径 G3）。
   */
  async function saveEditedQueueItem(itemId: string, text: string, images?: string[]): Promise<void> {
    const sid = currentSessionId()
    if (!sid) return
    const value = text.trim()
    const pics = (images ?? []).filter((u) => !!u)
    if (!value && !pics.length) return
    const r = await api.queueOp(canvasId(), sid, {
      op: 'update',
      itemId,
      text: value,
      ...(pics.length ? { images: pics } : {}),
    })
    adoptQueue(r.queue)
  }

  /** 暂停队列自动发送（正在跑的那一轮照跑完） */
  async function pauseQueue(): Promise<void> {
    const sid = currentSessionId()
    if (!sid) return
    const r = await api.queueOp(canvasId(), sid, { op: 'pause' })
    adoptQueue(r.queue)
  }

  /** 恢复队列自动发送 */
  async function resumeQueue(): Promise<void> {
    const sid = currentSessionId()
    if (!sid) return
    const r = await api.queueOp(canvasId(), sid, { op: 'resume' })
    adoptQueue(r.queue)
  }

  // ==================================================================
  // 目标（设计 §3.4）：标记 → 发送时按目标模式起；进行中可暂停/改预算
  // ==================================================================

  /** 点 + → 目标：置上标记（预算用后台默认值；点标签才弹编辑框） */
  function setGoalMark(objective: string, budget: number): void {
    state.goalMark = { objective: objective.trim(), budget }
  }

  function clearGoalMark(): void {
    state.goalMark = null
  }

  /** 改进行中目标的预算 / 内容（下一轮生效） */
  async function updateGoal(patch: {
    objective?: string
    budget?: number
    deltaBudget?: number
    tokensUsed?: number
  }): Promise<void> {
    const sid = currentSessionId()
    if (!sid) return
    const r = await api.goalOp(canvasId(), sid, { op: 'update', ...patch })
    if (r.goal) state.goal = r.goal as GoalStateView
  }

  /** 暂停目标：把 GOAL.json 收走 —— 官方循环跑到边界自己停住（不打断当前轮） */
  async function pauseGoal(): Promise<void> {
    const sid = currentSessionId()
    if (!sid) return
    await api.goalOp(canvasId(), sid, { op: 'pause' })
    state.goalPaused = true
  }

  /** 启动目标：文件放回 + 踢一脚（后端负责） */
  async function resumeGoal(): Promise<void> {
    const sid = currentSessionId()
    if (!sid) return
    await api.goalOp(canvasId(), sid, { op: 'resume' })
    state.goalPaused = false
  }

  /**
   * 结束目标（用户口径 2026-10-09）：目标状态条上的 ✕ —— 与「暂停」不同，这是**真删掉**，
   * 不再能启动回来。本地立刻清空目标状态（后端也会广播 goal_state: null）。
   */
  async function endGoal(): Promise<void> {
    const sid = currentSessionId()
    if (!sid) return
    await api.goalOp(canvasId(), sid, { op: 'end' })
    state.goal = null
    state.goalPaused = false
  }

  /**
   * 写当前目标的参考图（编辑运行中目标时用；空数组 = 清掉）。
   *
   * 失败静默：参考图是可选装饰，写不进去不该打断"改目标"这件事。
   * 本地 state 先更新的那一份由调用方负责（组件里改了 s.goalImages）。
   */
  async function setGoalImages(images: string[]): Promise<void> {
    const sid = currentSessionId()
    if (!sid) return
    await api.setGoalImages(canvasId(), sid, images).catch(() => undefined)
  }

  /**
   * **带目标发送**：把标记里的目标一起送出去（走后端 startRun 的目标分支）。
   *
   * 与普通 send 的分工：目标消息不带队列语义（未跑时直接起），跑着时由组件层走 sendToQueue
   * （条目里带 goal，轮到它时调度器调 startGoal）。
   */
  async function sendGoal(text: string, images?: string[]): Promise<void> {
    const mark = state.goalMark
    if (!mark) return
    const sid = await ensureSession()
    if (!sid) return
    const value = text.trim() || mark.objective
    // 目标的参考图：落进宿主记录（目标行迷你预览用；与 GOAL.json 分开，见 sessionStore 注释）
    void api.setGoalImages?.(canvasId(), sid, images ?? []).catch(() => undefined)
    state.goalImages = images ?? []
    model.send(value, images)
    sync()
    state.running = true
    state.goalMark = null
    const ac = new AbortController()
    abort = ac
    try {
      // 同上（sendGoal）：send 响应与常驻流是同一条通道，必须一起按 seq 去重
      await api.sendMessage(
        canvasId(),
        sid,
        value,
        {
          ...sendOptions(),
          ...(images?.length ? { images } : {}),
          goal: { objective: mark.objective || value, budget: mark.budget },
        } as SendOptions,
        applyEvent,
        ac.signal,
        {
          acceptSeq,
          onSeq: (n) => {
            if (n > lastAppliedSeq) lastAppliedSeq = n
          },
        },
      )
    } catch (err) {
      if (!ac.signal.aborted) {
        setError(err instanceof Error ? err.message : String(err))
        applyEvent({ type: 'error', message: String(err) })
      }
    } finally {
      state.running = false
      abort = null
      applyEvent({ type: 'done' })
      await listSessions()
    }
  }

  /** 滚动到底（组件层的钩子；service 里只发一个"该滚了"的信号） */
  function nextTickScroll(): Promise<void> {
    return new Promise((r) => setTimeout(r, 0))
  }

  async function retry(): Promise<void> {
    if (lastText || lastImages?.length) await send(lastText, lastImages)
  }

  /**
   * 切换模型 = **换一条会话**（SDK 的模型钉在会话上，改不了）。
   *
   * 做法与"编辑重发"出来的分支完全一样：后端 branchFromEnd 把整段历史拷进新会话、
   * 在末尾登记分叉点，再补一条模型分段；界面这边按 openSession 重新装载
   * （新会话的转录含全量历史，分页器也会认出这条新分支）。
   *
   * 三条边界：
   *   · 没有会话（还没说过话）：只改本地选择，下一句建会话时自然带上新模型；
   *   · 选的就是当前模型：后端返回 unchanged，什么也不做（否则每点一次长一条会话）；
   *   · 这一轮在跑：后端拒绝（409），如实告诉用户等它跑完。
   */
  async function setModel(provider: string, modelId: string): Promise<void> {
    state.model = { provider, modelId }
    const sid = state.sessionId
    if (!sid) return
    try {
      const r = await api.switchModel(canvasId(), sid, provider, modelId)
      if (r.unchanged || !r.sessionId) return
      // 装载新会话：转录（全量历史 + 新分段）、id、标题、分页器一次到位。
      await openSession(r.sessionId)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      state.lastError = '切换模型失败：' + message
    }
  }

  /**
   * 主动压缩上下文（「压缩」命令）。
   *
   * 走独立 SSE：后端的 compaction_begin / 摘要 / compaction_end 一路推回来，
   * 同一条事件也可能从常驻流到一次 —— 所以照样带上帧级水位一起去重。
   */
  async function compact(): Promise<void> {
    const sid = state.sessionId
    if (!sid) {
      state.lastError = '还没有对话内容，不用压缩'
      return
    }
    if (state.compacting) return
    state.lastError = ''
    const ac = new AbortController()
    try {
      await api.compact(canvasId(), sid, applyEvent, ac.signal, {
        acceptSeq,
        onSeq: (n) => {
          if (n > lastAppliedSeq) lastAppliedSeq = n
        },
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      // 流断了也要把"正在压缩"收掉，否则界面会一直转圈（后台其实早结束了）
      state.compacting = false
    }
  }

  function activePromptText(): string {
    const p = state.prompts.find((x) => x.id === state.activePromptId)
    return p?.text ?? ''
  }

  /**
   * 提示词变了就开新会话。
   *
   * 模式是**会话级**的：SDK 把系统提示词钉在建会话那一次（见 ensureSession）。于是
   * 「切了模式」或「改了当前模式的正文」都要换一条会话，否则用户看到的是旧提示词在跑。
   * 判定用**正文比对**（不是模式 id）：改正文时 id 没变，只有正文能看出来。
   * sessionPromptText 为空 = 打开的是历史会话、不知道当时用什么，一并当作需要换。
   */
  /**
   * 提示词不新鲜就换会话。**必须 await**：它内部是 async 的 newSession()，
   * 不 await 的话 newSession 在后台清 state.sessionId / state.turns，
   * send() 同时已经在 ensureSession() 里建新会话 —— 清完回来 state.turns 已空，
   * 后面的 fork 分支拿不到被编辑的消息，fork 被整体跳过（实测：fork 出的新会话没历史）。
   */
  async function ensurePromptFresh(): Promise<void> {
    if (!state.sessionId) return
    // 提示词未知（历史会话 / 分支）时**不换会话**：留在原地继续聊是用户预期；
    // 换会话只在「我们知道这条会话当时用的提示词、而现在它确实变了」时发生。
    if (!state.promptKnown) return
    if (state.sessionPromptText === activePromptText()) return
    await newSession()
  }

  async function loadPrompts(): Promise<void> {
    try {
      const r = await api.prompts()
      state.prompts = (Array.isArray(r.prompts) ? r.prompts : []) as PromptPreset[]
      // 没有选中 / 选中的已被删 → 落回第一条（内置的「全能创作」永远在）
      if (!state.prompts.some((p) => p.id === state.activePromptId)) {
        state.activePromptId = state.prompts[0]?.id ?? ''
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function savePrompts(list: PromptPreset[]): Promise<void> {
    const r = await api.savePrompts(list)
    state.prompts = (Array.isArray(r.prompts) ? r.prompts : []) as PromptPreset[]
    if (!state.prompts.some((p) => p.id === state.activePromptId)) {
      state.activePromptId = state.prompts[0]?.id ?? ''
    }
  }

  async function setActivePrompt(id: string): Promise<void> {
    if (!state.prompts.some((p) => p.id === id)) return
    state.activePromptId = id
    // 必须先等它清完（若触发换会话），再做 fork/发送：否则上面的竞态吃掉 fork（实测）
    await ensurePromptFresh()
  }

  /** 拉一次「会话标题模型」配置（打开设置页时调） */
  async function loadTitleModel(): Promise<void> {
    try {
      const r = await api.titleModel()
      state.titleModel = {
        provider: typeof r.provider === 'string' ? r.provider : '',
        modelId: typeof r.modelId === 'string' ? r.modelId : '',
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  /** 写「会话标题模型」配置（两个都空 = 回落会话默认模型） */
  async function saveTitleModel(provider: string, modelId: string): Promise<void> {
    const r = await api.saveTitleModel({
      ...(provider ? { provider } : {}),
      ...(modelId ? { modelId } : {}),
    })
    state.titleModel = {
      provider: typeof r.provider === 'string' ? r.provider : '',
      modelId: typeof r.modelId === 'string' ? r.modelId : '',
    }
  }

  function setCanvasId(id: string): void {
    if (id) state.canvasId = id
  }

  /** 记下待引用的节点（去重 + 去掉空 id）；右键给 1 个、多选栏给一批，同一条路 */
  function requestNodeRefs(nodeIds: string[]): void {
    const ids = [...new Set(nodeIds.filter((id) => Boolean(id)))]
    if (ids.length) state.pendingNodeRefs = ids
  }

  /**
   * 引用一份资产到输入框（资产面板「添加到 Agent」调用）。
   *
   * 与「引用到 Agent」**同一条通道**：这里只记**待引用的资产数据**，
   * 由输入框组件用 assetResource() 现造完整标签（带 renderItem/renderEditor）。
   * 早先的写法在服务里塞了个半成品对象（没有 renderItem/renderEditor）—— 插进输入框渲染不出来，
   * 于是「添加到 Agent」看着没反应（用户报的 bug）。
   */
  function referenceAsset(asset: { id?: string; name: string; url: string; path?: string; folderId?: string; isFolder?: boolean }): void {
    state.pendingAsset = {
      id: asset.id, name: asset.name, url: asset.url,
      ...(asset.path ? { path: asset.path } : {}),
      ...(asset.folderId ? { folderId: asset.folderId } : {}),
      ...(asset.isFolder ? { isFolder: true } : {}),
    }
    // 打开面板并刷新（面板关着时先记下，组件挂载后补插）
    state.open = true
    void refresh()
  }
  /**
   * 批量引用：一次插**多张**资产标签（多选工具栏「加入资产库」调用）。
   *
   * 与单张同一条通道 —— 只是待插项从 1 变成 N。组件消费后一次清空
   * （clearPendingResources，区别于单张的 clearPendingResource）。
   */
  function referenceAssets(assets: Array<{ id?: string; name: string; url: string; path?: string; folderId?: string; isFolder?: boolean }>): void {
    if (!assets.length) return
    state.pendingAssets = assets.map((a) => ({
      id: a.id, name: a.name, url: a.url,
      ...(a.path ? { path: a.path } : {}),
      ...(a.folderId ? { folderId: a.folderId } : {}),
      ...(a.isFolder ? { isFolder: true } : {}),
    }))
    state.open = true
    void refresh()
  }
  /** 输入框组件批量插完后清掉 */
  function clearPendingResources(): void {
    state.pendingAssets = null
  }
  /** 输入框组件插完标签后清掉 */
  function clearPendingResource(): void {
    state.pendingAsset = null
  }

  function clearNodeRefs(): void {
    state.pendingNodeRefs = null
  }

  /** 编辑状态：模型持真值（单选），state 只放只读镜像给模板 */
  function beginEdit(turnId: string): void {
    model.beginEdit(turnId)
    state.editingId = model.editingId
    sync()
  }

  function cancelEdit(): void {
    model.cancelEdit()
    state.editingId = null
    sync()
  }

  async function decide(approvalId: string, decision: 'allow' | 'deny'): Promise<void> {
    if (!state.sessionId) return
    // 先把卡片点亮（用户立刻看到反馈），再发请求
    applyEvent({ type: 'approval_result', id: approvalId, decision })
    try {
      await api.approve(canvasId(), state.sessionId, approvalId, decision)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function savePolicy(policy: ApprovalPolicyView): Promise<void> {
    try {
      const r = await api.putPolicy(policy as unknown as Record<string, unknown>)
      const next = r.policy as ApprovalPolicyView | undefined
      if (next) state.policy = next
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function importSkill(dir: string): Promise<void> {
    await api.importSkill(dir)
    await refresh()
  }

  async function loadSkillCandidates(): Promise<void> {
    try {
      const r = await api.skillSources()
      state.skillCandidates = (Array.isArray(r.candidates) ? r.candidates : []) as AgentServiceState['skillCandidates']
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  /**
   * 问上游要模型清单（GET {baseUrl}/models）。
   *
   * 用户手里是自建网关，模型 ID 有一串，让他手打容易错 —— 拉回来做成下拉。
   * 失败不抛（可能还没配密钥）：把错误原样交给界面显示。
   */
  async function loadUpstreamModels(
    body: { provider?: string; modelId?: string; baseUrl?: string; apiKey?: string } = {},
  ): Promise<{ ok: boolean; models: string[]; error?: string }> {
    try {
      const r = await api.upstreamModels(body)
      const models = (Array.isArray(r.models) ? r.models : []).map(String)
      state.upstreamModels = models
      if (!r.ok && typeof r.error === 'string') setError(r.error)
      return { ok: r.ok === true, models, ...(typeof r.error === 'string' ? { error: r.error } : {}) }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      return { ok: false, models: [], error: message }
    }
  }

  async function saveSystemPrompt(text: string): Promise<void> {
    const r = await api.saveSystemPrompt(text)
    state.systemPrompt = typeof r.text === 'string' ? r.text : text
  }

  /**
   * 把提示词模板恢复成出厂模板（用户点按钮才调）。
   *
   * 只在模板体检不通过时才有意义：那时 {{AGENTS_MD}} 丢了，用户在设置里写什么提示词都
   * 进不去模型，而模型端不报错 —— 只能靠这个动作把链路接回来。
   */
  async function restoreTemplate(): Promise<void> {
    try {
      const r = await api.restoreTemplate()
      const tpl = r.template
      state.templateHealth = {
        ok: tpl?.ok !== false,
        missing: Array.isArray(tpl?.missing) ? tpl.missing.map(String) : [],
      }
      // 提示词正文没变（模板是另一处），但重拉一次让设置页的状态一致
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function removeSkill(name: string): Promise<void> {
    await api.removeSkill(name)
    await refresh()
    await loadSkillCandidates()
  }

  async function addMcp(body: Record<string, unknown>): Promise<void> {
    await api.addMcp(body)
    await refresh()
  }

  async function removeMcp(name: string): Promise<void> {
    await api.removeMcp(name)
    await refresh()
  }

  /**
   * 主动连一次 MCP，把「连了几个、有哪些工具」拿回来。
   *
   * 为什么不复用会话里的那份连接：那是 SDK 在第一次 run() 时自己起的，
   * 探它要碰会话生命周期（耦合重，而且没会话时还探不了）。这里独立探一次，
   * 探测完服务端会立刻关掉连接 —— 用户点一次「检查」就查一次，代价合理。
   */
  async function probeMcp(names?: string[]): Promise<McpProbeResult> {
    try {
      const r = await api.probeMcp(names)
      return {
        ok: r.ok === true,
        servers: (Array.isArray(r.servers) ? r.servers : []) as McpProbeResult['servers'],
        tools: (Array.isArray(r.tools) ? r.tools : []) as McpProbeResult['tools'],
        warnings: (Array.isArray(r.warnings) ? r.warnings : []).map(String),
        ...(typeof r.error === 'string' ? { error: r.error } : {}),
      }
    } catch (err) {
      return { ok: false, servers: [], tools: [], warnings: [], error: err instanceof Error ? err.message : String(err) }
    }
  }

  async function saveModel(body: Record<string, unknown>): Promise<void> {
    await api.saveModel(body)
    await refresh()
  }

  /**
   * 让当前会话丢掉旧的 MCP 连接（下一句重新连）。
   *
   * 没有会话时直接返回 false：还没开始聊，本来就不存在"旧连接"，
   * 下一句自然是一条新会话、会重新连。
   */
  async function reconnectMcp(): Promise<boolean> {
    if (!state.sessionId) return false
    try {
      const r = await api.reconnectMcp(canvasId(), state.sessionId)
      return r.released === true
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return false
    }
  }

  /**
   * 编辑一个渠道：把「勾中的模型」一次写进去，并把该渠道下**取消勾选**的旧模型删掉。
   *
   * 为什么走一个批量接口而不是在界面里循环：见 agentApi.saveModelsBulk 的注释。
   * 成功后重新 refresh()，列表与下拉都拿服务端的真实结果（不在前端自己拼）。
   */
  async function saveModelsBulk(body: Record<string, unknown>): Promise<void> {
    await api.saveModelsBulk(body)
    await refresh()
  }

  async function deleteModel(provider: string, modelId: string): Promise<void> {
    await api.deleteModel(provider, modelId)
    await refresh()
  }

  async function setDefaultModel(provider: string, modelId: string): Promise<void> {
    await api.setDefaultModel(provider, modelId)
    state.model = { provider, modelId }
    await refresh()
  }

  return {
    state,
    turns: computed(() => state.turns),
    // ---------------------------------------------------------------- 队列（设计 §3.3）
    sendToQueue,
    steerQueueItem,
    removeQueueItem,
    reorderQueue,
    loadEarlierTurns,
    closeQueueItem,
    beginEditQueueItem,
    cancelEditQueueItem,
    cancelAllEdits,
    saveEditedQueueItem,
    pauseQueue,
    resumeQueue,
    // ---------------------------------------------------------------- 目标（设计 §3.4）
    setGoalMark,
    clearGoalMark,
    updateGoal,
    pauseGoal,
    resumeGoal,
    endGoal,
    sendGoal,
    setGoalImages,
    toggle: () => {
      state.open = !state.open
      if (state.open) void refresh()
    },
    show: () => {
      state.open = true
      void refresh()
    },
    hide: () => {
      state.open = false
    },
    refresh,
    /** 接上这条会话的常驻事件流（组件挂载 / 面板打开时调） */
    attachStream,
    /** 断开事件流订阅（组件卸载时调；不停后台那一轮） */
    detachStream,
    newSession,
    listSessions,
    openSession,
    renameSession,
    deleteSession,
    send,
    stop,
    retry,
    setModel,
    compact,
    decide,
    savePolicy,
    importSkill,
    loadSkillCandidates,
    loadUpstreamModels,
    saveSystemPrompt,
    restoreTemplate,
    removeSkill,
    addMcp,
    removeMcp,
    probeMcp,
    reconnectMcp,
    saveModel,
    saveModelsBulk,
    deleteModel,
    setDefaultModel,
    loadPrompts,
    savePrompts,
    setActivePrompt,
    loadTitleModel,
    saveTitleModel,
    activePromptText,
    setCanvasId,
    requestNodeRefs,
    clearNodeRefs,
    referenceAsset,
    clearPendingResource,
    referenceAssets,
    clearPendingResources,
    beginEdit,
    cancelEdit,
  }
}
