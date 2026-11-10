/**
 * agentChatProvider —— 把 Agent 的单轮对话接进任务系统（内置 provider）。
 *
 * 用户口径 2026-11-09：底栏点发送 = 提交任务给后台；后台调模型、边生成边写节点，
 * 前端跟随画布 revision 更新 —— 不再是前端直连对话接口。
 *
 * ## 为什么是「submit 立即返回 taskId + poll 拍往返」
 *
 * 第一版把整段生成塞进 submit 里跑完再返回，结果节点一直停在 0%：
 * TaskManager 只在 poll 那一拍写进度帧，长跑型 submit 期间**一帧都不写**（用户实测）。
 * 所以改成标准的异步 provider：submit 起一个后台生成循环、立刻返回 taskId；
 * poll 每拍把「累计文本 + 进度 + 阶段文案」交回 TaskManager，由它统一写节点。
 * 这样卡片有真实进度、输入框也能边生成边长字。
 */
import type { ActionDef, JobInput, Provider, ProviderPollResult } from '../providers/types.js'

/** Agent 能力（server.ts 注入；Agent 关闭时整个 provider 不注册） */
export interface AgentChatDeps {
  config: {
    resolveModel(provider?: string, modelId?: string): Promise<{
      configured: boolean
      modelId?: string
      apiKey?: string
      baseUrl?: string
      clientType?: string
      contextWindow?: number
      provider?: string
    }>
  }
  loadSdk: () => Promise<unknown>
  onError?: (message: string, err?: unknown) => void
}

export const AGENT_CHAT_ACTION_ID = 'agent:chat'

/** SDK 的最小面（真实现是 @prismshadow/penguin-core；单测注入假的） */
interface SdkLike {
  GenerativeModel: new (cfg: Record<string, unknown>) => {
    streamGenerate(p: { newMessages: unknown[]; signal?: AbortSignal }): AsyncGenerator<
      unknown,
      { status: string; errorMessage?: string },
      void
    >
  }
  userText(t: string): unknown
  imageUrlMessage(u: string): unknown
}

/** 从一帧里拿增量文本（与 plugin-agent chatCompletion.deltaOfMessage 同一契约） */
function deltaOf(msg: unknown): string {
  const p = (msg as { payload?: { type?: string; event_type?: string; text?: unknown } })?.payload
  if (!p || p.type !== 'partial_text' || p.event_type !== 'delta') return ''
  return typeof p.text === 'string' ? p.text : ''
}

/** 收尾帧的完整正文（有就以它为准） */
function finalOf(msg: unknown): string | undefined {
  const p = (msg as { payload?: { type?: string; text?: unknown } })?.payload
  if (!p || p.type !== 'text') return undefined
  return typeof p.text === 'string' ? p.text : undefined
}

/** 提示词段 → 纯文本（tag 段的值是资源 id，文本素材已在 resources 里，这里只拼 prompt 段） */
function promptsText(prompts: JobInput['prompts']): string {
  return (prompts ?? []).map((p) => p.value).join('\n\n')
}

/** 文本素材直接拼进正文；图片素材转成图片消息（SDK 认 data URL / 同源地址） */
function resourcesOf(resources: JobInput['resources']): { texts: string[]; images: string[] } {
  const texts: string[] = []
  const images: string[] = []
  for (const r of resources ?? []) {
    if (r.kind === 'image' && typeof r.url === 'string' && r.url) images.push(r.url)
    else if (typeof r.value === 'string' && r.value) texts.push(r.value)
  }
  return { texts, images }
}

/** 一次生成在后台的状态（轮询读它） */
interface LiveRun {
  status: 'running' | 'done' | 'error'
  text: string
  progress: number
  message?: string
  error?: string
  /**
   * 已产出的量（用户 2026-11-10：加载态要看得到「现在输出了多少」）。
   * chars = 字数；tokens ≈ 中文 1 字 0.6 token、英文 4 字符 1 token 粗估。
   * 只用于显示，不参与业务判断，也不进历史。
   */
  stats?: { chars: number; tokens: number }
}

/**
 * 粗略估一下「已输出多少」（用户 2026-11-10：加载态要看得到产出量）。
 *
 * 上游流只吐文本、不报 token 数，所以按经验值折算：
 *   中日韩字符：1 字 ≈ 1.5 token
 *   其他字符：4 字符 ≈ 1 token
 * 只用于显示，不写历史、不参与计费。
 */
