/**
 * agentService —— 会话状态 + 全部动作（这就是「组件的 API」）。
 *
 * 为什么方法放在服务上而不是组件上：
 * 1. 组件没挂载时也要能调（键盘快捷键 / 底栏按钮要让 Agent「新建对话」，那时面板可能没渲染）；
 * 2. 同一块内容摆两处（左抽屉 + 右悬浮）会变成两份状态 —— 挂在服务上就只有一份。
 *
 * 任何布局都能这样拿它：`useAgent()`（渲染子树内）或 `ctx.get('agent')`（插件里）。
 *
 * 实现按域拆在同目录的子目录里（session / queue / settings）：本文件只创建共享状态，
 * 再把各域的原方法组装回同一个对象。
 */
import { computed, reactive } from 'vue'
import { AgentApi } from '../api/agentApi.js'
import { ChatModel } from '../model/sessionModel.js'
import type { AgentServiceContext, AgentServiceDeps } from './context.js'
import { CANVAS_ID } from './context.js'
import { createSessionDomain } from './session/sessions.js'
import { createSendDomain } from './session/send.js'
import { createQueueDomain } from './queue/queue.js'
import { createGoalDomain } from './queue/goals.js'
import { createPromptDomain } from './settings/prompts.js'
import { createSkillDomain } from './settings/skills.js'
import { createMcpDomain } from './settings/mcp.js'
import { createModelDomain } from './settings/models.js'
import { createPolicyDomain } from './settings/policy.js'
import { createRefsDomain } from './refs.js'
import type {
  AgentService,
  AgentServiceState,
  ApprovalPolicyView,
  McpRow,
  McpProbeResult,
  ModelRow,
  PromptPreset,
  ProviderRow,
  SkillRow,
  ApprovalRuleRow,
} from './types.js'

export type {
  AgentService,
  AgentServiceState,
  ApprovalPolicyView,
  McpRow,
  McpProbeResult,
  ModelRow,
  PromptPreset,
  ProviderRow,
  SkillRow,
  ApprovalRuleRow,
}
export { CANVAS_ID }

