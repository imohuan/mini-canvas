/**
 * plugin-web2api-tools —— 把 web2api 的 MCP 工具做成**节点底栏动作**的插件。
 *
 * 用户要求（本文件是它的落地）：
 * 1. 通过 web2api 的 MCP 中转调各平台能力，做成底栏可视化 UI；
 * 2. 只做图片 / 音频 / 视频三类节点；
 * 3. 图片与视频走 **dola 与豆包的 UI 自动化（auto）模式**（"doubao/chat-auto" / "dola/chat-auto"）；
 * 4. 配置**预置在本地**（presets.ts），执行时**以调用 MCP 工具**的方式跑（mcpClient.ts）；
 * 5. 参数按**语义类型**（kind）映射到预设组件 —— 只声明该平台真支持的参数（按能力显隐）。
 *
 * 分层（为什么这么切）：
 * - presets.ts    纯数据：预置配置表（服务端不可用也能渲染 UI）；
 * - chatAutoPrompt.ts / mcpParse.ts / presetRun.ts  纯函数：拼前缀、解响应、跑一次调用（可单测）；
 * - mcpClient.ts  协议层：JSON-RPC + 会话（唯一碰网络的地方）；
 * - 本文件        接线：注册动作 / 写入器 / audio 节点类型（唯一碰 ctx 的地方）。
 *
 * 依赖方向：只依赖 canvas-base/canvas-data/kernel + plugin-bottom-bar。
 * 不 import plugin-theme-default（预设组件走 ui 目录按名取，见 T08 守卫）。
 */
import { type Context, type ConfigSchema, type PluginModule, Service } from '@mini-canvas/canvas-base'
import type { DocService } from '@mini-canvas/canvas-data'
import type { ToolResource } from '@mini-canvas/kernel'
// 只借**类型**（类型编译期擦除，不构成运行时依赖）：插件之间不 import 实现。
// 运行时一律 `ctx.get('nodeBar')` 拿服务（见 apply 里的 registerBar）。
import type { BarRunContext } from '@mini-canvas/plugin-bottom-bar'
import type { BarAction, BarApplier, BarRunInput } from '@mini-canvas/plugin-bottom-bar'
import { McpClient } from './mcpClient'
import { WEB2API_PRESETS } from './presets'
import { runPreset, makeTaskPoll, type RunDeps, type RunInput } from './presetRun'
import AudioContent from './AudioContent.vue'

/** audio 节点类型名（本插件注册；画布此前没有音频节点） */
export const AUDIO_NODE_TYPE = 'audio'

/**
 * 本插件可配置项（P4：模块级 Config，内核装配时校验 + 补默认 + 登记进设置面板）。
 *
 * key 一律带 web2api 前缀：settings 的 key 是**全局平面命名**、先声明者独占，
 * 叫 endpoint 这种通用名会和别的插件抢同一个键（撞名会被静默跳过）。
 */
export const Config: ConfigSchema = {
  web2apiMcpEndpoint: {
    type: 'string',
    default: 'http://localhost:8033/mcp',
    label: 'MCP 服务地址',
    group: 'web2api/连接',
    description: 'web2api 的 MCP Streamable HTTP 端点。默认本机 8033 端口。',
  },
  web2apiPollIntervalMs: {
    type: 'number',
    default: 3000,
    min: 500,
    max: 30000,
    step: 500,
    label: '任务轮询间隔',
    group: 'web2api/任务',
    description: '异步任务（视频生成等）每隔多久查一次进度；越小越跟手，越大越省服务端压力。',
  },
  web2apiTimeoutMs: {
    type: 'number',
    default: 1800000,
    min: 60000,
    max: 3600000,
    step: 60000,
    label: '任务超时',
    group: 'web2api/任务',
    description: '单个任务最长等多久（毫秒）。视频生成可能很久，默认 30 分钟。',
  },
}

/** 从 settings 读当前配置（未声明/未改 → 回落默认；settings 未就绪 → 全默认） */
export function web2apiConfigFrom(ctx: Context): {
  endpoint: string
  pollIntervalMs: number
  timeoutMs: number
} {
  const settings = ctx.tryGet('settings')
  const read = <T extends string | number | boolean>(key: string, fallback: T): T => {
    if (!settings) return fallback
    const v = settings.get(key)
    return (v === undefined || v === null || v === '' ? fallback : v) as T
  }
  return {
    endpoint: read('web2apiMcpEndpoint', 'http://localhost:8033/mcp'),
    pollIntervalMs: read('web2apiPollIntervalMs', 3000),
    timeoutMs: read('web2apiTimeoutMs', 1800000),
  }
}

export const name = 'web2api-tools'
export const inject = ['doc'] as string[]

/** audio 节点类型图标（与其它节点同写法：opaque SVG 句柄） */
const AUDIO_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10v4"/><path d="M7 6v12"/><path d="M11 3v18"/><path d="M15 7v10"/><path d="M19 10v4"/></svg>'

/** audio 节点服务（其它插件/宿主经 ctx.get('audio') 用） */
export interface AudioNodeService {
  addAudioNode(position: { x: number; y: number }, audioUrl?: string): string
}

declare module '@mini-canvas/canvas-data' {
  interface Context {
    audio: AudioNodeService
  }
}

export class AudioService extends Service implements AudioNodeService {
  constructor(ctx: Context) {
    super(ctx, 'audio')
  }

