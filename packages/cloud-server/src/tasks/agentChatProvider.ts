/** agentChatProvider —— 把 Agent 的单轮对话接进任务系统（内置 provider）。
 *
 * 用户口径 2026-11-09：底栏点发送 = 提交任务给后台；后台调模型、边生成边写节点，
 * 前端跟随画布 revision 更新 —— 不再是前端直连对话接口。
 *
 * 动作 id 固定 agent:chat（前端提交任务时用它）。submit 是长跑的：内部自己驱动
 * SDK 流，把每拍累计文本经 deps.onPartialText 写进节点，全部生成完才返回。
 * 因此不需要 poll —— 取消靠 AbortSignal（createJob 已接），进度靠 onPartialText。
 */
import type { ActionDef, JobInput, Provider } from '../providers/types.js'

/** 每拍部分文本的落点（TaskManager 的 writeRunState extra） */
export type PartialTextSink = (canvasId: string, nodeId: string, text: string) => Promise<void>

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
  /** 把部分文本写进节点正文（data.text，与前端输入框绑定同一字段） */
  onPartialText: PartialTextSink
  onError?: (message: string, err?: unknown) => void
}

export const AGENT_CHAT_ACTION_ID = 'agent:chat'

/** SDK 的最小面（真实现是 @prismshadow/penguin-core；单测注入假的） */
interface SdkLike {
  GenerativeModel: new (cfg: Record<string, unknown>) => {
    streamGenerate(p: {
      newMessages: unknown[]
      signal?: AbortSignal
    }): AsyncGenerator<unknown, { status: string; errorMessage?: string }, void>
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

/** 动作声明：模型与渠道由前端下单时透传（provider 作者字段的惯用法） */
const ACTION: ActionDef = {
  id: AGENT_CHAT_ACTION_ID,
  title: 'Agent 对话',
  description: '文本节点直接问模型：任务化执行，边生成边写进节点',
  nodeTypes: ['text'],
  needsPrompt: true,
  pollTimeoutMs: 300_000,
}

export function createAgentChatProvider(deps: AgentChatDeps): Provider {
  return {
    id: 'agent-chat',
    actions: [ACTION],
    /**
     * @param signal 取消信号（TaskManager.createJob 接的 AbortController；
     *   用户在节点上点「取消」→ 后台 abort → SDK 流停止 → submit 返回失败终态）。
     */
    async submit(_action, input, signal) {
      // 前端下单时把选中模型放进 values（JobInput 的五个字段里最合适透传自定义数据的一个）：
      // agentModel = 模型 id、agentProvider = 渠道 id。没给则落到项目默认模型
      // （与 Agent 会话同一条解析规则）。
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

      const user = promptsText(input.prompts)
      const { texts, images } = resourcesOf(input.resources)
      const fullPrompt = [user, ...texts].filter(Boolean).join('\n\n')

      const sdk = (await deps.loadSdk()) as SdkLike
      const llm = new sdk.GenerativeModel({
        modelId: resolved.modelId ?? modelId,
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

      let acc = ''
      const gen = llm.streamGenerate({ newMessages: messages, ...(signal ? { signal } : {}) })
      for (;;) {
        const step = await gen.next()
        if (step.done) {
          if (step.value?.status !== 'completed') {
            return { error: step.value?.errorMessage || '对话失败' }
          }
          break
        }
        const d = deltaOf(step.value)
        if (d) {
          acc += d
          // 每拍整段覆盖式写入：batchNodes 内部有串行锁，revision 变更经 SSE 推给前端，
          // 输入框与节点正文跟着长字。写失败不挡生成（节点可能已被删）。
          try {
            await deps.onPartialText(input.canvasId, input.nodeId, acc)
          } catch (err) {
            deps.onError?.('[agent-chat] 写流式文本失败（节点可能已被删）', err)
          }
        }
        const fin = finalOf(step.value)
        if (fin !== undefined) acc = fin
      }
      return { done: true, text: acc }
    },
  }
}
