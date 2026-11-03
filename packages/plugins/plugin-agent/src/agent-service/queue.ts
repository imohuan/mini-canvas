import type { QueueStateView } from '../agentApi.js'
import { matchSendingQueueItem } from '../userSteering.js'
import type { AgentServiceContext, AgentServiceDeps } from './context.js'
import { TURNS_PAGE } from './context.js'

/** 队列（设计 §3.3）：待发 / 引导 / 排序 / 编辑 / 暂停 / 转录续拉 */
export function createQueueDomain(ctx: AgentServiceContext, deps: AgentServiceDeps) {
  const { state, api, model } = ctx
  const { canvasId, sync, setError } = ctx

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
      void deps.listSessions()
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
        // 同时给一句可见提示（用户实测 2026-10-16：空闲时点引导"完全没反应"，
        // 不知道消息去哪了 —— 其实它还在队列里等下一轮）。
        const q = await api.getQueue(canvasId(), sid)
        if (q.queue) state.queue = q.queue
        setError('当前没有正在运行的回复，这条消息还排在队列里，等下一轮自动发送')
        // 用户口径 2026-10-16（二次修正）：空闲/暂停时点引导 = **直接发送这条**，
        // 不是"留在队列等下一轮"—— 空闲时起一轮立即发才是用户点的本意。
        // 从队列移除 + 正常发送（内容仍在，气泡照常出现）。
        await api.queueOp(canvasId(), sid, { op: 'remove', itemId })
        const fresh = await api.getQueue(canvasId(), sid)
        if (fresh.queue) state.queue = fresh.queue
        if (item) {
          void deps.send(item.text, item.images)
        }
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

  return {
    currentSessionId,
    retireSendingItemOnUserMessage,
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
  }
}