  addAudioNode(position: { x: number; y: number }, audioUrl = ''): string {
    const doc = this.ctx.get<DocService>('doc')
    return doc.transaction('add-audio-node', (tx) =>
      tx.createNode(AUDIO_NODE_TYPE, position, audioUrl ? { audioUrl } : {}),
    )
  }
}

/** 上游素材 → web2api 的 referenceImages（它收"相对 uploadsDir 的路径或绝对路径"；
 *  画布里的素材是 URL，直接透传，能不能取到由服务端决定） */
function referenceImagesOf(resources: ToolResource[] | undefined): string[] {
  return (resources ?? [])
    .filter((r) => r.kind === 'image' && typeof r.url === 'string' && r.url)
    .map((r) => r.url as string)
}

export function apply(ctx: Context) {
  // —— MCP 客户端（endpoint 每次 run 现取：设置里改了立刻生效）——
  const client = new McpClient({
    endpoint: web2apiConfigFrom(ctx).endpoint,
  })

  /** 执行依赖（presetRun 的纯逻辑只认这些，测试可注入假货） */
  const deps: RunDeps = {
    callTool: (tool, args) => client.callTool(tool, args),
    getTask: (taskId) => client.getTask(taskId),
    cancelTask: (taskId) => client.cancelTask(taskId),
    origin: () => client.effectiveOrigin(),
    config: () => {
      const c = web2apiConfigFrom(ctx)
      return { pollIntervalMs: c.pollIntervalMs, timeoutMs: c.timeoutMs }
    },
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  }

  // —— audio 节点类型（本插件补画布缺的音频节点）——
  const audio = new AudioService(ctx)
  ctx.nodes.register({
    type: AUDIO_NODE_TYPE,
    label: '音频',
    description: '在画布中添加一个音频节点（语音合成 / 音频生成）',
    icon: AUDIO_ICON,
    size: { w: 320, h: 140 },
    inputs: [{ port: 'target', acceptsTypes: ['text', 'audio'] }],
    outputs: [{ port: 'source', contentType: 'audio' }],
    resizable: true,
    in: AudioContent,
    create(position) {
      return audio.addAudioNode(position)
    },
  })

  // —— 底栏动作：每个预置一条动作（§0.3：nodeBar 是插件服务，取得到才注册）——
  const registerBar = (): boolean => {
    // 插件之间**不互相 import**：按名字取底栏提供的服务（nodeBar）。
    // 取不到 = 宿主没装底栏插件 → 本插件静默无用（不算错）。
    // 服务方法签名（与 plugin-bottom-bar 的 NodeBarService 一致；这里只声明用得到的两个写入口）
    const bar = ctx.tryGet<{
      register(scope: Context, action: BarAction): void
      registerApplier(scope: Context, kind: string, fn: BarApplier): void
    }>('nodeBar')
    if (!bar) return false

    for (const preset of WEB2API_PRESETS) {
      bar.register(ctx, {
        id: preset.id,
        types: [preset.nodeType],
        title: preset.title,
        description: preset.description,
        group: preset.group,
        needsPrompt: true,
        fields: preset.fields.map((f) => ({ ...f })),
        order: preset.order,
        // 轮询节奏用插件自己的配置（设置面板里那两项由此生效；共享默认 5 分钟会误杀长视频）
        pollIntervalMs: web2apiConfigFrom(ctx).pollIntervalMs,
        pollTimeoutMs: web2apiConfigFrom(ctx).timeoutMs,
        async run(input: BarRunInput, runCtx: BarRunContext) {
          const runInput: RunInput = {
            preset,
            prompt: input.prompt ?? '',
            values: (input.values ?? {}) as Record<string, unknown>,
            referenceImages: referenceImagesOf(input.resources),
          }
          return runPreset(runInput, deps, runCtx)
        },
        // 刷新续查：拿 taskId 接回来接着轮询（页面重开也不丢在跑的任务）
        resume(taskId: string) {
          return makeTaskPoll(taskId, deps)
        },
        // 取消：覆盖层点「取消」时，除了客户端不再等，还要去服务端把任务真取消掉
        // （只 abort 的话服务端那个任务还在排队/执行）。
        onCancel(taskId: string) {
          return deps.cancelTask(taskId).then(() => undefined)
        },
      })
    }

    // —— 结果写入器：image 复用 node-image 的（已有）；video / audio 由本插件提供 ——
    //    写 data.videoUrl / data.audioUrl（走 doc.updateNode → 进历史、可撤销、自动落盘）。
    try {
      bar.registerApplier(ctx, 'video', (nodeId: string, result: { urls?: string[] }) => {
        const url = result.urls?.[0]
        if (!url) return
        ctx.get<DocService>('doc').updateNode(nodeId, { data: { videoUrl: url } })
      })
    } catch {
      /* 已有人注册（换了写回策略）：不重复注册、也不报错 */
    }
    try {
      bar.registerApplier(ctx, 'audio', (nodeId: string, result: { urls?: string[] }) => {
        const url = result.urls?.[0]
        if (!url) return
        ctx.get<DocService>('doc').updateNode(nodeId, {
          data: { audioUrl: url, audioName: url.split('/').pop() ?? '' },
        })
      })
    } catch {
      /* 同上 */
    }
    return true
  }

  if (!registerBar()) {
    const off = ctx.on('ctx:plugin-installed', () => {
      if (registerBar()) off.dispose()
    })
  }
}

/** 兼容装配清单的 PluginModule 出口 */
export const web2apiToolsPlugin: PluginModule = { name, inject, Config, apply }
