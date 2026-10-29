/**
 * ModelRegistry —— 后台生成模型注册表
 *
 * 由前端 imageModels.ts 的 5 个图片模型能力声明移植而来，并支持 video/audio 扩展。
 * 注册"能力声明 + runnerId"；真正执行由 TaskManager 经 executeModelRun 统一驱动。
 */
import type {
  GenerationPayload,
  GenerationResult,
  ImageModelCapability,
  ModelRunner,
  PollFn,
  PollState,
  RunOutcome,
} from './types'

/** 预置图片模型（对齐前端 imageModels.LOCAL_MODELS 的能力声明） */
const PRESET_IMAGE_MODELS: ImageModelCapability[] = [
  {
    model: 'apimart-gpt-image-2', label: 'GPT Image 2（APIMart）', kind: 'image',
    ratio: ['1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16', '2:1', '1:2', '3:1', '1:3', '21:9', '9:21'],
    resolution: ['1k', '2k', '4k'],
    supportsInput: ['image'],
    description: 'APIMart GPT Image 2，支持比例 + 分辨率档位，可带参考图',
    mcpTool: 'apimart/generate-image', runnerId: 'web2api',
  },
  {
    model: 'chatgpt-gpt-image-2', label: 'GPT Image 2（ChatGPT）', kind: 'image',
    ratio: ['1:1', '2:3', '3:4', '4:3', '9:16', '16:9'],
    supportsInput: ['image'],
    description: 'ChatGPT 账号版 GPT Image 2，无分辨率档位，可带参考图',
    mcpTool: 'chatgpt/generate-image', runnerId: 'web2api',
  },
  {
    model: 'doubao-seedream-5lite', label: 'Seedream 5.0 Lite（豆包）', kind: 'image',
    ratio: ['auto', '1:1', '2:3', '3:4', '4:3', '9:16', '16:9'],
    supportsInput: ['image'],
    description: '豆包 Seedream 5.0 Lite，智能升级、细节丰富',
    mcpTool: 'doubao/generate-image-chat', mcpModel: 'Seedream 5.0 Lite', runnerId: 'web2api',
  },
  {
    model: 'doubao-seedream-45', label: 'Seedream 4.5（豆包）', kind: 'image',
    ratio: ['auto', '1:1', '2:3', '3:4', '4:3', '9:16', '16:9'],
    supportsInput: ['image'],
    description: '豆包 Seedream 4.5，多图参考、人像自然',
    mcpTool: 'doubao/generate-image-chat', mcpModel: 'Seedream 4.5', runnerId: 'web2api',
  },
  {
    model: 'doubao-seedream-40', label: 'Seedream 4.0（豆包）', kind: 'image',
    ratio: ['auto', '1:1', '2:3', '3:4', '4:3', '9:16', '16:9'],
    supportsInput: ['image'],
    description: '豆包 Seedream 4.0，精准编辑、特征保持',
    mcpTool: 'doubao/generate-image-chat', mcpModel: 'Seedream 4.0', runnerId: 'web2api',
  },
]

/** 默认兜底 runner：返回明确"未接入真实生成"错误，绝不静默 mock（除非显式启用 mock） */
class UnavailableRunner implements ModelRunner {
  constructor(private message: string) {}
  run(): RunOutcome {
    return { ok: false, error: this.message }
  }
}

export class ModelRegistry {
  private capabilities = new Map<string, ImageModelCapability>()
  private runners = new Map<string, ModelRunner>()

  constructor() {
    this.registerCapabilities(PRESET_IMAGE_MODELS)
    // 默认所有 runner 指向"未可用"（接 web2api 后注册真 runner 覆盖）
    this.registerRunner('web2api', new UnavailableRunner('[models] 未配置 web2api 生成后台（--web2api）。无法执行真实生成'))
  }

  registerCapabilities(caps: ImageModelCapability[]): void {
    for (const c of caps) this.capabilities.set(c.model, c)
  }

  registerRunner(id: string, runner: ModelRunner): void {
    this.runners.set(id, runner)
  }

  listModels(): ImageModelCapability[] {
    return [...this.capabilities.values()]
  }

  listModelOptions(): { label: string; value: string }[] {
    return this.listModels().map((m) => ({ label: m.label ?? m.model, value: m.model }))
  }

  getCapability(modelId: string | undefined): ImageModelCapability | undefined {
    return modelId ? this.capabilities.get(modelId) : undefined
  }

  /** 找某模型对应的 runner；查不到模型或无 runner → UnavailableRunner（明确错误） */
  private runnerFor(cap: ImageModelCapability | undefined): ModelRunner {
    if (!cap) return new UnavailableRunner(`[models] 未知模型`)
    const id = cap.runnerId ?? 'web2api' // 未显式指定时回落到 web2api 执行器
    const r = this.runners.get(id)
    return r ?? new UnavailableRunner(`[models] 模型 ${cap.model} 未配置 runner(${id})`)
  }

  /**
   * 统一驱动一次生成。与前端 imageModels.executeRun 同语义：
   * - run 返回 GenerationResult → 同步完成；
   * - run 返回 PollFn → 本方法内 while 定时轮询直到 done 或超时，期间 running 进度回调 onProgress。
   */
  async executeModelRun(
    payload: GenerationPayload,
    options: { interval?: number; timeoutMs?: number; onProgress?: (p: { progress?: number; message?: string; taskId?: string }) => void } = {},
  ): Promise<GenerationResult> {
    const { interval = 2000, timeoutMs = 300_000, onProgress } = options
    const cap = this.getCapability(payload.model)
    const runner = this.runnerFor(cap)
    const outcome = await runner.run(payload)

    // 同步结果
    if (typeof outcome !== 'function') return outcome

    // 异步：outcome 是 PollFn，轮询直到 done
    const poll: PollFn = outcome as PollFn
    const startedAt = Date.now()
    while (true) {
      let state: PollState
      try {
        state = await poll()
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
      if (state.status === 'running') {
        onProgress?.({ progress: state.progress, message: state.message, taskId: state.taskId })
        if (Date.now() - startedAt > timeoutMs) {
          return { ok: false, error: `生成轮询超时（>${timeoutMs}ms）` }
        }
        await new Promise((r) => setTimeout(r, interval))
        continue
      }
      return state.result
    }
  }
}

/** 单例（供默认 server 组装用） */
let registry: ModelRegistry | null = null
export function getModelRegistry(): ModelRegistry {
  if (!registry) registry = new ModelRegistry()
  return registry
}

export function resetModelRegistry(): void {
  registry = null
}

/** 便捷：列出可生成模型（MCP models.list 用） */
export function listGenerationModels(): ImageModelCapability[] {
  return getModelRegistry().listModels()
}