function estimateStats(text: string): { chars: number; tokens: number } {
  const all = [...text]
  let cjk = 0
  for (const ch of all) {
    const code = ch.codePointAt(0) ?? 0
    if ((code >= 0x3400 && code <= 0x9fff) || (code >= 0x3040 && code <= 0x30ff) || (code >= 0xac00 && code <= 0xd7af)) cjk += 1
  }
  const other = Math.max(0, all.length - cjk)
  return { chars: all.length, tokens: Math.round(cjk * 1.5 + other / 4) }
}

/** 动作声明（模型与渠道由前端下单时放进 values 透传） */
const ACTION: ActionDef = {
  id: AGENT_CHAT_ACTION_ID,
  title: 'Agent 对话',
  description: '文本节点直接问模型：任务化执行，边生成边写进节点',
  nodeTypes: ['text'],
  needsPrompt: true,
  /** 文本生成大多十几秒：1s 拍一次，进度与流式文本都快 */
  pollIntervalMs: 1_000,
  pollTimeoutMs: 300_000,
}

export function createAgentChatProvider(deps: AgentChatDeps): Provider {
  /** provider 自己的任务号 → 后台生成状态 */
  const runs = new Map<string, LiveRun>()
  return {
    id: 'agent-chat',
    actions: [ACTION],

    /** 起一次生成：立刻返回 taskId，真正跑在后台（poll 读状态） */
    async submit(_action, input) {
      const v = (input.values ?? {}) as Record<string, unknown>
      const modelId = typeof v.agentModel === 'string' ? v.agentModel : ''
      const providerId = typeof v.agentProvider === 'string' && v.agentProvider ? v.agentProvider : undefined
      let resolved
      try {
        resolved = await deps.config.resolveModel(providerId, modelId || undefined)
      } catch (err) {
        return { error: '解析模型失败：' + (err instanceof Error ? err.message : String(err)) }
      }
      if (!resolved.configured) {
        return { error: '模型未配好凭据（' + (resolved.provider ?? providerId ?? '?') + ' / ' + (resolved.modelId ?? modelId) + '）。去「设置 → Agent → 模型」里配好再试。' }
      }

      const taskId = nextTaskId()
      // 起手就报 5%：「提交成功、正在连接」，避免第一拍之前一直停在 0%。
      // 之后每拍按已生成字数往上推（文本模型没有真实百分比）。
      runs.set(taskId, { status: 'running', text: '', progress: 5, message: '正在连接模型…' })
      // 后台跑：不 await（submit 要立刻返回）；异常收进 states，poll 会报成 error
      void runGeneration(taskId, resolved, input).catch((err) => {
        // 兜底：runGeneration 自己会把失败写进 runs；这里只补「它整个抛了」的情况
        deps.onError?.('[agent-chat] 生成循环异常', err)
        const cur = runs.get(taskId)
        if (cur && cur.status === 'running') {
          cur.status = 'error'
          cur.error = err instanceof Error ? err.message : String(err)
        }
      })
      return { taskId }
    },

    /** 拍一次：累计文本 + 进度 + 阶段文案；done 时带上最终正文 */
    async poll(taskId) {
      const st = runs.get(taskId)
      if (!st) return { status: 'error', error: '任务在后台已不存在（可能服务重启过）' }
      if (st.status === 'done') {
        return { status: 'done', text: st.text } as ProviderPollResult
      }
      if (st.status === 'error') {
        return { status: 'error', error: st.error ?? '对话失败' } as ProviderPollResult
      }
      return {
        status: 'running',
        progress: st.progress,
        ...(st.message ? { message: st.message } : {}),
        /** 流式预览：TaskManager 把它写进 node.data.text（整段覆盖） */
        ...(st.text ? { partialText: st.text } : {}),
        /** 已产出量 → 节点 runState.stats（加载层显示「已输出 N 字 / ≈M tokens」） */
        ...(st.stats ? { stats: st.stats } : {}),
      } as ProviderPollResult
    },

    /** 取消：标记收敛即可（生成循环下一帧发现自己被弃用就停） */
    async cancel(taskId) {
      const st = runs.get(taskId)
      if (st) st.status = 'error'
      runs.delete(taskId)
    },
  }

  /** 驱动 SDK 流，把「累计正文 / 进度 / 阶段」写进 runs[taskId] */
  async function runGeneration(
    taskId: string,
    resolved: Awaited<ReturnType<AgentChatDeps['config']['resolveModel']>>,
    input: JobInput,
  ): Promise<void> {
    const user = promptsText(input.prompts)
    const { texts, images } = resourcesOf(input.resources)
    const fullPrompt = [user, ...texts].filter(Boolean).join('\n\n')

    const sdk = (await deps.loadSdk()) as SdkLike
    const llm = new sdk.GenerativeModel({
      modelId: resolved.modelId ?? ACTION.id,
      ...(resolved.apiKey ? { apiKey: resolved.apiKey } : {}),
      ...(resolved.baseUrl ? { baseUrl: resolved.baseUrl } : {}),
      // 协议一定要带上：别名模型（如 deepseek-auto）SDK 猜不出协议会直接抛
      ...(resolved.clientType ? { clientType: resolved.clientType } : {}),
      ...(resolved.contextWindow ? { contextWindow: resolved.contextWindow } : {}),
      tools: [],
      thinkingLevel: 'none',
      requestTimeoutMs: 300_000,
    })
    const messages: unknown[] = []
    if (fullPrompt !== '') messages.push(sdk.userText(fullPrompt))
    for (const img of images) messages.push(sdk.imageUrlMessage(img))
    if (messages.length === 0) messages.push(sdk.userText(''))

    const gen = llm.streamGenerate({ newMessages: messages })
    let acc = ''
    const startedAt = Date.now()

    /**
     * 等首包期间也要让界面动起来（用户 2026-11-10：不能从 5% 一步跳到完成）。
     * 模型第一段文字常常要 1~3 秒，这段时间进度按时间慢慢爬，
     * 否则卡片像卡死；一旦开始吐字就改用「按时间 + 已生成」的规则。
     */
    const waitingTimer = setInterval(() => {
      const st = runs.get(taskId)
      if (!st || st.status !== 'running') return
      if (st.text !== '') return // 已经开始吐字，交给下面的逻辑
      const elapsed = Date.now() - startedAt
      st.progress = Math.min(30, 5 + Math.floor(elapsed / 300))
      st.message = '等待模型响应…'
    }, 300)
    let status = 'completed'
    let errorMessage: string | undefined
    try {
    for (;;) {
      const step = await gen.next()
      const st = runs.get(taskId)
      if (!st || st.status === 'error') return // 被取消了：不再写（finally 会清定时器）
      if (step.done) {
        status = step.value?.status ?? 'completed'
        errorMessage = step.value?.errorMessage
        break
      }
      const d = deltaOf(step.value)
      if (d) {
        acc += d
        st.text = acc
        st.message = '生成中…'
        st.stats = estimateStats(acc)
        // 文本模型没有真实百分比（上游只吐字，不报进度）。这里用**时间**推：
        //   · 0~3s 慢慢从 5 → 30（先让卡片看起来"动起来"）
        //   · 之后每秒再 +2，封顶 95（剩下的留给终态）
        // 纯按字数算会很难看：中文一句话才二三十字，长回复能卡在 10% 好几分钟（实测）。
        const elapsed = Date.now() - startedAt
        const byTime = elapsed < 3000 ? 5 + Math.floor((elapsed / 3000) * 25) : 30 + Math.floor((elapsed - 3000) / 1000) * 2
        st.progress = Math.min(95, Math.max(st.progress, byTime))
      }
      const fin = finalOf(step.value)
      if (fin !== undefined) {
        acc = fin
        st.text = acc
      }
    }
    } finally {
      // 生成循环无论怎么退出（成功 / 失败 / 被取消）都清掉「等首包」定时器
      clearInterval(waitingTimer)
    }
    const st = runs.get(taskId)
    if (!st || st.status === 'error') return
    if (status !== 'completed') {
      st.status = 'error'
      st.error = errorMessage || '对话失败'
      return
    }
    st.status = 'done'
    st.text = acc
    st.progress = 100
    st.message = '已完成'
  }
}

/** provider 内部任务号（单进程够用；只用来做 Map 键） */
let seq = 0
function nextTaskId(): string {
  seq += 1
  return 'agentchat-' + Date.now().toString(36) + '-' + seq.toString(36)
}
