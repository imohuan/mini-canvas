/**
 * plugin-tool-image-generation —— 把"图片生成后台"装成一组**可注册的工具**，让图片节点经 ctx.tools 调用。
 *
 * 为什么做成工具而不是节点：见内核 toolRegistry 的文件头 —— command 是画布内部动作（删除/撤销/建节点），
 * tool 是外部能力调用（可异步、带进度、有产物）。节点只需"列出能出图的工具 → 用户选一个 →
 * 带上上下文 invoke"，不认识 HTTP、不认识模型 id、不认识密钥。加一个模型 = 装一个新工具，节点零改动。
 *
 * 本包同时导出两种入口（任务要求）：
 * - pluginImageGenerationTools（PluginModule）：宿主一行 plugins: [pluginImageGenerationTools] 即可装载；
 * - createImageGenerationTools / registerImageGenerationTools（纯工厂/注册函数）：
 *   供"在别处单独注册这个工具"复用 —— 别的宿主/插件拿到 ToolDef[] 自己决定注册到哪。
 *
 * 依赖方向：只依赖内核(canvas-base/canvas-data)，不 import 宿主/demo/老版 src。
 */
import type { ConfigSchema, Context, InferConfig, PluginModule } from '@mini-canvas/canvas-base'
import {
  registerFromBackend,
  registerImageGenerationTools,
  type ImageGenerationToolOptions,
} from './imageGenerationTools'
import { DEFAULT_BASE_URL } from './imageModels'

export const name = 'tool-image-generation'
/** 硬依赖：工具注册表是内核内置单例（恒在），声明出来表明"只在这个服务上工作" */
export const inject = ['tools'] as string[]

/**
 * 插件可配置项（装配期经 Config schema 校验 + 补默认）。
 * 分组归「常规/图片生成」：与"节点外观"那类配置分开，便于在设置面板里找到。
 *
 * key 加 imageGen 前缀：settings 的 key 是**全局同一张表**（内核 Context.declareConfigIntoStore：
 * 已被别人声明的 key 会"先占者保留"，无法命名空间），而 baseUrl/timeoutMs 这种名字太通用，
 * 将来别的插件（比如另一个 HTTP 服务）很可能也要用。前缀让本插件不与它们抢号；
 * 面板里显示的是 label（中文），前缀对用户不可见。
 */
export const Config = {
  imageGenBaseUrl: {
    type: 'string',
    default: DEFAULT_BASE_URL,
    label: '生成后台地址',
    group: '常规/图片生成',
    description: '图片生成后台的根地址（默认连本地 mcp-server）。改完需重新装载插件生效。',
  },
  imageGenTimeoutMs: {
    type: 'number',
    default: 30_000,
    min: 1_000,
    max: 600_000,
    step: 1_000,
    label: '单次请求超时',
    group: '常规/图片生成',
    description: '提交/查询任务时单次 HTTP 请求的超时（毫秒）。整体轮询超时由内核 invoke 管，这里是单次请求上限。',
  },
  imageGenUseBackendModels: {
    type: 'boolean',
    default: false,
    label: '使用后台模型表',
    group: '常规/图片生成',
    description: '开启后从后台 GET /api/models 拉模型表再注册（以后加模型只改后台）；关闭则用插件内置的 5 个模型。',
  },
} satisfies ConfigSchema

/** apply 收到的 config 类型（与 schema 对齐） */
export type ImageGenerationPluginConfig = InferConfig<typeof Config>

/**
 * 插件主体：注册生成工具到 ctx.tools。
 *
 * 回收交给内核：ctx.tools.register 内部已用 ctx.effect 登记撤销 → 插件卸载后工具从注册表消失；
 * 这里不再重复登记（重复会在同名工具已被别的插件顶替时误删他人的工具）。
 *
 * useBackendModels=true 时额外拉一次后台模型表；失败**不抛**（后台没开也要能用），
 * 但也不静默 —— 经 console.warn 说明原因，便于排查"为什么模型列表没更新"。
 */
export function apply(ctx: Context, config?: ImageGenerationPluginConfig): void {
  const options: ImageGenerationToolOptions = {
    baseUrl: config?.imageGenBaseUrl || DEFAULT_BASE_URL,
    timeoutMs: typeof config?.imageGenTimeoutMs === 'number' ? config.imageGenTimeoutMs : undefined,
  }

  // 1) 先按内置表同步注册：后台没开、离线、拉表失败，画布上都仍然有可用的生成工具。
  registerImageGenerationTools(ctx, options)

  // 2) 可选：再用后台表补齐（只补后台独有的新模型，不碰上面已注册的，避免同名冲突）。
  if (!config?.imageGenUseBackendModels) return
  void (async () => {
    const result = await registerFromBackend(ctx, options)
    if (!result.ok) {
      console.warn('[tool-image-generation] 读取后台模型表失败，沿用内置模型：' + result.error)
    }
  })()
}

/** 兼容旧装配的 PluginModule 出口（宿主一行装载：plugins: [pluginImageGenerationTools]） */
export const pluginImageGenerationTools: PluginModule = { name, inject, Config, apply }
