/**
 * 内置 web2api provider —— 用**和外挂 provider 完全一样**的接口实现。
 *
 * 为什么要这么做：内置与外挂走同一条路，就不会出现「内置一套、外挂另一套」。
 * 你想自己加一个平台时，照抄这个文件的结构就行。
 *
 * 三件事：把动作表交出去；提交时按 `promptMode` 拼参数、调 MCP 工具；有 taskId 就查进度。
 */
import type { ActionDef, JobInput, Provider, ProviderPollResult, ProviderSubmitResult } from '../types.js'
import { Web2ApiClient, absolutizeUrl, extractUrls, parseTaskId } from './client.js'
import { buildChatAutoPrompt } from './chatAutoPrompt.js'
import { WEB2API_ACTIONS } from './presets.js'

export { WEB2API_ACTIONS } from './presets.js'

/** 文本类工具的参数名（音频收 text，图像 / 视频收 prompt） */
function textKeyOf(tool: string): 'prompt' | 'text' {
  return tool === 'doubao/tts' || tool === 'volcengine/generate-audio' ? 'text' : 'prompt'
}

/** 只留有值的参数（空串 / undefined 不发，免得覆盖服务端默认） */
function cleanValues(values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined || v === null || v === '') continue
    out[k] = v
  }
  return out
}

/** 上游素材 → web2api 能认的参考图数组（只认给了 url 的图片 / 视频） */
function referenceUrls(input: JobInput): string[] {
  return (input.resources ?? [])
    .filter((r) => (r.kind === 'image' || r.kind === 'video') && typeof r.url === 'string' && r.url)
    .map((r) => r.url as string)
}

/** 上游文本素材 → 追加进 prompt 的一段（服务端没有"文本附件"入参位，文本本来就该进提示词） */
function upstreamText(input: JobInput): string {
  return (input.resources ?? [])
    .filter((r) => r.kind === 'text' && typeof r.value === 'string' && r.value.trim() !== '')
    .map((r) => r.value as string)
    .join(String.fromCharCode(10))
}

/** 组一次工具调用的参数（导出以便单测直接核对参数名） */
export function buildToolArgs(action: ActionDef, input: JobInput): Record<string, unknown> {
  const tool = action.tool ?? ''
  const values = (input.values ?? {}) as Record<string, unknown>
  const basePrompt = [input.prompt ?? '', upstreamText(input)].filter((s) => s.trim() !== '').join(String.fromCharCode(10))
  // 模型来自**动作本身**（前端第一个下拉选的就是它），不从 values 里取
  const model = action.model ?? values.model

  if (action.promptMode === 'chat-auto') {
    const args: Record<string, unknown> = {
      prompt: buildChatAutoPrompt(
        {
          mode: action.mediaMode ?? (action.nodeTypes?.includes('video') ? 'video' : 'image'),
          model,
          ratio: values.ratio,
          durationSec: values.durationSec,
          style: values.style,
        },
        basePrompt,
      ),
    }
    const refs = referenceUrls(input)
    if (refs.length > 0) args.referenceImages = refs
    return args
  }

  // plain：参数直传（文本参数名随平台而异）
  const args: Record<string, unknown> = { ...cleanValues(values) }
  if (model !== undefined && model !== '') args.model = model
  args[textKeyOf(tool)] = basePrompt
  const refs = referenceUrls(input)
  if (refs.length > 0) args.referenceImages = refs
  return args
}

