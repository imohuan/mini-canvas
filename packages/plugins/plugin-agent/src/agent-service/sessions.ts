import { groupConversations, inlinePagers } from '../branchNav.js'
import type { AgentContextView, PromptSectionView, GoalStateView, ChatEvent } from '../agentApi.js'
import type { AgentServiceContext, AgentServiceDeps } from './context.js'
import { TURNS_PAGE } from './context.js'
import type { AgentServiceState, ApprovalPolicyView, McpRow, ModelRow, ProviderRow, SkillRow } from './types.js'

/** 会话 + 常驻事件流：打开 / 恢复 / 列表 / 分页器 / 新建 / 切换 / 改名 / 删除 */
export function createSessionDomain(ctx: AgentServiceContext, deps: AgentServiceDeps) {
  const { state, api, model } = ctx
  const { canvasId, sync, setError } = ctx

  /** 常驻流的重连计数（成功连上后归零；见 attachStream 的退避） */
  let streamRetry = 0
  /** 重连的定时器（换会话 / 卸载时要清掉） */
  let streamRetryTimer: ReturnType<typeof setTimeout> | null = null
  /** 当前这条流属于哪个会话（换会话要重接；见 attachStream） */
  let streamSessionId: string | null = null
  /** 当前常驻流句柄（与 send 的 abort 分开） */
  let streamAbort: AbortController | null = null
  /** 接流的水位：转录里已经有的最后一条事件序号 */
  let streamSince = 0
  /** 帧级水位（原父闭包变量；send / 常驻流 / 压缩共用） */
  const lastAppliedSeq = ctx.seqRef
  function logStreamError(err: unknown): void {
    // 流断了不是"对话失败"：后台还在跑，界面下一轮刷新会拿回结果。
    // 用 error 提示但不清空内容（与 SSE 断线的既有口径一致）。
    setError('连接中断（后台仍在继续，可刷新查看）：' + (err instanceof Error ? err.message : String(err)))
  }

  function acceptSeq(seq: number): boolean {
    if (seq <= lastAppliedSeq.value) return false
    lastAppliedSeq.value = seq
    return true
  }
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
      deps.retireSendingItemOnUserMessage(ev.text, ev.images)
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
    const since = Math.max(streamSince, lastAppliedSeq.value)
    void api
      // follow=常驻：会话页开着就一直连着，后台**空闲时自动起轮**（队列发下一条）
      // 的事件也能收到 —— 不连就永远不知道后台在动。
      .streamSession(canvasId(), sessionId, since, applyEvent, ac.signal, {
        follow: true,
        acceptSeq,
        onSeq: (n) => {
          if (n > lastAppliedSeq.value) lastAppliedSeq.value = n
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
      await deps.loadPrompts()
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
    await deps.restoreCurrentSession()
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
      if (leaving && leaving !== id) await deps.cancelAllEdits(leaving)
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
      /**
       * 刷新后恢复「正在思考」加载态（用户口径 2026-10-16）：托管模式的轮在后台
       * 继续跑，但转录里的回合 streaming 恒为 false —— 刷新后加载 UI 就消失了，
       * 用户不知道任务还在进行。GET 会话的 running=true 时，把最后一条助手消息
       * 重新置为 streaming（与 send()/队列自动发时的形态一致）。
       */
      if (full.running === true) {
        const lastAssistant = [...model.turns].reverse().find((t) => t.kind === 'assistant')
        if (lastAssistant) {
          lastAssistant.streaming = true
          // 正文已被转录覆盖到最后一拍；streaming 置位后 UI 显示加载指示，
          // 后续 text 增量由常驻流（attachStream）继续喂进来。
        } else {
          /**
           * 刷新落在「用户回合已落盘、助手还没有任何输出」的窗口里（真机复现
           * 2026-10-16）：转录里根本没有 assistant 回合可以标 streaming，
           * 上面 find 拿到 undefined，加载 UI 就没了。这里补一条**空的助手占位**
           * （与 send()/acceptUserMessage 的形态一致）：后续 text 事件由
           * lastAssistant() 定位到它，内容照常往里写。
           */
          model.turns.push({
            id: 'restore-' + Date.now(),
            kind: 'assistant',
            text: '',
            thinking: '',
            steps: [],
            tools: [],
            streaming: true,
          })
        }
        state.running = true
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
      lastAppliedSeq.value = streamSince
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
      // 最近一次发送失败的提示（用户口径 2026-10-16）：错误不在转录里，
      // 刷新后从会话记录恢复 —— 否则失败信息彻底消失，用户不知道发没发成功。
      // 注意放在上面的清空**之后**（这条错误就属于这一条会话）。
      state.lastError = full.lastError ?? ''
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

  return {
    acceptSeq,
    applyEvent,
    attachStream,
    detachStream,
    refresh,
    restoreCurrentSession,
    listSessions,
    refreshPagers,
    newSession,
    openSession,
    renameSession,
    deleteSession,
  }
}





