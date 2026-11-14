import type { SendOptions } from '../../api/agentApi.js'
import type { AgentServiceContext, AgentServiceDeps } from '../context.js'

/** 发送 / 重试 / 压缩 / 切换模型：一轮对话的生命周期（不含会话打开与队列） */
export function createSendDomain(ctx: AgentServiceContext, deps: AgentServiceDeps) {
  const { state, api, model } = ctx
  const { canvasId, sync } = ctx
  const lastAppliedSeq = ctx.seqRef
  const abort = ctx.abortRef
  let lastText = ''
  /** 上一轮的图片（retry 要连图一起重发，否则"重试"会把图丢了） */
  let lastImages: string[] | undefined

  async function ensureSession(): Promise<string | null> {
    if (state.sessionId) return state.sessionId
    if (state.needsModel) {
      ctx.setError('还没有配置模型：请到 设置 → Agent → 模型 里加一个带密钥的模型')
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
      const prompt = deps.activePromptText()
      if (prompt) opts.systemPrompt = prompt
      const created = await api.createSession(canvasId(), { ...opts })
      state.sessionId = created.id
      // 第一句话已经把这条件谈成了真会话：空白态结束（见 state.draft）
      state.draft = false
      // 记下建这条会话时用的提示词正文（见 sessionPromptText 的说明）：
      // 之后发送前比对，正文变了就换会话，保证「改了提示词下一句就生效」。
      state.sessionPromptText = prompt
      state.promptKnown = true
      await deps.listSessions()
      return created.id
    } catch (err) {
      ctx.setError(err instanceof Error ? err.message : String(err))
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
    const prompt = deps.activePromptText()
    if (prompt) opts.systemPrompt = prompt
    return opts
  }

  async function send(text: string, images?: string[]): Promise<void> {
    const value = text.trim()
    const pics = (images ?? []).filter((u) => !!u)
    // 只有图、没有字也算一条合法消息（用户常直接丢图问"这是什么"）
    if ((!value && !pics.length) || state.running) return
    ctx.setError('')
    // 新的一轮开始：把上一条错误条收掉（它属于上一次失败，用户已经看到了）
    state.lastError = ''
    // 发送前再校一次提示词新鲜度：用户可能刚在设置里改了模式正文、没动过模式下拉，
    // 这条会话就得换成新提示词的那条（见 ensurePromptFresh）。
    // **编辑重发必须跳过它**：新鲜度检查会 newSession() 清掉 turns/sessionId，
    // fork 就找不到被编辑的消息了（实测：fork 被跳过、消息发进无历史的新会话）。
    // 分支出的会话继承父 trace 的系统提示词，本来就不受这次选择影响。
    if (!state.editingId) await deps.ensurePromptFresh()
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
          await deps.openSession(fork.sessionId)
          id = fork.sessionId
        } catch (err) {
          ctx.setError('分支创建失败，按原会话继续：' + (err instanceof Error ? err.message : String(err)))
        }
      }
      deps.cancelEdit()
    }
    if (!id) return
    /**
     * 切了模型、并且**现在真的发消息** → 这才是"换模型"的那一刻（用户 2026-11-14 口径）。
     *
     * 只在「选中的模型 ≠ 当前会话记录的模型」时切：换会话会把整段历史带过去、在末尾登记分叉点，
     * 与编辑重发是同一套分支语义。选了模型没发消息的情况在上面 setModel 里已经不需要建任何东西。
     * 编辑重发优先（上面已 fork 到新会话），这里不再重复切。
     */
    if (!state.editingId && state.model) {
      const sid = state.sessionId
      /**
       * 当前会话"真正在用的模型"：以会话记录为准（sessions 列表可能还没刷新）。
       * 读不到记录就当一致 —— 宁可少切一次，也不要因为列表没刷新就凭空长分支。
       */
      let recorded: { provider?: string; modelId?: string } | undefined = sid
        ? state.sessions.find((x) => x.id === sid)
        : undefined
      if (sid && (!recorded || !recorded.provider)) {
        recorded = await api.getSession(canvasId(), sid).catch(() => undefined)
      }
      const drift = recorded && recorded.provider
        && (recorded.provider !== state.model.provider || recorded.modelId !== state.model.modelId)
      if (drift) {
        const switched = await switchModelForSend(state.model.provider, state.model.modelId)
        if (switched) id = switched
      }
    }
    lastText = value
    lastImages = pics.length ? pics : undefined
    // 界面与转录、发给模型的内容现在是**同一份**（用户口径 2026-10-08：标记改用 <ref …> XML，
    // 自带本机绝对路径，复制到本机 Agent 直接可用；后端不再翻译）。SDK 会把标记当普通文本
    // 交给模型 —— 标记的含义由系统提示词（REFERENCE_MARKUP_GUIDE）一次性说明。
    model.send(value, pics.length ? pics : undefined)
    sync()
    state.running = true
    const ac = new AbortController()
    abort.value = ac
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
        deps.applyEvent,
        ac.signal,
        {
          acceptSeq: deps.acceptSeq,
          onSeq: (n) => {
            if (n > lastAppliedSeq.value) lastAppliedSeq.value = n
          },
        },
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // 主动中止不算错误（用户按了停止）
      if (ac.signal.aborted) deps.applyEvent({ type: 'done' })
      /**
       * 页面刷新 / 关闭把 SSE 连带掐断时，fetch 会抛 "Failed to fetch"（Chrome）/
       * "network error"（Firefox）。后台那一轮其实还在跑（托管模式），把这种
       * 传输中断当「这一轮失败」写进 lastError 就是冤案 —— 刷新回来看到一条
       * 与实际不符的错误条（真机 2026-10-16 复现）。判定：传输类错误 + 后端
       * /health 还活着 ⇒ 视为导航中断，不落错误条、不落盘。
       */
      else if (/^(Failed to fetch|network error|fetch failed|Load failed)$/i.test(message.trim()) && !(await api.isBackendAlive().catch(() => false))) {
        // 连 /health 都不通：这次传输错误有可能是真的后端挂了，如实报。
        ctx.setError(message)
        deps.applyEvent({ type: 'error', message })
        if (id) void api.setLastError(canvasId(), id, message).catch(() => undefined)
      }
      else if (/^(Failed to fetch|network error|fetch failed|Load failed)$/i.test(message.trim())) {
        // 后端还活着 ⇒ 是本页导航/网络抖动掐断了 SSE：后台轮继续，界面交给
        // 常驻流重连恢复，不渲染错误条。
        deps.applyEvent({ type: 'done' })
      }
      else {
        ctx.setError(message)
        deps.applyEvent({ type: 'error', message })
        // 落盘到会话记录（用户口径 2026-10-16：刷新后错误信息看不到 —— 错误是
        // 运行态，之前只存在内存里，刷新就没了）。恢复会话时 GET 带回 lastError，
        // 界面错误条据此还原。
        if (id) void api.setLastError(canvasId(), id, message).catch(() => undefined)
      }
    } finally {
      state.running = false
      abort.value = null
      deps.applyEvent({ type: 'done' })
      // 本轮跑完后**无条件接上常驻流**（真机自动化 2026-10-16 两轮抓到）：队列里的
      // 条目（含本轮自己进队的情况）由调度器自动发，事件走 hub 常驻通道；send 响应流
      // 已断，不接的话界面永远停在旧状态。常驻流按帧级水位去重，多接无害。
      if (state.sessionId) deps.attachStream(state.sessionId)
      await deps.listSessions()
    }
  }

  function stop(): void {
    abort.value?.abort()
    if (state.sessionId) void api.abort(canvasId(), state.sessionId)
    state.running = false
  }
  /** 滚动到底（组件层的钩子；service 里只发一个"该滚了"的信号） */
  function nextTickScroll(): Promise<void> {
    return new Promise((r) => setTimeout(r, 0))
  }

  async function retry(): Promise<void> {
    if (lastText || lastImages?.length) await send(lastText, lastImages)
  }

  /**
   * 选模型 = **只记下选择**，不立刻开会话（用户 2026-11-14 口径）。
   *
   * 为什么改（真机现象）：原来一点模型就 branchFromEnd 建一条新会话并登记成分支，
   * 用户只是"挑了一下"并没有说话，历史里就多出一条分支 —— 同一栏里冒出两个分页器，
   * 对话记录被切得七零八落。用户的要求是：**切了模型并且真的发消息**，才算换了一条分支。
   *
   * 现在的做法：这里只写 state.model（输入区/标题立刻显示新模型），真正建分支挪到 send() ——
   * 发送前若发现"当前会话的模型 ≠ 选中的模型"，先切会话再发（见 switchModelForSend）。
   * 好处：选了不用的模型不会留下任何痕迹；连切几次也只在最后发的那次建一条分支。
   */
  async function setModel(provider: string, modelId: string): Promise<void> {
    state.model = { provider, modelId }
  }

  /**
   * 发送前的"真正切换模型"：把当前会话整段接到新会话上（分支语义与编辑重发一致）。
   *
   * @returns 切换后应该继续发送的会话 id；不需要切 / 切换失败 → null（调用方按原会话发）。
   */
  async function switchModelForSend(provider: string, modelId: string): Promise<string | null> {
    const sid = state.sessionId
    if (!sid) return null
    try {
      const r = await api.switchModel(canvasId(), sid, provider, modelId)
      if (r.unchanged || !r.sessionId) return null
      // 装载新会话：转录（全量历史 + 新分段）、id、标题、分页器一次到位。
      await deps.openSession(r.sessionId)
      return r.sessionId
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      ctx.setError(message)
      state.lastError = '切换模型失败：' + message
      return null
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
      await api.compact(canvasId(), sid, deps.applyEvent, ac.signal, {
        acceptSeq: deps.acceptSeq,
        onSeq: (n) => {
          if (n > lastAppliedSeq.value) lastAppliedSeq.value = n
        },
      })
    } catch (err) {
      ctx.setError(err instanceof Error ? err.message : String(err))
    } finally {
      // 流断了也要把"正在压缩"收掉，否则界面会一直转圈（后台其实早结束了）
      state.compacting = false
    }
  }

  return {
    ensureSession,
    sendOptions,
    send,
    stop,
    retry,
    setModel,
    compact,
    nextTickScroll,
  }
}







