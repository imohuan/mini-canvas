// plugin-tool-text-generation —— 文本生成工具包统一出口。
//
// 两类出口（宿主按需取）：
// 1. PluginModule：一行装载，工具随插件生命周期自动注册/回收；
// 2. 纯工厂/注册函数：供"在别处单独注册这个工具"复用（别的注册表、别的宿主）。
export { pluginTextGenerationTools, Config, name, inject } from './textGenerationPlugin'
export type { TextGenerationPluginConfig } from './textGenerationPlugin'

export {
  createTextGenerationTool,
  createTextGenerationTools,
  registerTextGenerationTools,
  registerFromBackend,
  buildToolName,
  toGenerationResources,
  TEXT_GENERATION_GROUP,
  TOOL_NAME_PREFIX,
  DEFAULT_REQUEST_TIMEOUT,
} from './textGenerationTools'
export type {
  FetchLike,
  FetchResponseLike,
  TextGenerationToolOptions,
  RegisterFromBackendResult,
  ToolRegistrationHost,
} from './textGenerationTools'

export { TEXT_MODELS, TEXT_TEMPLATES, DEFAULT_BASE_URL, VALUE_LABELS, valueLabel, paramsOf } from './textModels'
export type { TextModelCapability } from './textModels'
