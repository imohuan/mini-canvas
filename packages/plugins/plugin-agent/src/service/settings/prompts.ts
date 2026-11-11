import type { AgentServiceContext, AgentServiceDeps } from '../context.js'
import type { PromptPreset } from '../types.js'

/** 模式提示词 + 系统提示词 + 会话标题模型（都住在后台 KV） */
export function createPromptDomain(ctx: AgentServiceContext, deps: AgentServiceDeps) {
  const { state, api } = ctx
  const { setError } = ctx

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
    await deps.newSession()
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
    await deps.ensurePromptFresh()
  }

  async function saveSystemPrompt(text: string): Promise<void> {
    const r = await api.saveSystemPrompt(text)
    state.systemPrompt = typeof r.text === 'string' ? r.text : text
  }

  /** 写系统提示词模板；保存后立刻用后台的体检结果刷新提示（缺 {{CWD}} 之类要看得见） */
  async function saveTemplate(text: string): Promise<void> {
    const r = await api.saveTemplate(text)
    const tpl = r.template
    state.templateHealth = {
      ok: tpl?.ok !== false,
      missing: Array.isArray(tpl?.missing) ? tpl.missing.map(String) : [],
    }
    if (typeof tpl?.template === 'string') state.templateText = tpl.template
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
      await deps.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
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

  return {
    activePromptText,
    ensurePromptFresh,
    loadPrompts,
    savePrompts,
    setActivePrompt,
    loadTitleModel,
    saveTitleModel,
    saveSystemPrompt,
    saveTemplate,
    restoreTemplate,
  }
}





