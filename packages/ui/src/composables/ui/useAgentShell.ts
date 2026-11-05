import { computed } from 'vue'
import { readyHost } from './hostRuntime'
import type { UiState } from './createUiState'
import type { FeedbackService } from '@mini-canvas/canvas-render'

export interface AgentShellView {
  open: boolean
  docked: boolean
  width: number
  title: string
  /** 当前会话 id（历史列表高亮「我现在在哪条」要它；null = 还没开聊） */
  sessionId: string | null
  /** 会话列表（updatedAt 供历史列表挑"最后使用"的那条成员） */
  sessions: Array<{ id: string; title: string; preview?: string; updatedAt: number }>
  /** 历史列表行：一个对话一行（分支树聚合；rootId = 点击目标） */
  conversations: Array<{
    rootId: string
    memberIds: string[]
    meta: { id: string; title: string; preview?: string; updatedAt: number }
  }>
}

/**
 * Agent 对话外壳：状态与动作都住在 agent 服务上，外壳只读/只调。
 *
 * agentSvcRef 必须保持 computed —— 服务晚于首帧上架时也要能触发面板重算。
 */
export function createAgentShellScope(state: UiState) {
  // ===== Agent 对话（外壳在这里，内容在 plugin-agent 的 agent-conversation 槽里）=====
  // 状态与动作都住在 agent 服务上：外壳只读它、只调它，自己不存一份 ——
  // 这样别处（快捷键 / 底栏按钮）调同一个服务时，面板与它天然一致。

  /**
   * agent 服务本身也要在**取回时**建立响应式依赖。
   *
   * 为什么不能只靠 readyHost.ctx 的 getter：host 就绪 ≠ 服务已上架。
   * agent 插件的 apply 在画布首帧之后才 run，首次渲染读到的 ctx 里还没有 'agent'，
   * get 返回 undefined；此后 ctx 不再变化，`v-show="ui.agent.open"` 就**永远**是 false，
   * 面板 DOM 一直带 display:none（用户 2026-11-02 报「Agent 点开没反应」）。
   * 用 computed 把 ctx 与服务一起收进依赖：服务一上架，所有 agent 面板的绑定立刻重算。
   */
  const agentSvcRef = computed(() => readyHost.ctx?.get<{ state: AgentShellView }>('agent'))
  const agentSvc = (): { state: AgentShellView } | undefined => agentSvcRef.value
  /** 外壳要用的那几项（服务还没上架时给一份安全的空壳，界面照常渲染） */
  const agent = {
    get open(): boolean {
      return agentSvc()?.state.open ?? false
    },
    set open(v: boolean) {
      const svc = agentSvc()
      if (svc) svc.state.open = v
    },
    get docked(): boolean {
      return agentSvc()?.state.docked ?? false
    },
    set docked(v: boolean) {
      const svc = agentSvc()
      if (svc) svc.state.docked = v
    },
    get width(): number {
      return agentSvc()?.state.width ?? 400
    },
    set width(v: number) {
      const svc = agentSvc()
      if (svc) svc.state.width = v
    },
    get title(): string {
      return agentSvc()?.state.title ?? '新会话'
    },
    /** 当前模型展示名（标题下小字用）：displayName 优先，其次 modelId；未选时为 null */
    get modelLabel(): string | null {
      const svc = agentSvc()
      const state = svc?.state as { model?: { provider: string; modelId: string } | null; models?: Array<{ provider: string; modelId: string; displayName?: string }> } | undefined
      if (!state?.model) return null
      const hit = state.models?.find((m) => m.provider === state.model!.provider && m.modelId === state.model!.modelId)
      return hit?.displayName || state.model.modelId
    },
    get sessions(): Array<{ id: string; title: string; preview?: string; updatedAt: number }> {
      return agentSvc()?.state.sessions ?? []
    },
    get sessionId(): string | null {
      return agentSvc()?.state.sessionId ?? null
    },
    get conversations(): Array<{
      rootId: string
      memberIds: string[]
      meta: { id: string; title: string; preview?: string; updatedAt: number }
    }> {
      return agentSvc()?.state.conversations ?? []
    },
  }
  function setAgentOpen(open: boolean): void {
    const svc = agentSvc()
    if (svc) svc.state.open = open
  }
  function toggleAgent(): void {
    const svc = readyHost?.ctx?.get<{ toggle?: () => void; state?: { open: boolean } }>('agent')
    if (!svc) return
    if (typeof svc.toggle === 'function') svc.toggle()
    else if (svc.state) svc.state.open = !svc.state.open
  }
  function newAgentChat(): void {
    const svc = readyHost?.ctx?.get<{ newSession?: () => Promise<void> }>('agent')
    if (svc?.newSession) void svc.newSession()
  }
  function toggleAgentHistory(): void {
    state.agentHistoryOpen = !state.agentHistoryOpen
  }
  function openAgentSession(id: string): void {
    state.agentHistoryOpen = false
    const svc = readyHost?.ctx?.get<{ openSession?: (id: string) => Promise<void> }>('agent')
    if (svc?.openSession) void svc.openSession(id)
  }
  /**
   * 打开一个「对话」：优先停在当前会话（若它属于这棵树 —— 分支里任意一条），
   * 否则打开**最后使用**的那条成员。
   *
   * 为什么是「最后使用」而不是 members[0]（code review 2026-10-11 抓到的 bug）：
   * members[0] 是 **id 字母序**的第一个 —— 往往是最老的那条（模型也是老的）。
   * 用户切到一个对话，期待的是「接着上次继续」：模型下拉要跟的是**这个对话最后一次用的模型**，
   * 也就是 updatedAt 最新的那条成员（切模型 / 编辑重发都会新开一条成员，updatedAt 最新 = 最后用的）。
   * memberIds 来自会话列表（带 updatedAt），排序一次即可。
   */
  function openAgentConversation(rootId: string, memberIds: string[]): void {
    const current = agentSvc()?.state.sessionId
    if (current && memberIds.includes(current)) {
      openAgentSession(current)
      return
    }
    const sessions = agentSvc()?.state.sessions ?? []
    const byTime = new Map(sessions.map((s) => [s.id, s.updatedAt]))
    const latest = [...memberIds]
      .sort((a, b) => (byTime.get(b) ?? 0) - (byTime.get(a) ?? 0))[0]
    openAgentSession(latest ?? rootId)
  }
  /** 删一个「对话」= 删整棵树（分支一起删；用户口径：一个对话就是一份历史） */
  function deleteAgentConversation(memberIds: string[]): void {
    const svc = readyHost?.ctx?.get<{ deleteSession?: (id: string) => Promise<void> }>('agent')
    if (!svc?.deleteSession) return
    for (const id of [...memberIds].reverse()) void svc.deleteSession(id)
  }
  async function renameAgentSession(id: string, current: string): Promise<void> {
    const feedback = readyHost.ctx?.get<FeedbackService>('feedback')
    if (!feedback) return
    const next = await feedback.prompt({
      title: '重命名对话',
      label: '对话名字',
      defaultValue: current,
      confirmText: '保存',
      validate: (value) => (value.trim() ? '' : '对话名字不能为空'),
    })
    if (!next || !next.trim()) return
    const svc = readyHost?.ctx?.get<{ renameSession?: (id: string, t: string) => Promise<void> }>('agent')
    if (svc?.renameSession) void svc.renameSession(id, next.trim())
  }
  function deleteAgentSession(id: string): void {
    const svc = readyHost?.ctx?.get<{ deleteSession?: (id: string) => Promise<void> }>('agent')
    if (svc?.deleteSession) void svc.deleteSession(id)
  }
  return {
    agent, setAgentOpen, toggleAgent, newAgentChat, toggleAgentHistory,
    openAgentSession, renameAgentSession, deleteAgentSession,
    openAgentConversation, deleteAgentConversation,
  }
}

export type AgentShellScope = ReturnType<typeof createAgentShellScope>

