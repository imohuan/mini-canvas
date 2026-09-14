/**
 * textGenerationPlugin —— 把"文本生成后台"装成一组**可注册的工具**，让文本节点经 ctx.tools 调用。
 *
 * 与图片侧（plugin-tool-image-generation）同构。用户的要求是"注册要放在一个单独的插件里"，
 * 所以本包**只做注册与调用**，不含任何节点 UI；文本节点的面板只负责展示与调用。
 *
 * 本包同时导出两种入口：
 * - pluginTextGenerationTools（PluginModule）：宿主一行 plugins: [pluginTextGenerationTools] 装载；
 * - createTextGenerationTools / registerTextGenerationTools（纯工厂/注册函数）：
 *   供"在别处单独注册这个工具"复用。
 *
 * 依赖方向：只依赖内核(canvas-base/canvas-data)，不 import 宿主/节点插件。
 */
import type { ConfigSchema, Context, InferConfig, PluginModule } from '@mini-canvas/canvas-base'
import {
  registerFromBackend,
  registerTextGenerationTools,
  type TextGenerationToolOptions,
} from './textGenerationTools'
import { DEFAULT_BASE_URL } from './textModels'

export const name = 'tool-text-generation'
/** 硬依赖：工具注册表是内核内置单例（恒在），声明出来表明"只在这个服务上工作" */
export const inject = ['tools'] as string[]

/**
 * 插件可配置项（装配期经 Config schema 校验 + 补默认）。
 *
 * key 加 textGen 前缀：settings 的 key 是**全局同一张表**（内核 Context.declareConfigIntoStore：
 * 已被别人声明的 key 会"先占者保留"），而 baseUrl/timeoutMs 这种名字太通用，会与图片侧撞号。
 *
 * 注意分组用「常规/文本生成」：与图片的「常规/图片生成」并列，设置面板里一眼能分清。
 */
export const Config = {
  textGenBaseUrl: {
    type: 'string',
    default: DEFAULT_BASE_URL,
    label: '文本生成后台地址',
    group: '常规/文本生成',
    description: '文本生成后台的根地址（默认连本地 mcp-server）。改完需重新装载插件生效。',
  },
  textGenTimeoutMs: {
    type: 'number',
    default: 30_000,
    min: 1_000,
    max: 600_000,
    step: 1_000,
    label: '单次请求超时',
    group: '常规/文本生成',
    description:
      '提交/查询任务时单次 HTTP 请求的超时（毫秒）。整体轮询超时由内核 invoke 管，这里是单次请求上限。',
  },
  textGenUseBackendModels: {
    type: 'boolean',
    default: false,
    label: '使用后台模型表',
    group: '常规/文本生成',
    description:
      '开启后从后台 GET /api/models 拉模型表再注册（以后加模型只改后台）；关闭则用插件内置的 3 个模型。',
  },
} satisfies ConfigSchema

/** apply 收到的 config 类型（与 schema 对齐） */
export type TextGenerationPluginConfig = InferConfig<typeof Config>

/**
 * 插件主体：注册文本生成工具到 ctx.tools。
 *
 * 回收交给内核（ctx.tools.register 内部已 ctx.effect 登记撤销），故此处不重复登记 —— 
 * 重复登记会在同名工具已被别的插件顶替时误删他人的工具。
 *
 * useBackendModels=true 时额外拉一次后台模型表；失败**不抛**（后台没开也要能用），
 * 但也不静默 —— 经 console.warn 说明原因，便于排查"为什么模型列表没更新"。
 */
export function apply(ctx: Context, config?: TextGenerationPluginConfig): void {
  const options: TextGenerationToolOptions = {
    baseUrl: config?.textGenBaseUrl || DEFAULT_BASE_URL,
    timeoutMs: typeof config?.textGenTimeoutMs === 'number' ? config.textGenTimeoutMs : undefined,
  }

  // 1) 先按内置表同步注册：后台没开、离线、拉表失败，画布上都仍然有可用的生成工具
  registerTextGenerationTools(ctx, options)

  // 2) 可选：再用后台表补齐（只补后台独有的模型，跳过同名，避免内核抛重名错）
  if (!config?.textGenUseBackendModels) return
  void (async () => {
    const result = await registerFromBackend(ctx, options)
    if (!result.ok) {
      console.warn('[tool-text-generation] 读取后台模型表失败，沿用内置模型：' + result.error)
    }
  })()
}

/** 兼容旧装配的 PluginModule 出口（宿主一行装载：plugins: [pluginTextGenerationTools]） */
export const pluginTextGenerationTools: PluginModule = { name, inject, Config, apply }
