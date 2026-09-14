// plugin-tool-image-generation —— 图片生成工具包统一出口。
//
// 两类出口（宿主按需取）：
// 1. PluginModule：一行装载，工具随插件生命周期自动注册/回收；
// 2. 纯工厂/注册函数：供"在别处单独注册这个工具"复用（别的注册表、别的宿主）。
export { pluginImageGenerationTools, Config, name, inject } from './imageGenerationPlugin'
export type { ImageGenerationPluginConfig } from './imageGenerationPlugin'

export {
  createImageGenerationTool,
  createImageGenerationTools,
  registerImageGenerationTools,
  registerFromBackend,
  buildToolName,
  toGenerationResources,
  IMAGE_GENERATION_GROUP,
  TOOL_NAME_PREFIX,
  DEFAULT_REQUEST_TIMEOUT,
} from './imageGenerationTools'
export type {
  FetchLike,
  FetchResponseLike,
  ImageGenerationToolOptions,
  RegisterFromBackendResult,
  ToolRegistrationHost,
} from './imageGenerationTools'

export { IMAGE_MODELS, DEFAULT_BASE_URL, VALUE_LABELS, valueLabel } from './imageModels'
export type { ImageModelCapability, ImageGenerationInputType } from './imageModels'
