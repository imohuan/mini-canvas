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

/** 上游素材 → 参考图原始值（只认给了 url 的图片 / 视频） */
function referenceUrls(input: JobInput): string[] {
  return (input.resources ?? [])
    .filter((r) => (r.kind === 'image' || r.kind === 'video') && typeof r.url === 'string' && r.url)
    .map((r) => r.url as string)
}

/**
 * 把参考图值交给 web2api，拿到它**存的相对地址**。
 *
 * 关键（跨服务器）：cloud-server 与 web2api 是两个独立服务，可能不在同一台机器；
 * 一个 cloud-server 的地址（尤其 127.0.0.1）web2api 可能根本下载不到。
 * 所以**先把字节上传到 web2api**（MCP `system/upload-resource`），拿它给的 `referenceUrl`
 * （`/<hash>.png`）去下单 —— 这正是用户要求的口径：先上传拿地址，再用地址生成。
 *
 * 已是 web2api 能直接当文件的地址（上传后的 `/<hash>`、或它的 `/api/resources/uploads/`）→ 原样用；
 * 其它（data URL / 外部 URL / 坏地址）→ 上传成 web2api 本机文件；上传失败则**回退原值**
 * （web2api 的 resolveReferenceImage 还认 data URL / 外部 URL，能兜住）。
 */
async function referenceUrlsFor(
  client: Web2ApiClient,
  input: JobInput,
  fetchImpl?: typeof fetch,
): Promise<string[]> {
  const out: string[] = []
  for (const raw of referenceUrls(input)) {
    if (raw.startsWith('/api/resources/uploads/') || (/^\/[^/]/.test(raw) && !raw.startsWith('/api/'))) {
      // 已经是 web2api 的资源地址 / 相对文件名（/<hash>.png）—— 就在它本机，直接用
      out.push(raw)
      continue
    }
    // 其余（data URL / cloud-server 地址 / 外部 URL）：**先上传成 web2api 的本机文件**，
    // 用上传返回的 referenceUrl 下单 —— 这正是用户口径「先上传拿地址，再用地址生成」。
    // web2api 的 system/upload-resource 同时接受 base64 与 data URL。
    try {
      const up = await uploadReference(client, raw, fetchImpl)
      out.push(up ?? raw)
    } catch {
      out.push(raw)
    }
  }
  return out
}

/** 上传一张参考图到 web2api，返回它给的相对地址（失败返回 undefined） */
async function uploadReference(
  client: Web2ApiClient,
  url: string,
  fetchImpl?: typeof fetch,
): Promise<string | undefined> {
  let content: string | undefined
  let mime = ''
  if (rawDataUrl(url)) {
    // data URL：直接把原串交给上传接口（它同时接受 base64 与 data URL）
    content = url
  } else {
    // 远程/本地地址：先取字节，再以 base64 上传
    try {
      const doFetch = fetchImpl ?? (fetch as typeof fetch)
      const res = await doFetch(url)
      if (res.ok) {
        const buf = new Uint8Array(await res.arrayBuffer())
        if (buf.byteLength > 0) {
          content = Buffer.from(buf).toString('base64')
          mime = res.headers.get('content-type') ?? ''
        }
      }
    } catch {
      return undefined
    }
  }
  if (!content) return undefined
  const r = await client.callTool('system/upload-resource', {
    content,
    ...(mime ? { mimeType: mime.split(';')[0] } : {}),
  })
  if (r.isError) return undefined
  const sc = r.structuredContent as { referenceUrl?: unknown; url?: unknown } | undefined
  const refUrl = typeof sc?.referenceUrl === 'string' ? sc.referenceUrl : undefined
  return refUrl ?? (typeof sc?.url === 'string' ? sc.url : undefined)
}

/** 是不是 data URL（`data:<mime>[,;base64],<payload>`） */
function rawDataUrl(v: string): boolean {
  return /^data:/i.test(v)
}