/** 一次任务查询 → 统一的轮询结果 */
function toPollResult(
  detail: Awaited<ReturnType<Web2ApiClient['getTask']>>,
  taskId: string,
  origin: string,
): ProviderPollResult {
  const status = detail.status
  if (status === 'paused' || status === 'interrupted') {
    return { status: 'error', error: (detail.message || '任务被暂停') + '（可在 web2api 里恢复或重试）', taskId }
  }
  if (status === 'failed') return { status: 'error', error: detail.message || '任务执行失败', taskId }
  if (status === 'cancelled') return { status: 'error', error: detail.message || '任务已取消', taskId }
  if (status === 'completed' || status === 'done' || status === 'success') {
    // 产物地址要**绝对化**到 web2api origin：tasks 详情里给的是 /api/resources/... 这种相对路径，
    // 不补 origin 的话浏览器会拿 cloud-server 的域名去取，图/音/视频全 404。
    const urls = extractUrls(detail).map((u) => absolutizeUrl(u, origin))
    if (urls.length === 0) return { status: 'error', error: '任务完成但没有产出资源', taskId }
    return { status: 'done', urls, taskId }
  }
  return {
    status: 'running',
    message: detail.message || '生成中…',
    progress: typeof detail.progress === 'number' ? detail.progress : undefined,
    taskId,
  }
}

export interface Web2ApiProviderOptions {
  /** MCP 端点；不给就用默认本机 8033 */
  endpoint?: string
  fetchImpl?: typeof fetch
}

/**
 * 建一个 web2api provider。
 *
 * 每次提交现取 endpoint（设置改了立刻生效）—— 所以 client 按地址缓存，
 * 换了地址就用新的那个。
 */
export function createWeb2ApiProvider(opts: Web2ApiProviderOptions = {}): Provider {
  const clients = new Map<string, Web2ApiClient>()
  const endpointOf = (): string => opts.endpoint ?? process.env.WEB2API_ENDPOINT ?? 'http://localhost:8033/mcp'
  const clientFor = (endpoint: string): Web2ApiClient => {
    let c = clients.get(endpoint)
    if (!c) {
      c = new Web2ApiClient({
        endpoint,
        ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
      })
      clients.set(endpoint, c)
    }
    return c
  }

  return {
    id: 'web2api',
    actions: WEB2API_ACTIONS,

    async submit(action, input): Promise<ProviderSubmitResult> {
      const tool = action.tool
      if (!tool) return { error: '动作 ' + action.id + ' 没声明 tool' }
      try {
        const endpoint = endpointOf()
        const client = clientFor(endpoint)
        const origin = new URL(endpoint).origin
        const result = await client.callTool(tool, buildToolArgs(action, input))
        if (result.isError) {
          const text = (result.content ?? []).map((c) => c.text ?? '').join(' ').trim()
          return { error: text || 'web2api 调用失败' }
        }
        const taskId = parseTaskId(result)
        if (taskId) return { taskId }
        // 没有 taskId：可能是同步完成的（tts 这类）。产物地址可能在 content[].resource.uri，
        // 也可能在 structuredContent 里 —— 两处都扫，且**入参可能是 undefined**（同步工具没有
        // structuredContent，直接把它喂给 extractUrls 会抛「reading 'urls'」——这正是用户实测的坑）。
        // 这两种形态的产物地址都要绝对化，否则前端加载不到。
        const urls = [
          ...extractUrls(result.structuredContent as never),
          ...extractUrls(result),
        ].map((u) => absolutizeUrl(u, origin))
        if (urls.length > 0) return { done: true, urls }
        // 给不出 taskId 也给不出产物 —— 明确报错，别让任务永远挂着
        return { error: tool + ' 未返回可识别的 taskId（响应格式可能与预期不符）' }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    },

    async poll(taskId): Promise<ProviderPollResult> {
      try {
        const endpoint = endpointOf()
        return toPollResult(await clientFor(endpoint).getTask(taskId), taskId, new URL(endpoint).origin)
      } catch (err) {
        // 查不到不是终态：报给用户但继续（服务重启后任务可能真没了 —— 由后台的超时兜底）
        return { status: 'running', message: err instanceof Error ? err.message : '任务查询失败', taskId }
      }
    },

    async cancel(taskId): Promise<void> {
      await clientFor(endpointOf()).cancelTask(taskId)
    },
  }
}
