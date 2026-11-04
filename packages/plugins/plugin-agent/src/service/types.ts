import type { ComputedRef } from 'vue'
import type {
  AgentContextView,
  PromptSectionView,
  QueueStateView,
  GoalStateView,
  SessionMetaView,
} from '../api/agentApi.js'
import type { AgentTurnView } from '../model/sessionModel.js'
import type { ConversationGroup, PagerGroup } from '../model/branchNav.js'

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