/** 上游文本素材 → 追加进 prompt 的一段（服务端没有"文本附件"入参位，文本本来就该进提示词） */
function upstreamText(input: JobInput): string {
  return (input.resources ?? [])
    .filter((r) => r.kind === 'text' && typeof r.value === 'string' && r.value.trim() !== '')
    .map((r) => r.value as string)
    .join(String.fromCharCode(10))
}

/** 组一次工具调用的参数（导出以便单测直接核对参数名） */
export async function buildToolArgs(
  action: ActionDef,
  input: JobInput,
  client?: Web2ApiClient,
  fetchImpl?: typeof fetch,
): Promise<Record<string, unknown>> {
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
    const refs = client ? await referenceUrlsFor(client, input, fetchImpl) : referenceUrls(input)
    if (refs.length > 0) args.referenceImages = refs
    return args
  }

  // plain：参数直传（文本参数名随平台而异）
  const args: Record<string, unknown> = { ...cleanValues(values) }
  if (model !== undefined && model !== '') args.model = model
  args[textKeyOf(tool)] = basePrompt
  const refs = client ? await referenceUrlsFor(client, input, fetchImpl) : referenceUrls(input)
  if (refs.length > 0) args.referenceImages = refs
  return args
}

/**
 * web2api 的任务状态 → server 只认三种：running（还没完）/ done（成功）/ error（真失败）。
 *
 * **关键（真出过的 bug）**：web2api 的状态机里有一批**非终态**的中间状态，
 * 它们都表示「任务还在自己往前走，别撒手」：
 *   - `paused`        触发验证码 / 风控 → 保留现场**等用户处理**，处理完 captcha-watcher 会自动恢复；
 *   - `retrying`      失败了正在退避等待，到点回 pending 重新排队；
 *   - `polling_failed`轮询中断，可手动恢复继续轮询；
 *   - `pending`       换号 / 重试后重新排队（accountSwitchCount 会涨）。
 * 早先这里把 `paused` / `interrupted` 直接当失败返回 —— 于是用户在浏览器里过验证码时，
 * cloud-server 这边已经判失败收工了（实测：18:54:42 暂停 → 立刻判失败，18:56:35 真成功）。
 *
 * 只有这三个是**真终态**（不再继续、不换号、不再处理）：completed / failed / cancelled。
 */
function toPollResult(
  detail: Awaited<ReturnType<Web2ApiClient['getTask']>>,
  taskId: string,
  origin: string,
): ProviderPollResult {
  const status = detail.status
  // 真终态之一：失败（web2api 已在它那边判死 —— 不可重试错误或重试/换号额度耗尽）
  if (status === 'failed') return { status: 'error', error: detail.message || '任务执行失败', taskId }
  if (status === 'cancelled') return { status: 'error', error: detail.message || '任务已取消', taskId }
  if (status === 'completed' || status === 'done' || status === 'success') {
    // 产物地址要**绝对化**到 web2api origin：tasks 详情里给的是 /api/resources/... 这种相对路径，
    // 不补 origin 的话浏览器会拿 cloud-server 的域名去取，图/音/视频全 404。
    const urls = extractUrls(detail).map((u) => absolutizeUrl(u, origin))
    if (urls.length === 0) return { status: 'error', error: '任务完成但没有产出资源', taskId }
    return { status: 'done', urls, taskId }
  }
  // 中间态（paused 等验证码 / retrying 退避 / polling_failed / pending 换号后重排）：
  // **继续轮询**，不要判失败 —— 任务还在自己往前走，由 web2api 的 captcha-watcher / 重试链推进。
  //
  // 其中两类要标 `waiting`（等外部条件，不占超时预算）：
  //   - paused：等用户在浏览器里过验证码，处理多久不由程序决定；
  //   - retrying/pending（换号后重排）：web2api 自己的退避 + 换号重试，也该给它留时间。
  const waiting = status === 'paused' || status === 'retrying' || status === 'pending'
  return {
    status: 'running',
    message: detail.message || '生成中…',
    progress: typeof detail.progress === 'number' ? detail.progress : undefined,
    taskId,
    ...(waiting ? { waiting: true } : {}),
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
        const result = await client.callTool(tool, await buildToolArgs(action, input, client, opts.fetchImpl))
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
