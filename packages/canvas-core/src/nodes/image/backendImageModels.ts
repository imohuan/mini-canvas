/**
 * 后台 ImageModel Provider —— 让前端图片工具栏用后台提供的模型配置并走后端生成。
 *
 * 对 `imageModels.ts` 的切换缝：
 *   - 数据面：实现 ImageModelProvider，模型下拉 / 比例 / 分辨率 / 可接受输入 从后台
 *     `GET /api/models`（ModelRegistry，同 MCP models.list 源）拉取，不再用本地写死表。
 *   - 执行面：run(payload, ctx) 把一次「发送」提交给后台 `POST /api/tasks`
 *     （targetNodeId = ctx.nodeId 即当前图片节点，canvasId = 页面注入的当前画布）。
 *     后台真生成并在目标节点写 data.runState、经 SSE 广播进度；run 返回 PollFn 轮询后台任务，
 *     把进度/结果映射回 ImageNode 的 executeRun 状态机。
 *
 * 接线（页面/插件在连接后台并选定画布后）：
 *   import { BackendImageModelProvider } from '.../backendImageModels'
 *   const backend = new BackendImageModelProvider('http://localhost:8765')
 *   backend.setCanvasId(canvasId)   // 跟随当前画布切换
 *   configureImageModels(backend)   // 切到后台；不注入/离线回落本地 mock
 */
import { configureImageModels } from './imageModels'
import type {
  GenerationPayload,
  GenerationResource,
  ImageModelCapability,
  ImageModelProvider,
  PollFn,
  PollState,
  RunOutcome,
} from './imageModels'

/** 后台 REST /api/models 返回的模型能力（与 ModelRegistry 对齐） */
interface BackendModel {
  model: string
  label?: string
  kind?: string
  ratio?: string[]
  resolution?: string[]
  supportsInput?: string[]
  templates?: string[]
  description?: string
  mcpTool?: string
  mcpModel?: string
}

/** 后台任务轮询返回（/api/tasks/:taskId → { task }） */
interface BackendTask {
  id?: string
  status: 'pending' | 'processing' | 'done' | 'error'
  progress?: number
  message?: string
  result?: { ok?: boolean; urls?: string[]; error?: string; taskId?: string }
  error?: string
}

/** 前端模板沿用本地（模板是提示词预设，非「模型能力配置」；后台不含模板） */
const TEMPLATES: { id: string; name: string; prompt: string; forModels?: string[] }[] = [
  { id: 'clear', name: '通用·高清写实', prompt: '高清写实风格，主体突出，细节丰富，自然光照' },
  { id: 'blank', name: '留白极简', prompt: '极简留白构图，大面积纯色背景，主体居中' },
  { id: 'poster', name: '海报感', prompt: '电影海报构图，戏剧化光影，居中主体，两侧留白放文字' },
]