/** 造一份服务（agentPlugin 在 apply 里调用一次） */
export function createAgentService(opts: { baseUrl?: string } = {}): AgentService {
  const api = new AgentApi({ baseUrl: opts.baseUrl ?? '' })
  const model = new ChatModel()
  const abortRef = { value: null as AbortController | null }
  /** 帧级水位：send / 常驻流 / 压缩共用 */
  const seqRef = { value: 0 }

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

  function currentSessionId(): string | null {
    return state.sessionId
  }

  const ctx: AgentServiceContext = {
    state,
    api,
    model,
    abortRef,
    seqRef,
    canvasId,
    currentSessionId,
    sync,
    setError,
  }
  const deps: AgentServiceDeps = {
    applyEvent: () => undefined,
    acceptSeq: () => false,
    attachStream: () => undefined,
    detachStream: () => undefined,
    refresh: async () => undefined,
    restoreCurrentSession: async () => undefined,
    listSessions: async () => undefined,
    refreshPagers: async () => undefined,
    newSession: async () => undefined,
    openSession: async () => undefined,
    ensureSession: async () => null,
    sendOptions: () => ({}),
    send: async () => undefined,
    cancelEdit: () => undefined,
    activePromptText: () => '',
    ensurePromptFresh: async () => undefined,
    setActivePrompt: async () => undefined,
    loadPrompts: async () => undefined,
    cancelAllEdits: async () => undefined,
    retireSendingItemOnUserMessage: () => undefined,
  }

  const sessions = createSessionDomain(ctx, deps)
  const sendDomain = createSendDomain(ctx, deps)
  const queue = createQueueDomain(ctx, deps)
  const goals = createGoalDomain(ctx, deps)
  const prompts = createPromptDomain(ctx, deps)
  const skills = createSkillDomain(ctx, deps)
  const mcp = createMcpDomain(ctx, deps)
  const models = createModelDomain(ctx, deps)
  const policy = createPolicyDomain(ctx, deps)
  const refs = createRefsDomain(ctx, deps)

  Object.assign(deps, {
    applyEvent: sessions.applyEvent,
    acceptSeq: sessions.acceptSeq,
    attachStream: sessions.attachStream,
    detachStream: sessions.detachStream,
    refresh: sessions.refresh,
    restoreCurrentSession: sessions.restoreCurrentSession,
    listSessions: sessions.listSessions,
    refreshPagers: sessions.refreshPagers,
    newSession: sessions.newSession,
    openSession: sessions.openSession,
    ensureSession: sendDomain.ensureSession,
    sendOptions: sendDomain.sendOptions,
    send: sendDomain.send,
    cancelEdit: refs.cancelEdit,
    activePromptText: prompts.activePromptText,
    ensurePromptFresh: prompts.ensurePromptFresh,
    setActivePrompt: prompts.setActivePrompt,
    loadPrompts: prompts.loadPrompts,
    cancelAllEdits: queue.cancelAllEdits,
    retireSendingItemOnUserMessage: queue.retireSendingItemOnUserMessage,
  })

  return {
    state,
    turns: computed(() => state.turns),
    // ---------------------------------------------------------------- 队列（设计 §3.3）
    sendToQueue: queue.sendToQueue,
    steerQueueItem: queue.steerQueueItem,
    removeQueueItem: queue.removeQueueItem,
    reorderQueue: queue.reorderQueue,
    loadEarlierTurns: queue.loadEarlierTurns,
    closeQueueItem: queue.closeQueueItem,
    beginEditQueueItem: queue.beginEditQueueItem,
    cancelEditQueueItem: queue.cancelEditQueueItem,
    cancelAllEdits: queue.cancelAllEdits,
    saveEditedQueueItem: queue.saveEditedQueueItem,
    pauseQueue: queue.pauseQueue,
    resumeQueue: queue.resumeQueue,
    // ---------------------------------------------------------------- 目标（设计 §3.4）
    setGoalMark: goals.setGoalMark,
    clearGoalMark: goals.clearGoalMark,
    updateGoal: goals.updateGoal,
    pauseGoal: goals.pauseGoal,
    resumeGoal: goals.resumeGoal,
    endGoal: goals.endGoal,
    sendGoal: goals.sendGoal,
    setGoalImages: goals.setGoalImages,
    toggle: () => {
      state.open = !state.open
      if (state.open) void sessions.refresh()
    },
    show: () => {
      state.open = true
      void sessions.refresh()
    },
    hide: () => {
      state.open = false
    },
    refresh: sessions.refresh,
    /** 接上这条会话的常驻事件流（组件挂载 / 面板打开时调） */
    attachStream: sessions.attachStream,
    /** 断开事件流订阅（组件卸载时调；不停后台那一轮） */
    detachStream: sessions.detachStream,
    newSession: sessions.newSession,
    listSessions: sessions.listSessions,
    openSession: sessions.openSession,
    renameSession: sessions.renameSession,
    deleteSession: sessions.deleteSession,
    send: sendDomain.send,
    stop: sendDomain.stop,
    retry: sendDomain.retry,
    setModel: sendDomain.setModel,
    compact: sendDomain.compact,
    decide: policy.decide,
    savePolicy: policy.savePolicy,
    importSkill: skills.importSkill,
    loadSkillCandidates: skills.loadSkillCandidates,
    loadUpstreamModels: skills.loadUpstreamModels,
    saveSystemPrompt: prompts.saveSystemPrompt,
    restoreTemplate: prompts.restoreTemplate,
    removeSkill: skills.removeSkill,
    addMcp: mcp.addMcp,
    removeMcp: mcp.removeMcp,
    probeMcp: mcp.probeMcp,
    reconnectMcp: mcp.reconnectMcp,
    saveModel: models.saveModel,
    saveModelsBulk: models.saveModelsBulk,
    deleteModel: models.deleteModel,
    setDefaultModel: models.setDefaultModel,
    loadPrompts: prompts.loadPrompts,
    savePrompts: prompts.savePrompts,
    setActivePrompt: prompts.setActivePrompt,
    loadTitleModel: prompts.loadTitleModel,
    saveTitleModel: prompts.saveTitleModel,
    activePromptText: prompts.activePromptText,
    setCanvasId: refs.setCanvasId,
    requestNodeRefs: refs.requestNodeRefs,
    clearNodeRefs: refs.clearNodeRefs,
    referenceAsset: refs.referenceAsset,
    clearPendingResource: refs.clearPendingResource,
    referenceAssets: refs.referenceAssets,
    clearPendingResources: refs.clearPendingResources,
    beginEdit: refs.beginEdit,
    cancelEdit: refs.cancelEdit,
  }
}