export class BackendImageModelProvider implements ImageModelProvider {
  private baseUrl: string
  /** 当前后台画布 id（页面连接/切画布时注入；run 提交任务需要） */
  private canvasId: string | null = null
  /** 后台模型能力快照 */
  private models: ImageModelCapability[] = []
  private loading = false
  /** 发送时轮询后台任务的间隔 ms */
  pollInterval = 1200

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
  }

  /** 跟随当前画布切换（页面 connect/switchCanvas 后调用） */
  setCanvasId(canvasId: string | null): void {
    this.canvasId = canvasId
  }

  get currentCanvasId(): string | null {
    return this.canvasId
  }

  /** 预拉取模型列表（可提前调用预热；失败不阻塞，后续 list 会再拉） */
  async warmUp(): Promise<void> {
    await this.pullModels()
  }

  private async pullModels(): Promise<void> {
    if (this.loading) return
    this.loading = true
    try {
      const res = await fetch(`${this.baseUrl}/api/models`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const models: BackendModel[] = Array.isArray(data?.models) ? data.models : []
      this.models = models.map((m) => ({
        model: m.model,
        label: m.label,
        ratio: m.ratio,
        resolution: m.resolution,
        supportsInput: (m.supportsInput ?? undefined) as ImageModelCapability['supportsInput'],
        templates: m.templates,
        description: m.description,
        mcpTool: m.mcpTool,
        mcpModel: m.mcpModel,
      }))
    } catch (err) {
      console.error('[backend-image-models] 拉取 /api/models 失败:', err)
      // 保留旧快照（可能上次已拉到）；首次失败则空，调用方按空列表兜底
    } finally {
      this.loading = false
    }
  }

  // ================= 数据面（工具栏下拉/能力） =================

  listModelOptions() {
    void this.pullModels()
    return this.models.map((m) => ({ label: m.label || m.model, value: m.model }))
  }

  getCapability(modelId: string | undefined): ImageModelCapability | undefined {
    void this.pullModels()
    return this.models.find((m) => m.model === modelId)
  }

  listTemplates(modelId: string | undefined) {
    return TEMPLATES.filter(
      (t) => !t.forModels || t.forModels.length === 0 || (modelId && t.forModels.includes(modelId)),
    ).map((t) => ({ id: t.id, name: t.name, prompt: t.prompt }))
  }

  acceptsInput(modelId: string | undefined, kind: 'image' | 'audio' | 'video' | 'text'): boolean {
    const cap = this.getCapability(modelId)
    if (!cap?.supportsInput || cap.supportsInput.length === 0) return true
    if (kind === 'text') return true
    return (cap.supportsInput as string[]).includes(kind)
  }

  // ================= 执行面（点发送 → 后台任务） =================

  /** 资源归一（文本带 value，媒体带 url；供后台读取） */
  private normalizeResources(resources: GenerationResource[]): GenerationResource[] {
    return (resources ?? []).map((r) => ({ id: r.id, kind: r.kind, name: r.name, url: r.url, value: r.value }))
  }

  async run(payload: GenerationPayload, ctx?: { nodeId?: string }): Promise<RunOutcome> {
    const canvasId = this.canvasId
    const nodeId = ctx?.nodeId
    if (!canvasId) {
      return { ok: false, error: '未连接后台画布，无法提交生成（请先在页面连接后台并选择画布）' }
    }
    if (!nodeId) {
      return { ok: false, error: '缺少目标节点（nodeId），无法提交生成任务' }
    }

    // 1) 提交任务到后台（结果写回该节点 data.runState，经 SSE 广播）
    let taskId: string
    try {
      const res = await fetch(`${this.baseUrl}/api/tasks`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'image',
          canvasId,
          targetNodeId: nodeId,
          payload: {
            model: payload.model,
            promptText: payload.promptText,
            ratio: payload.ratio,
            resolution: payload.resolution,
            resources: this.normalizeResources(payload.resources),
          },
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!data?.ok || !data?.taskId) return { ok: false, error: data?.error || '后台未返回任务（taskId）' }
      taskId = data.taskId
    } catch (err) {
      return { ok: false, error: `提交后台任务失败: ${(err as Error).message}` }
    }

    // 2) 返回 PollFn：轮询后台任务，把进度/终态映射回 executeRun
    let lastNetError: string | undefined
    const poll: PollFn = async (): Promise<PollState> => {
      try {
        const res = await fetch(`${this.baseUrl}/api/tasks/${taskId}`)
        const data = await res.json().catch(() => ({}))
        const task = (data?.task ?? data) as BackendTask
        const status = task?.status
        if (status === 'done') {
          const urls: string[] = (task?.result as any)?.urls ?? []
          return { status: 'done', result: { ok: true, urls, taskId } }
        }
        if (status === 'error') {
          const msg = task?.error || task?.message || (task?.result as any)?.error || '后台生成失败'
          return { status: 'done', result: { ok: false, error: msg } }
        }
        return {
          status: 'running',
          progress: task?.progress ?? 0,
          message: task?.message || (status === 'pending' ? '任务排队中…' : '生成中…'),
          taskId,
        }
      } catch (err) {
        const msg = (err as Error).message
        // 网络瞬时失败先重试一次，连续失败才判死
        if (lastNetError === msg) return { status: 'done', result: { ok: false, error: `查询后台任务失败: ${msg}` } }
        lastNetError = msg
        return { status: 'running', progress: 0, message: '正在连接后台…', taskId }
      }
    }
    return poll
  }
}

/** 便捷：后台可用时创建并全局切换 provider，返回实例供 setCanvasId 用 */
export function useBackendImageModels(baseUrl: string): BackendImageModelProvider {
  const p = new BackendImageModelProvider(baseUrl)
  configureImageModels(p)
  void p.warmUp()
  return p
}
